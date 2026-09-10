import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText, ListPlus, Eye, Save, Loader2, Plus, Trash2, Search, Landmark,
  CheckCircle2, ScanEye, Undo2, RefreshCw, Eraser, DoorOpen
} from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useToast } from '../../context/ToastContext'
import { api, decodeJwtPayload } from '../../lib/api'
import { saveTest } from '../../lib/testSave'
import { assignSectionQuestionNumbers, parseCsv, stripHtml, findDuplicateQuestionIds } from '../../lib/helpers'
import { DEPARTMENTS } from '../../lib/departments'
import QuestionPicker from '../../components/QuestionPicker'
import TestPreviewContent from '../../components/TestPreviewContent'
import PostSaveDialog from '../../components/PostSaveDialog'

const TABS = [
  { id: 'details', label: 'Test Details', icon: FileText },
  { id: 'add', label: 'Add Questions', icon: ListPlus },
  { id: 'preview', label: 'Preview Test', icon: Eye }
]

function freshState(mode, existingTestId, initialTestName, initialTestType, initialVisibility, initialSections) {
  const sections = initialSections || [{ name: 'Section 1', duration: '60', questions: [] }]
  return {
    _mode: mode, _existingTestId: existingTestId,
    activeTab: 'details',
    testName: initialTestName, testType: initialTestType, visibility: initialVisibility,
    deptSelected: new Set([DEPARTMENTS[0]?.value]),
    sections,
    excludeTestNames: '', topicsIncluded: '', topicsExcluded: '',
    term: '', qbs: [], resultsCollapsed: false, activeQb: null, loadedQuestions: [],
    targetSection: sections[0]?.name || '',
    topicChecks: {}, topicCheckTargets: new Set(), removalHistory: [],
    saving: false, saveError: '', savedName: null
  }
}

export default function ManualPackingWizard({
  mode = 'create', // 'create' | 'edit'
  existingTestId = null,
  initialTestName = '',
  initialTestType = 'Manual Assessment Test',
  initialVisibility = 'Within Department',
  initialSections = null // [{ name, duration, questions }] — for edit
}) {
  const { token, deptIds, manualPackingState: mp, setManualPackingState: setMp } = useApp()
  const toast = useToast()
  const navigate = useNavigate()

  // Purely transient loading spinners — fine to reset on remount, unlike everything else here.
  const [searching, setSearching] = useState(false)
  const [loadingQbId, setLoadingQbId] = useState(null)
  const [checkingTopics, setCheckingTopics] = useState(false)

  // Keep an in-progress session across navigating away and back (Test QC, Smart Packer,
  // etc.) — only reset if this is genuinely a DIFFERENT test (different mode or ID) than
  // whatever's already in progress. This is the only place this component's data lives;
  // there's no local useState for any of it, on purpose.
  useEffect(() => {
    setMp(prev => {
      if (prev && prev._mode === mode && prev._existingTestId === existingTestId) return prev
      return freshState(mode, existingTestId, initialTestName, initialTestType, initialVisibility, initialSections)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, existingTestId])

  function update(patch) {
    setMp(prev => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }))
  }

  const ready = !!mp && mp._mode === mode && mp._existingTestId === existingTestId
  // Safe fallbacks so the hooks below can run unconditionally (rules of hooks) even during
  // the one-tick gap before the init effect above has populated context on first mount.
  const {
    activeTab = 'details', testName = '', testType = '', visibility = '', deptSelected = new Set(), sections = [],
    excludeTestNames = '', topicsIncluded = '', topicsExcluded = '',
    term = '', qbs = [], resultsCollapsed = false, activeQb = null, loadedQuestions = [], targetSection = '',
    topicChecks = {}, topicCheckTargets = new Set(), removalHistory = [],
    saving = false, saveError = '', savedName = null
  } = ready ? mp : {}

  const effectiveTarget = sections.some(s => s.name === targetSection) ? targetSection : (sections[0]?.name || '')
  const alreadyIncludedIds = useMemo(() => {
    const set = new Set()
    sections.forEach(s => s.questions.forEach(q => set.add(q.q_id)))
    return set
  }, [sections])
  const wholeTestDupMap = useMemo(() => {
    const allPlaced = sections.flatMap(s => s.questions)
    return findDuplicateQuestionIds([...allPlaced, ...loadedQuestions])
  }, [sections, loadedQuestions])
  const totalQuestions = sections.reduce((n, s) => n + s.questions.length, 0)

  // Recall is DERIVED, not trusted from the raw history stack. A question is only genuinely
  // recallable if it isn't already sitting in some section right now — that way, however the
  // history got out of sync (re-picked by hand, QB reloaded, section renamed), Recall can
  // never add a second copy of something that's already in the test.
  const recallable = useMemo(() => {
    const placed = new Set()
    sections.forEach(s => s.questions.forEach(q => placed.add(q.q_id)))
    return removalHistory.filter(h => !placed.has(h.question.q_id))
  }, [sections, removalHistory])

  if (!ready) return null // one-tick init flash on first mount
  const topicsScopeGiven = !!(topicsIncluded.trim() || topicsExcluded.trim())

  // ================= Test Details handlers =================
  function addSection() {
    update(prev => ({ sections: [...prev.sections, { name: `Section ${prev.sections.length + 1}`, duration: '60', questions: [] }] }))
  }
  function removeSection(idx) {
    update(prev => ({ sections: prev.sections.filter((_, i) => i !== idx) }))
  }
  function updateSection(idx, patch) {
    update(prev => ({ sections: prev.sections.map((s, i) => i === idx ? { ...s, ...patch } : s) }))
  }

  // ================= Add Questions handlers =================
  async function searchQbs() {
    if (!token) { toast('Paste an access token first.', 'error'); return }
    if (!term.trim()) return
    setSearching(true)
    update({ resultsCollapsed: false })
    try {
      const data = await api.searchQuestionBanks(token, {
        branch_id: 'all', department_id: deptIds, limit: 30, mainDepartmentUser: true, page: 1, visibility: 'All', search: term.trim()
      })
      update({ qbs: data.results?.questionbanks || [] })
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setSearching(false)
    }
  }

  // Loading a bank REPLACES the pool — only one bank open at a time. Search results then
  // collapse automatically (nothing more to pick from that list until you search again or
  // start typing a different bank name).
  async function loadQb(qb) {
    if (activeQb?.qb_id === qb.qb_id) return
    setLoadingQbId(qb.qb_id)
    try {
      const data = await api.getQuestionsForQb(token, qb.qb_id, 150)
      const results = data.results || data
      const rows = results.non_group_questions || results.questions || []
      rows.forEach(r => { r._qb_name = qb.qb_name || qb.qb_code || qb.qb_id; r._qb_id = qb.qb_id })
      assignSectionQuestionNumbers(rows)
      update({
        loadedQuestions: rows,
        activeQb: { qb_id: qb.qb_id, qb_name: qb.qb_name || qb.qb_code || qb.qb_id },
        resultsCollapsed: true,
        topicChecks: {},
        topicCheckTargets: new Set()
      })
      toast(`📚 Loaded ${rows.length} question(s) from "${qb.qb_name || qb.qb_code}".`, 'success')
    } catch (err) {
      toast(`Couldn't load that question bank: ${err.message}`, 'error')
    } finally {
      setLoadingQbId(null)
    }
  }

  // Single click on a question moves it straight into the target section — no separate
  // multi-select + "Add" step.
  function pickToSection(q) {
    if (!effectiveTarget) return
    update(prev => {
      const target = prev.sections.find(s => s.name === effectiveTarget)
      if (target?.questions.some(x => x.q_id === q.q_id)) return prev // already there — no-op
      const newSections = prev.sections.map(s => {
        if (s.name !== effectiveTarget) return s
        const merged = [...s.questions, { ...q, _sectionName: s.name }]
        assignSectionQuestionNumbers(merged)
        return { ...s, questions: merged }
      })
      return {
        sections: newSections,
        loadedQuestions: prev.loadedQuestions.filter(x => x.q_id !== q.q_id),
        // Re-picking a question makes any pending "recall" entry for it stale — drop it, or
        // hitting Recall later would add a second copy of something already in the section.
        removalHistory: prev.removalHistory.filter(h => h.question.q_id !== q.q_id)
      }
    })
    toast(`✅ Q${q._qNum ?? ''} moved into "${effectiveTarget}".`, 'success')
  }

  function toggleTopicCheckTarget(q) {
    update(prev => {
      const next = new Set(prev.topicCheckTargets)
      if (next.has(q.q_id)) next.delete(q.q_id); else next.add(q.q_id)
      return { topicCheckTargets: next }
    })
  }

  function removeFromSection(sectionIdx, q) {
    const sectionName = sections[sectionIdx]?.name
    const backInPool = activeQb && q._qb_id === activeQb.qb_id
    update(prev => {
      const newSections = prev.sections.map((s, i) => i === sectionIdx ? { ...s, questions: s.questions.filter(x => x.q_id !== q.q_id) } : s)
      // If this question came from the QB currently loaded in the left pool, put it straight
      // back there so it's immediately pickable again — no need to re-search/re-load anything.
      let newLoaded = prev.loadedQuestions
      if (backInPool && !newLoaded.some(x => x.q_id === q.q_id)) {
        newLoaded = [...newLoaded, q]
        assignSectionQuestionNumbers(newLoaded)
      }
      return {
        sections: newSections,
        loadedQuestions: newLoaded,
        // Drop any older pending entry for this same question first, so history can't hold
        // two recall entries for one question after a remove → re-pick → remove cycle.
        removalHistory: [...prev.removalHistory.filter(h => h.question.q_id !== q.q_id), { sectionName, question: q }]
      }
    })
    toast(
      backInPool
        ? `🗑️ Removed Q${q._qNum ?? ''} from "${sectionName}" — back in "${activeQb.qb_name}" for re-picking.`
        : `🗑️ Removed Q${q._qNum ?? ''} from "${sectionName}" — you can recall it.`,
      'info'
    )
  }

  function recallLastRemoved() {
    // Take the most recent entry that is genuinely recallable (see `recallable` above) rather
    // than blindly popping the stack — stale entries are skipped and pruned, not re-added.
    const last = recallable[recallable.length - 1]
    if (!last) return
    update(prev => {
      const placed = new Set()
      prev.sections.forEach(s => s.questions.forEach(q => placed.add(q.q_id)))
      if (placed.has(last.question.q_id)) {
        // Already somewhere in the test — just drop the stale entry, never add a copy.
        return { removalHistory: prev.removalHistory.filter(h => h.question.q_id !== last.question.q_id) }
      }
      const targetName = prev.sections.some(s => s.name === last.sectionName)
        ? last.sectionName
        : prev.sections[0]?.name // section was renamed/removed — fall back to the first one
      const newSections = prev.sections.map(s => {
        if (s.name !== targetName) return s
        const merged = [...s.questions, { ...last.question, _sectionName: s.name }]
        assignSectionQuestionNumbers(merged)
        return { ...s, questions: merged }
      })
      // If it had been auto-added back into the pool (same active QB), take it out of there
      // now that it's back in a section — otherwise it'd show up in both places at once.
      const newLoaded = prev.loadedQuestions.filter(x => x.q_id !== last.question.q_id)
      return {
        sections: newSections,
        loadedQuestions: newLoaded,
        removalHistory: prev.removalHistory.filter(h => h.question.q_id !== last.question.q_id)
      }
    })
    toast(`↩️ Recalled Q${last.question._qNum ?? ''} back into "${last.sectionName}".`, 'success')
  }

  // Empty a whole section in one go. Questions from the currently-open QB go back into the
  // left pool; the rest are recallable one-by-one from history as usual.
  function clearSection(sectionIdx) {
    const sec = sections[sectionIdx]
    if (!sec || !sec.questions.length) return
    const removed = sec.questions
    update(prev => {
      const newSections = prev.sections.map((s, i) => i === sectionIdx ? { ...s, questions: [] } : s)
      const backInPool = removed.filter(q => activeQb && q._qb_id === activeQb.qb_id)
      const existing = new Set(prev.loadedQuestions.map(q => q.q_id))
      const newLoaded = [...prev.loadedQuestions, ...backInPool.filter(q => !existing.has(q.q_id))]
      assignSectionQuestionNumbers(newLoaded)
      return {
        sections: newSections,
        loadedQuestions: newLoaded,
        removalHistory: [...prev.removalHistory, ...removed.map(q => ({ sectionName: sec.name, question: q }))]
      }
    })
    toast(`🧹 Cleared all ${removed.length} question(s) from "${sec.name}".`, 'info')
  }

  // Abandon the whole in-progress test and go back to the Manual Packing home screen.
  function exitTest() {
    if (totalQuestions > 0 && !window.confirm(`Exit this test? ${totalQuestions} added question(s) will be discarded.`)) return
    setMp(null)
    navigate('/manual-packing')
  }

  // Opt-in, per-selection topic-alignment check — tick just the questions you're unsure
  // about (a small checkbox on each card, separate from click-to-move) and hit the button.
  async function checkTopicAlignment() {
    if (!token) { toast('Paste an access token first.', 'error'); return }
    if (!topicsScopeGiven) { toast('Set topics included/excluded on the Test Details tab first.', 'error'); return }
    const targets = loadedQuestions.filter(q => topicCheckTargets.has(q.q_id))
    if (!targets.length) { toast('Tick at least one question below first.', 'error'); return }

    setCheckingTopics(true)
    const topics_included = parseCsv(topicsIncluded)
    const topics_excluded = parseCsv(topicsExcluded)
    for (const q of targets) {
      try {
        const data = await api.topicAlignCheck(token, {
          question_text: stripHtml(q.question_data || ''),
          solution_code: '',
          question_type: q.question_type,
          topics_included,
          topics_excluded
        })
        update(prev => ({ topicChecks: { ...prev.topicChecks, [q.q_id]: { verdict: data.verdict, note: data.note } } }))
      } catch (err) {
        update(prev => ({ topicChecks: { ...prev.topicChecks, [q.q_id]: { verdict: 'warn', note: `Check failed: ${err.message}` } } }))
      }
    }
    setCheckingTopics(false)
    update({ topicCheckTargets: new Set() })
    toast(`🎯 Checked topic alignment for ${targets.length} question(s).`, 'success')
  }

  // ================= Save =================
  async function handleSave() {
    if (!token) { update({ saveError: 'Please paste an access token first.' }); return }
    if (!testName.trim()) { update({ saveError: 'Please enter a test name.' }); return }
    if (!totalQuestions) { update({ saveError: 'Add at least one question to a section first.' }); return }

    update({ saving: true, saveError: '' })
    const payload = decodeJwtPayload(token)
    const createdBy = payload?.name || 'Unknown User'
    const bdId = DEPARTMENTS.filter(d => deptSelected.has(d.value)).map(d => ({ label: d.label, value: d.value, branch_id: d.branch_id, department_id: d.value }))
    const questionsBySection = {}
    sections.forEach(s => { questionsBySection[s.name] = s.questions.map(q => q.q_id) })

    try {
      await saveTest({
        token, existingTestId, testName, testType, visibility, bdId, createdBy,
        sections: sections.map(s => ({ name: s.name, duration: s.duration })),
        questionsBySection
      })
      update({ saving: false, savedName: testName })
    } catch (err) {
      update({ saving: false, saveError: err.message })
    }
  }

  function goRunQc() { navigate('/test-qc') }
  function finishSession(destination) {
    setMp(null) // done with this test — don't carry it into the next session
    navigate(destination)
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ---- Top tab bar ---- */}
      <div className="flex items-center gap-1 border-b border-theme -mx-1 px-1 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => update({ activeTab: t.id })}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition whitespace-nowrap ${
              activeTab === t.id ? 'border-indigo-400 text-indigo-300' : 'border-transparent text-muted hover-strong'
            }`}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-1">
          <span className="text-xs text-muted2">{mode === 'edit' ? '✏️ Editing' : '✨ Creating'} · {totalQuestions} question(s) total</span>
          <button
            onClick={exitTest}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-panel bg-panel-hover text-muted"
          >
            <DoorOpen size={14} /> Exit
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save &amp; Publish
          </button>
        </div>
      </div>

      {saveError && <p className="text-sm text-red-400">{saveError}</p>}

      {/* ================= TEST DETAILS TAB ================= */}
      {activeTab === 'details' && (
        <div className="flex flex-col gap-5">
          <div className="rounded-xl border border-theme bg-panel p-4 grid sm:grid-cols-3 gap-3">
            <Field label="📛 Test Name">
              <input value={testName} onChange={e => update({ testName: e.target.value })} placeholder="e.g. Unit3_Coding_Test" className="input" />
            </Field>
            <Field label="🏷️ Test Type">
              <input value={testType} onChange={e => update({ testType: e.target.value })} className="input" />
            </Field>
            <Field label="👁️ Visibility">
              <input value={visibility} onChange={e => update({ visibility: e.target.value })} className="input" />
            </Field>
          </div>

          <div className="rounded-xl border border-theme bg-panel p-4">
            <p className="text-xs font-semibold uppercase text-muted mb-2">🏫 Departments</p>
            <div className="flex flex-wrap gap-2">
              {DEPARTMENTS.map(d => (
                <label key={d.value} className="flex items-center gap-1.5 text-xs bg-white/5 px-2.5 py-1.5 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deptSelected.has(d.value)}
                    onChange={() => update(prev => {
                      const next = new Set(prev.deptSelected)
                      if (next.has(d.value)) next.delete(d.value); else next.add(d.value)
                      return { deptSelected: next }
                    })}
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-theme bg-panel p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase text-muted">📂 Sections</p>
              <button onClick={addSection} className="flex items-center gap-1 text-xs font-semibold text-indigo-300 hover:text-indigo-200">
                <Plus size={13} /> Add Section
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {sections.map((sec, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input value={sec.name} onChange={e => updateSection(idx, { name: e.target.value })} className="input" placeholder="Section name" />
                  <input value={sec.duration} onChange={e => updateSection(idx, { duration: e.target.value })} type="number" className="input w-24" placeholder="mins" />
                  <span className="text-xs text-muted2 w-20 shrink-0">{sec.questions.length} q</span>
                  {sections.length > 1 && (
                    <button onClick={() => removeSection(idx)} className="text-red-400 hover:text-red-300 shrink-0">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-theme bg-panel p-4 grid sm:grid-cols-3 gap-3">
            <Field label="🚫 Exclude questions already used in these tests">
              <input value={excludeTestNames} onChange={e => update({ excludeTestNames: e.target.value })} placeholder="e.g. Week1_Test, Week2_Test" className="input" />
            </Field>
            <Field label="✅ Topics that SHOULD be included (optional)">
              <input value={topicsIncluded} onChange={e => update({ topicsIncluded: e.target.value })} placeholder="e.g. arrays, loops, if-else" className="input" />
            </Field>
            <Field label="🚫 Future / out-of-scope topics (optional)">
              <input value={topicsExcluded} onChange={e => update({ topicsExcluded: e.target.value })} placeholder="e.g. recursion, OOP, generics" className="input" />
            </Field>
          </div>
          <p className="text-xs text-muted2 -mt-3">
            💡 These topics are just the scope — nothing is checked automatically. On the "Add Questions" tab, tick
            whichever questions you're unsure about and hit "🎯 Check Topic Alignment" only for those.
          </p>
        </div>
      )}

      {/* ================= ADD QUESTIONS TAB (two-pane) ================= */}
      {activeTab === 'add' && (
        <div className="grid lg:grid-cols-2 gap-5">
          {/* LEFT — search & pool (one bank loaded at a time) */}
          <div className="rounded-xl border border-theme bg-panel p-4 flex flex-col gap-3">
            <h3 className="font-semibold text-sm">🔎 Add From</h3>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted2 pointer-events-none" />
                <input
                  value={term}
                  onChange={e => update({ term: e.target.value, resultsCollapsed: false })}
                  onKeyDown={e => e.key === 'Enter' && searchQbs()}
                  placeholder="Search question banks..."
                  className="input"
                  style={{ paddingLeft: '2.25rem' }}
                />
              </div>
              <button onClick={searchQbs} disabled={searching} className="px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-sm font-semibold disabled:opacity-50">
                {searching ? <Loader2 size={15} className="animate-spin" /> : '🔍'}
              </button>
            </div>

            {/* Search results collapse automatically once a bank is picked — nothing more to
                choose from until you search again or start typing a different bank name. */}
            {qbs.length > 0 && !resultsCollapsed && (
              <div className="rounded-lg border border-theme max-h-48 overflow-y-auto">
                <div className="px-3 py-1.5 text-[11px] text-muted2 bg-panel border-b border-theme">
                  👆 Click a bank to load it (only one bank is open at a time)
                </div>
                {qbs.map(qb => {
                  const isActive = activeQb?.qb_id === qb.qb_id
                  const isLoading = loadingQbId === qb.qb_id
                  return (
                    <button
                      key={qb.qb_id}
                      onClick={() => loadQb(qb)}
                      disabled={isActive || isLoading}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left transition ${isActive ? 'bg-emerald-500/5 cursor-default' : 'hover:bg-white/5'}`}
                    >
                      <Landmark size={14} className="text-muted2 shrink-0" />
                      <span className="flex-1">{qb.qb_name || qb.qb_code || qb.qb_id}</span>
                      <span className="text-xs text-muted2">{qb.questionCount ?? ''} q</span>
                      {isLoading && <Loader2 size={14} className="animate-spin text-indigo-400" />}
                      {isActive && <CheckCircle2 size={14} className="text-emerald-400" />}
                    </button>
                  )
                })}
              </div>
            )}

            {activeQb && (
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <span className="flex items-center gap-1.5 bg-indigo-500/15 text-indigo-200 px-2.5 py-1 rounded-full">
                  <RefreshCw size={11} /> Active bank: {activeQb.qb_name} ({loadedQuestions.length} left)
                </span>
                {resultsCollapsed && qbs.length > 0 && (
                  <button onClick={() => update({ resultsCollapsed: false })} className="text-muted2 hover-strong underline">
                    show search results again
                  </button>
                )}
              </div>
            )}

            {topicsScopeGiven && loadedQuestions.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={checkTopicAlignment}
                  disabled={checkingTopics || !topicCheckTargets.size}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-violet-500/20 text-violet-200 hover:bg-violet-500/30 disabled:opacity-40"
                >
                  {checkingTopics ? <Loader2 size={13} className="animate-spin" /> : <ScanEye size={13} />}
                  Check Topic Alignment ({topicCheckTargets.size} ticked)
                </button>
                <span className="text-[11px] text-muted2">tick the small checkbox on a card to mark it, unrelated to moving it</span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto max-h-[60vh]">
              <QuestionPicker
                questions={loadedQuestions}
                mode="pick"
                variant="detailed"
                onPick={pickToSection}
                topicCheckTargets={topicCheckTargets}
                onToggleTopicCheckMark={toggleTopicCheckTarget}
                excludedTestNames={parseCsv(excludeTestNames)}
                alreadyIncludedIds={alreadyIncludedIds}
                topicChecks={topicChecks}
                dupMapOverride={wholeTestDupMap}
                emptyLabel="Search and click a question bank above to load its questions."
              />
            </div>
          </div>

          {/* RIGHT — section target + its current questions */}
          <div className="rounded-xl border border-theme bg-panel p-4 flex flex-col gap-3">
            <h3 className="font-semibold text-sm flex items-center justify-between gap-2 flex-wrap">
              <span>🎯 Add To</span>
              <span className="flex items-center gap-1.5">
                {(sections.find(s => s.name === effectiveTarget)?.questions.length || 0) > 0 && (
                  <button
                    onClick={() => clearSection(sections.findIndex(s => s.name === effectiveTarget))}
                    className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25"
                  >
                    <Eraser size={13} /> Clear section
                  </button>
                )}
                {recallable.length > 0 && (
                  <button
                    onClick={recallLastRemoved}
                    className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
                  >
                    <Undo2 size={13} /> Recall ({recallable.length})
                  </button>
                )}
              </span>
            </h3>
            <div className="flex items-center gap-3">
              <select value={effectiveTarget} onChange={e => update({ targetSection: e.target.value })} className="input flex-1">
                {sections.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
              <span className="text-xs text-muted2 shrink-0">
                {sections.find(s => s.name === effectiveTarget)?.questions.length || 0} questions
              </span>
            </div>
            <p className="text-[11px] text-muted2 -mt-1">Click any question on the left to move it straight into this section.</p>

            <div className="flex-1 overflow-y-auto max-h-[60vh]">
              <QuestionPicker
                questions={sections.find(s => s.name === effectiveTarget)?.questions || []}
                mode="manage"
                variant="detailed"
                onRemove={q => removeFromSection(sections.findIndex(s => s.name === effectiveTarget), q)}
                emptyLabel="No questions added to this section yet."
              />
            </div>
          </div>
        </div>
      )}

      {/* ================= PREVIEW TEST TAB ================= */}
      {activeTab === 'preview' && (
        <div className="rounded-xl border border-theme bg-panel p-4">
          <TestPreviewContent testName={testName} sections={sections} />
        </div>
      )}

      <PostSaveDialog
        open={!!savedName}
        testName={savedName}
        onRunQc={goRunQc}
        onNotNow={() => finishSession('/manual-packing')}
        onQuit={() => finishSession('/')}
      />
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  )
}
