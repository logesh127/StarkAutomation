import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, Wand2, Loader2, Save, Eye } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { api, decodeJwtPayload } from '../../lib/api'
import { assignSectionQuestionNumbers, parseCsv, getPriorityRank, stripHtml } from '../../lib/helpers'
import { saveTest } from '../../lib/testSave'
import { DEPARTMENTS } from '../../lib/departments'
import QuestionPicker from '../../components/QuestionPicker'
import QuestionDetailModal from '../../components/QuestionDetailModal'
import PostSaveDialog from '../../components/PostSaveDialog'
import TestPreviewModal from '../../components/TestPreviewModal'

function isMcqType(q) {
  const t = (q.question_type || '').toLowerCase()
  return t.includes('mcq') || t.includes('multiple') || t.includes('fillup') || t.includes('true')
}
function isCodingType(q) {
  const t = (q.question_type || '').toLowerCase()
  return t.includes('program') || t.includes('cod')
}

// Aptitude question banks follow a confirmed naming convention: apt_qa_<topic> (Quantitative),
// apt_va_<topic> (Verbal), apt_ra_<topic> (Reasoning). When the row's Type is explicitly set to
// "Aptitude", the category comes from its own dedicated dropdown (reliable) — this text-based
// fallback only covers the case where someone still types "quant"/"verbal"/"reasoning" into the
// Language/Prefix field on an MCQ/Coding row.
function getAptitudeCategory(language) {
  const l = (language || '').toLowerCase()
  if (l.includes('apt_qa') || l.includes('quant')) return 'qa'
  if (l.includes('apt_ra') || l.includes('reason')) return 'ra'
  if (l.includes('apt_va') || l.includes('verbal')) return 'va'
  return null
}

const APT_LABELS = { qa: 'Quantitative', va: 'Verbal', ra: 'Reasoning' }

function matchesTopic(q, topic) {
  const t = topic.toLowerCase().trim()
  const hay = `${q.topic?.name || ''} ${q.sub_topic?.name || ''} ${(q.tags || []).map(x => x.name).join(' ')}`.toLowerCase()
  return hay.includes(t)
}

export default function SmartPackerPage() {
  const { token, deptIds, noteQcSource, smartPackerState: sp, setSmartPackerState: setSp } = useApp()
  const navigate = useNavigate()

  // Rows + built sections + final name live in shared context so navigating away (e.g. to
  // Test QC) and back doesn't discard an auto-built test that hasn't been saved yet.
  const rows = sp?.rows ?? [{ name: '', language: '', type: 'MCQ', aptCategory: 'qa', count: 5, topics: '', difficulty: 'Mixed' }]
  const sections = sp?.sections ?? []
  const testName = sp?.testName ?? ''
  const log = sp?.log ?? []
  const setRows = updater => setSp(prev => {
    const base = prev ?? { rows, sections, testName, log }
    return { ...base, rows: typeof updater === 'function' ? updater(base.rows) : updater }
  })
  const setSections = updater => setSp(prev => {
    const base = prev ?? { rows, sections, testName, log }
    return { ...base, sections: typeof updater === 'function' ? updater(base.sections) : updater }
  })
  const setTestName = v => setSp(prev => ({ ...(prev ?? { rows, sections, testName, log }), testName: v }))
  const setLog = updater => setSp(prev => {
    const base = prev ?? { rows, sections, testName, log }
    return { ...base, log: typeof updater === 'function' ? updater(base.log) : updater }
  })
  const [building, setBuilding] = useState(false)
  const [viewQ, setViewQ] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedName, setSavedName] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [error, setError] = useState('')

  function addRow() { setRows(prev => [...prev, { name: '', language: '', type: 'MCQ', aptCategory: 'qa', count: 5, topics: '', difficulty: 'Mixed' }]) }
  function removeRow(idx) { setRows(prev => prev.filter((_, i) => i !== idx)) }
  function updateRow(idx, patch) { setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r)) }

  function pushLog(line) { setLog(prev => [...prev, line]) }

  async function searchQbs(term, limit = 30) {
    const data = await api.searchQuestionBanks(token, { branch_id: 'all', department_id: deptIds, limit, mainDepartmentUser: true, page: 1, visibility: 'All', search: term })
    return data.results?.questionbanks || []
  }

  async function findQbsForRow(row) {
    const lang = row.language.trim().replace(/\s+/g, '_')
    const found = new Map()
    const topics = parseCsv(row.topics)
    // Explicit "Aptitude" type + its own Quant/Verbal/Reasoning dropdown is the reliable path;
    // free-text sniffing on the Language field only kicks in for MCQ/Coding rows as a fallback.
    const aptCat = row.type === 'APT' ? row.aptCategory : getAptitudeCategory(row.language)

    // Aptitude sections: search using the confirmed apt_qa_/apt_va_/apt_ra_ naming convention
    // first — per-topic if topics were given, otherwise the bare category prefix.
    if (aptCat) {
      const prefix = `apt_${aptCat}_`
      if (topics.length) {
        for (const t of topics) {
          const term = prefix + t.trim().replace(/\s+/g, '_')
          for (const q of await searchQbs(term, 30)) found.set(q.qb_id, q)
        }
      } else {
        for (const q of await searchQbs(prefix, 60)) found.set(q.qb_id, q)
      }
    }

    if (!found.size && lang) {
      for (const q of await searchQbs(`${lang}_${row.type}`, 60)) found.set(q.qb_id, q)
      for (const q of await searchQbs(lang, 60)) found.set(q.qb_id, q)
    }
    let list = [...found.values()]
    if (topics.length && list.length) {
      try {
        const data = await api.matchQbsAi(token, { qb_list: list.map(q => ({ qb_id: q.qb_id, qb_name: q.qb_name || q.qb_code || q.qb_id })), topics })
        if (data.ok && Array.isArray(data.matched_qb_ids)) {
          const matchedSet = new Set(data.matched_qb_ids)
          list = list.filter(q => matchedSet.has(q.qb_id))
        }
      } catch { /* keep unfiltered list on AI-match failure */ }
    }
    if (!list.length && lang) {
      list = await searchQbs(lang, 30) // last-resort raw search
    }
    return list
  }

  async function fetchQuestionsForQbs(qbs, limitPerQb = 150) {
    const merged = []
    for (const qb of qbs) {
      try {
        const data = await api.getQuestionsForQb(token, qb.qb_id, limitPerQb)
        const results = data.results || data
        const rows = results.non_group_questions || results.questions || []
        rows.forEach(r => { r._qb_name = qb.qb_name || qb.qb_code || qb.qb_id })
        merged.push(...rows)
      } catch { /* skip this qb */ }
    }
    return merged
  }

  async function buildAll() {
    if (!token) { setError('Paste an access token first.'); return }
    const validRows = rows.filter(r => r.name.trim() && r.count > 0 && (r.type === 'APT' || r.language.trim()))
    if (!validRows.length) { setError('Add at least one section with a name, language/prefix (or Aptitude category), and count.'); return }

    setBuilding(true); setError(''); setLog([]); setSections([])
    const builtSections = []

    for (const row of validRows) {
      const isApt = row.type === 'APT'
      const label = isApt ? `Aptitude — ${APT_LABELS[row.aptCategory]}` : `${row.language}_${row.type}`
      pushLog(`\n=== Section "${row.name}" (${label}) ===`)
      const qbs = await findQbsForRow(row)
      pushLog(`📚 Matched ${qbs.length} question bank(s): ${qbs.map(q => q.qb_name || q.qb_id).join(', ') || '(none)'}`)
      if (!qbs.length) { builtSections.push({ name: row.name, duration: row.type === 'COD' ? '60' : '30', questions: [] }); continue }

      const pool = await fetchQuestionsForQbs(qbs)
      pushLog(`📦 Pulled ${pool.length} question(s) total.`)
      // Aptitude question banks are inherently MCQ-style — filter the same way as MCQ rows.
      const typeFilter = row.type === 'COD' ? isCodingType : isMcqType
      const filtered = pool.filter(typeFilter)

      const candidates = filtered.slice(0, 60).map(q => ({
        q_id: q.q_id, qb_name: q._qb_name, question_type: q.question_type,
        topic: q.topic?.name || '', sub_topic: q.sub_topic?.name || '',
        difficulty: q.manual_difficulty || q.automatic_difficulty || '-',
        priority_tier: getPriorityRank(q), summary: stripHtml(q.question_data || '').slice(0, 100)
      }))

      const topics = parseCsv(row.topics)
      let pickedIds = []

      if (topics.length > 1) {
        // Multiple topics in one row — split the count evenly across topics (deterministic
        // local math, not an AI call, so it's reliable and doesn't cost tokens), picking
        // separately from whichever candidates actually match each topic.
        const base = Math.floor(row.count / topics.length)
        const remainder = row.count - base * topics.length
        pushLog(`🔀 Splitting ${row.count} evenly across ${topics.length} topics: ` +
          topics.map((t, i) => `${t.trim()}:${base + (i < remainder ? 1 : 0)}`).join(', '))
        for (let i = 0; i < topics.length; i++) {
          const subCount = base + (i < remainder ? 1 : 0)
          const topicPool = filtered.filter(q => matchesTopic(q, topics[i]))
            .sort((a, b) => getPriorityRank(a) - getPriorityRank(b))
          const chosenForTopic = topicPool.slice(0, subCount)
          pickedIds.push(...chosenForTopic.map(q => q.q_id))
          pushLog(`   → "${topics[i].trim()}": picked ${chosenForTopic.length} / ${subCount} (from ${topicPool.length} candidates)`)
        }
      } else {
        try {
          const packed = await api.packTest(token, {
            candidates,
            requirement: { language: row.language, mcq: { count: row.type !== 'COD' ? row.count : 0, topics: row.topics, difficulty: row.difficulty }, coding: { count: row.type === 'COD' ? row.count : 0, topics: row.topics, difficulty: row.difficulty } }
          })
          pickedIds = row.type !== 'COD' ? (packed.packing?.mcq_selected || []) : (packed.packing?.coding_selected || [])
        } catch { /* fall back below */ }

        if (!pickedIds.length) {
          pickedIds = filtered.slice().sort((a, b) => getPriorityRank(a) - getPriorityRank(b)).slice(0, row.count).map(q => q.q_id)
          pushLog('⚙️ AI packing unavailable — used local verification-priority fallback.')
        }
      }

      const byId = new Map(filtered.map(q => [q.q_id, q]))
      const chosen = pickedIds.map(id => byId.get(id)).filter(Boolean).map(q => ({ ...q, _sectionName: row.name }))
      assignSectionQuestionNumbers(chosen)
      pushLog(`✅ Picked ${chosen.length} / ${row.count} requested.`)
      builtSections.push({ name: row.name, duration: row.type === 'COD' ? '60' : '30', questions: chosen })
    }

    setSections(builtSections)
    setBuilding(false)
  }

  function removeQuestion(idx, q) {
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, questions: s.questions.filter(x => x.q_id !== q.q_id) } : s))
  }

  const totalPicked = sections.reduce((n, s) => n + s.questions.length, 0)

  async function handleSave() {
    if (!testName.trim()) { setError('Give the test a name first.'); return }
    setSaving(true); setError('')
    const payload = decodeJwtPayload(token)
    const createdBy = payload?.name || 'Unknown User'
    const bdId = [DEPARTMENTS[0]].map(d => ({ label: d.label, value: d.value, branch_id: d.branch_id, department_id: d.value }))
    const questionsBySection = {}
    sections.forEach(s => { questionsBySection[s.name] = s.questions.map(q => q.q_id) })

    try {
      await saveTest({ token, testName, testType: 'Manual Assessment Test', visibility: 'Within Department', bdId, createdBy, sections: sections.map(s => ({ name: s.name, duration: s.duration })), questionsBySection })
      setSavedName(testName)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function goRunQc() { noteQcSource(testName); navigate('/test-qc') }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Smart Test Packer</h1>
        <p className="text-sm text-muted">Describe each section, and Starklight finds and picks the questions automatically.</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-theme">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-muted text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Section</th>
              <th className="px-3 py-2 font-medium">Language / Aptitude</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Count</th>
              <th className="px-3 py-2 font-medium">Topics</th>
              <th className="px-3 py-2 font-medium">Difficulty</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-3 py-2"><input value={r.name} onChange={e => updateRow(i, { name: e.target.value })} className="input" placeholder="e.g. Python" /></td>
                <td className="px-3 py-2">
                  {r.type === 'APT' ? (
                    <select value={r.aptCategory} onChange={e => updateRow(i, { aptCategory: e.target.value })} className="input">
                      <option value="qa">🔢 Quantitative (apt_qa_)</option>
                      <option value="va">📖 Verbal (apt_va_)</option>
                      <option value="ra">🧩 Reasoning (apt_ra_)</option>
                    </select>
                  ) : (
                    <input value={r.language} onChange={e => updateRow(i, { language: e.target.value })} className="input" placeholder="e.g. Python" />
                  )}
                </td>
                <td className="px-3 py-2">
                  <select value={r.type} onChange={e => updateRow(i, { type: e.target.value })} className="input">
                    <option value="MCQ">MCQ</option>
                    <option value="COD">Coding</option>
                    <option value="APT">🧠 Aptitude</option>
                  </select>
                </td>
                <td className="px-3 py-2"><input type="number" value={r.count} onChange={e => updateRow(i, { count: parseInt(e.target.value, 10) || 0 })} className="input w-20" /></td>
                <td className="px-3 py-2"><input value={r.topics} onChange={e => updateRow(i, { topics: e.target.value })} className="input" placeholder="comma separated" /></td>
                <td className="px-3 py-2"><input value={r.difficulty} onChange={e => updateRow(i, { difficulty: e.target.value })} className="input" /></td>
                <td className="px-3 py-2">{rows.length > 1 && <button onClick={() => removeRow(i)}><Trash2 size={15} className="text-red-400" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button onClick={addRow} className="flex items-center gap-1.5 justify-center text-sm font-semibold px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-dashed border-theme w-fit">
        <Plus size={16} /> Add Section
      </button>

      <button
        onClick={buildAll}
        disabled={building}
        className="flex items-center gap-2 justify-center rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 font-semibold hover:opacity-90 disabled:opacity-50"
      >
        {building ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />} Auto-Build Test
      </button>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {log.length > 0 && (
        <pre className="text-xs bg-black/40 border border-theme rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">{log.join('\n')}</pre>
      )}

      {sections.length > 0 && (
        <>
          <div className="rounded-xl border border-theme bg-panel p-4">
            <input value={testName} onChange={e => setTestName(e.target.value)} placeholder="Final test name" className="input mb-4" />
            {sections.map((sec, idx) => (
              <div key={sec.name} className="mb-4">
                <h3 className="font-semibold text-sm mb-2">📂 {sec.name} ({sec.questions.length})</h3>
                <QuestionPicker questions={sec.questions} mode="manage" variant="detailed" onRemove={q => removeQuestion(idx, q)} onView={setViewQ} emptyLabel="No questions picked for this section." />
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setPreviewOpen(true)}
              disabled={!totalPicked}
              className="flex items-center gap-2 justify-center rounded-xl bg-white/10 hover:bg-white/15 px-4 py-3 font-semibold disabled:opacity-40"
            >
              <Eye size={18} /> Preview Test
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !totalPicked}
              className="flex-1 flex items-center gap-2 justify-center rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-3 font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              Save & Publish ({totalPicked} question(s))
            </button>
          </div>
        </>
      )}

      <QuestionDetailModal question={viewQ} onClose={() => setViewQ(null)} />
      <TestPreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} testName={testName} sections={sections} />
      <PostSaveDialog open={!!savedName} testName={savedName} onRunQc={goRunQc} onNotNow={() => navigate('/smart-packer')} onQuit={() => navigate('/')} />
    </div>
  )
}
