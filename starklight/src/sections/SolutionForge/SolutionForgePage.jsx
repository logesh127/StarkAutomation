import { useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Loader2, Landmark, FileText, Hammer, FolderOpen, Languages, UploadCloud,
  CheckCircle2, XCircle, AlertTriangle, StopCircle, ArrowLeftCircle, Check, Copy,
  ChevronDown, ChevronRight, Wrench, ServerCog, RefreshCw
} from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useToast } from '../../context/ToastContext'
import { api } from '../../lib/api'
import { forgeSolution } from '../../lib/forge'
import {
  stripHtml, groupBySection, assignSectionQuestionNumbers,
  bestSolutionOf, allSolutionsOf, testCasesOf, isForgeable
} from '../../lib/helpers'
import { copyRich } from '../../lib/clipboard'
import { StepHeader, StepNav } from '../../components/Stepper'
import SkeletonRows from '../../components/SkeletonRows'

const STEPS = [
  { id: 'source', label: 'Pick Source', icon: FileText },
  { id: 'questions', label: 'Choose Questions', icon: FolderOpen },
  { id: 'language', label: 'Language', icon: Languages },
  { id: 'forge', label: 'Generate & Push', icon: Hammer }
]

// The languages actually in use. The portal's full catalogue is 26 (see
// PORTAL_LANGUAGES in backend/server.js) but only these are wanted, so only
// these are offered — the rest are still accepted on the way out if a
// question already has a solution in one.
//
// Values are the portal's exact wire names; LANGUAGE_LABEL carries the
// version the portal actually runs, which is what the generated code has to
// target. Do not send the labels — "Java (21)" is not a language the portal
// knows; "Java21" is.
const LANGUAGES = ['Java17', 'Java21', 'C', 'C++', 'Python', 'Plain Javascript']

const LANGUAGE_LABEL = {
  'Java17': 'Java (17)',
  'Java21': 'Java (21)',
  'C': 'C (17)',
  'C++': 'C++ (17)',
  'Python': 'Python (3.8)',
  'Plain Javascript': 'Plain Javascript (10)'
}

// Which local toolchain verifies which portal language. A language absent
// here cannot be compiled/run on this machine, so it could never reach
// `verified` — and Solution Forge never pushes anything unverified. Those are
// still listed (greyed out) so the catalogue is visible, but not selectable.
//
// Note the names that LOOK like they match but don't: "Plain Javascript" is
// Node, not Java; "Cc++11" is C; "C++c++11" is C++; "Java_jdbc" needs a
// database, so it isn't verifiable here.
const PROBE_KEY = {
  'Python': 'Python', 'Python3.12': 'Python',
  'Java': 'Java', 'Java17': 'Java', 'Java21': 'Java',
  'C': 'C', 'Cc++11': 'C',
  'C++': 'C++', 'C++c++11': 'C++',
  'Plain Javascript': 'JavaScript'
}

// Where the local toolchain's version differs from the portal's, so generated
// code can pass here and still fail there. Surfaced in the picker rather than
// hidden, because "verified locally" is only worth as much as the match.
const VERSION_CAVEAT = {
  'Python': 'Portal runs Python 3.8, verified here against the locally installed Python 3.x — ' +
            '3.9+ syntax would pass here and fail there. The generator is told to target 3.8.',
  'Plain Javascript': 'Portal runs Node 10, verified here against the local Node — newer syntax ' +
            'would pass here and fail there. The generator is told to target Node 10.'
}

// Shared immutable fallbacks — see the note where these are used.
const EMPTY_ARR = []
const EMPTY_OBJ = {}

// Confirmed shape of GET /api/questions/test/{id} — full question objects
// already grouped by section. This is why Solution Forge needs no question-bank
// scanning: the test endpoint returns everything required to generate AND push.
function parseQuestionsByTestResponse(root) {
  const arr = Array.isArray(root) ? root : Array.isArray(root?.results) ? root.results : Array.isArray(root?.data) ? root.data : null
  if (!arr) return []
  const merged = []
  for (const section of arr) {
    if (!section || typeof section !== 'object') continue
    const sectionName = section.name || 'Section'
    const lists = [
      ...(Array.isArray(section.non_group_questions) ? section.non_group_questions : []),
      ...(Array.isArray(section.group_questions) ? section.group_questions : [])
    ]
    for (const q of lists) {
      if (q && typeof q === 'object' && q.q_id) {
        if (!q._sectionName) q._sectionName = sectionName
        merged.push(q)
      }
    }
  }
  return merged
}

export default function SolutionForgePage() {
  const { token, deptIds, forgeState, setForgeState } = useApp()
  const toast = useToast()

  const [step, setStep] = useState(0)
  const [furthest, setFurthest] = useState(0)

  const [mode, setMode] = useState('test')
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState([])
  const [searching, setSearching] = useState(false)
  const [opening, setOpening] = useState(null)
  const [error, setError] = useState('')

  // Multiple target languages can be generated in one run; `bestLang` decides
  // which one the portal ends up flagging as "Best Solution".
  const [languages, setLanguages] = useState(['Python'])
  const [bestLang, setBestLang] = useState('Python')
  const [toolchains, setToolchains] = useState(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' })
  const [expanded, setExpanded] = useState({})
  const [pushing, setPushing] = useState({})
  const cancelRef = useRef(false)

  // Stable fallbacks: `forgeState?.questions || []` would hand a brand-new array
  // to useMemo on every render and defeat every memo below it.
  const source = forgeState?.source || null
  const questions = forgeState?.questions || EMPTY_ARR
  const picked = forgeState?.picked || EMPTY_OBJ
  const results = forgeState?.results || EMPTY_OBJ

  function update(patch) {
    setForgeState(prev => ({ ...(prev || {}), ...(typeof patch === 'function' ? patch(prev || {}) : patch) }))
  }
  function goTo(i) {
    setStep(i)
    setFurthest(f => Math.max(f, i))
  }

  const { order, bySection } = useMemo(() => groupBySection(questions), [questions])
  const forgeable = useMemo(() => questions.filter(isForgeable), [questions])
  const pickedList = useMemo(() => forgeable.filter(q => picked[q.q_id]), [forgeable, picked])

  // How many of the picked questions ALREADY have a real solution in each
  // language — so the picker can show what's already covered and you can aim
  // at the gaps. Counted on actual solution CONTENT, never on the language
  // merely appearing in `multilanguage`/`solution`: a question can list a
  // language with an empty `solutiondata`, which is not a solution.
  const existingByLang = useMemo(() => {
    const counts = {}
    for (const q of pickedList) {
      const sols = q.programming_question?.solution || []
      for (const s of sols) {
        const has = Array.isArray(s.solutiondata) &&
          s.solutiondata.some(d => d && typeof d.solution === 'string' && d.solution.trim())
        if (has && s.language) {
          const k = String(s.language).toLowerCase()
          counts[k] = (counts[k] || 0) + 1
        }
      }
    }
    return counts
  }, [pickedList])

  // ---------- Step 1: source ----------
  async function runSearch() {
    if (!token) { setError('Paste an access token first.'); return }
    if (!term.trim() && mode === 'qb') return
    setSearching(true); setError('')
    try {
      if (mode === 'test') {
        const body = { branch_id: 'All', department_id: deptIds, limit: 25, mainDepartmentUser: true, page: 1 }
        if (term.trim()) body.search = term.trim()
        const data = await api.searchTests(token, body)
        const r = data.results || data.data || data
        const rows = Array.isArray(r) ? r
          : Array.isArray(r?.tests) ? r.tests
          : Array.isArray(r?.testList) ? r.testList
          : Array.isArray(r?.data) ? r.data
          : []
        setHits(rows.map(t => ({
          id: t._id || t.test_id || t.testId || t.id,
          name: t.testName || t.test_name || t.t_name || t.name || '(unnamed)',
          meta: t.testType || t.test_type || ''
        })))
      } else {
        const data = await api.searchQuestionBanks(token, {
          branch_id: 'all', department_id: deptIds, limit: 30, mainDepartmentUser: true, page: 1, visibility: 'All', search: term.trim()
        })
        setHits((data.results?.questionbanks || []).map(qb => ({
          id: qb.qb_id,
          name: qb.qb_name || qb.qb_code || qb.qb_id,
          meta: qb.questionCount != null ? `${qb.questionCount} q` : ''
        })))
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSearching(false)
    }
  }

  async function openSource(hit) {
    setOpening(hit.id); setError('')
    try {
      let merged = []
      if (mode === 'test') {
        // Straight from the test endpoint — full objects, no QB lookup needed.
        merged = parseQuestionsByTestResponse(await api.getQuestionsForTest(token, hit.id))
      } else {
        const data = await api.getQuestionsForQb(token, hit.id, 150)
        const r = data.results || data
        merged = r.non_group_questions || r.questions || []
        merged.forEach(x => { x._qb_name = hit.name })
      }
      if (!merged.length) { setError('No questions found for that selection.'); return }
      assignSectionQuestionNumbers(merged)

      const canForge = merged.filter(isForgeable)
      if (!canForge.length) {
        setError('None of these questions are programming questions with test cases, so there is nothing to generate.')
        return
      }

      update({ source: { label: hit.name, kind: mode }, questions: merged, picked: {}, results: {} })
      goTo(1)
      toast(`Loaded ${merged.length} question(s) — ${canForge.length} can have solutions generated.`, 'success')
    } catch (err) {
      setError(err.message)
    } finally {
      setOpening(null)
    }
  }

  // ---------- Step 3: toolchain probe ----------
  async function checkToolchains() {
    try {
      const r = await api.toolchainCheck()
      setToolchains(r.toolchains || null)
    } catch {
      setToolchains(null)
    }
  }

  // ---------- Step 4: forge ----------
  // `onlyFailed` re-runs just the language/question pairs that did NOT verify,
  // leaving everything already passing untouched — a retry must never discard
  // a good solution to re-roll the dice on it.
  async function forgeAll(list, { onlyFailed = false } = {}) {
    if (!token) { toast('Paste an access token first.', 'error'); return }
    if (!list.length) { toast('Pick at least one question first.', 'error'); return }
    if (!languages.length) { toast('Pick at least one target language.', 'error'); return }

    const needsWork = (q, lang) => {
      if (!onlyFailed) return true
      const r = (results[q.q_id] || {})[lang]
      return !r || r.status !== 'verified'
    }

    const work = []
    for (const q of list) for (const lang of languages) if (needsWork(q, lang)) work.push([q, lang])
    if (!work.length) {
      toast('Nothing to retry — everything selected is already verified.', 'info')
      return
    }

    cancelRef.current = false
    setRunning(true)
    const totalUnits = work.length
    setProgress({ done: 0, total: totalUnits, current: '' })

    let done = 0
    let envStop = false

    for (const q of list) {
      if (cancelRef.current || envStop) break

      for (const lang of languages) {
        if (cancelRef.current || envStop) break
        if (!needsWork(q, lang)) continue
        setProgress({ done, total: totalUnits, current: `Q${q._qNum ?? ''} · ${lang}` })

        // Results are keyed q_id -> language, so generating several languages
        // for one question doesn't overwrite the earlier ones.
        update(prev => ({
          results: {
            ...(prev.results || {}),
            [q.q_id]: { ...((prev.results || {})[q.q_id] || {}), [lang]: { status: 'working', phase: 'generating' } }
          }
        }))

        const res = await forgeSolution({
          token, question: q, language: lang,
          onProgress: p => update(prev => ({
            results: {
              ...(prev.results || {}),
              [q.q_id]: { ...((prev.results || {})[q.q_id] || {}), [lang]: { status: 'working', ...p } }
            }
          }))
        })

        update(prev => ({
          results: {
            ...(prev.results || {}),
            [q.q_id]: {
              ...((prev.results || {})[q.q_id] || {}),
              [lang]: { status: res.ok ? 'verified' : 'failed', ...res }
            }
          }
        }))

        done++
        setProgress({ done, total: totalUnits, current: '' })

        // A missing compiler fails every remaining attempt in that language
        // identically — stop rather than burning AI calls on a guaranteed
        // environment failure.
        if (res.environmentProblem) {
          toast(res.reason, 'error')
          envStop = true
        }
      }
    }

    const stopped = cancelRef.current
    cancelRef.current = false
    setRunning(false)
    toast(
      stopped ? `Stopped after ${done} of ${totalUnits}.` : `Finished ${done} generation(s).`,
      stopped ? 'info' : 'success'
    )
  }

  async function pushOne(q) {
    const byLang = results[q.q_id] || {}
    // Only verified solutions are ever sent — a failed generation is never pushed.
    const verified = Object.entries(byLang)
      .filter(([, r]) => r && r.status === 'verified')
      .map(([lang, r]) => ({ language: lang, code: r.code, snippet: r.snippet }))

    if (!verified.length) {
      toast('Nothing verified for this question — only passing solutions can be pushed.', 'error')
      return
    }

    // The chosen best language only counts if it actually verified; otherwise
    // fall back to one that did, so we never flag a failing solution as best.
    const bestHere = verified.some(v => v.language === bestLang) ? bestLang : verified[0].language

    setPushing(p => ({ ...p, [q.q_id]: true }))
    try {
      const r = await api.pushSolution(token, q.q_id, {
        solutions: verified,
        bestLanguage: bestHere,
        rawQuestion: q
      })
      update(prev => {
        const cur = { ...((prev.results || {})[q.q_id] || {}) }
        verified.forEach(v => { cur[v.language] = { ...cur[v.language], pushed: true, pushError: null } })
        return { results: { ...(prev.results || {}), [q.q_id]: cur } }
      })
      toast(`Pushed ${verified.map(v => v.language).join(', ')} for Q${q._qNum ?? ''} (best: ${bestHere}).`, 'success')
      return r
    } catch (err) {
      update(prev => {
        const cur = { ...((prev.results || {})[q.q_id] || {}) }
        verified.forEach(v => { cur[v.language] = { ...cur[v.language], pushError: err.message } })
        return { results: { ...(prev.results || {}), [q.q_id]: cur } }
      })
      toast(`Push failed for Q${q._qNum ?? ''}: ${err.message}`, 'error')
    } finally {
      setPushing(p => ({ ...p, [q.q_id]: false }))
    }
  }

  async function pushAllVerified() {
    const list = pickedList.filter(q => {
      const byLang = results[q.q_id] || {}
      return Object.values(byLang).some(r => r && r.status === 'verified' && !r.pushed)
    })
    if (!list.length) { toast('Nothing verified and unpushed to send.', 'info'); return }
    for (const q of list) await pushOne(q)
  }

  const tally = useMemo(() => {
    const t = { verified: 0, failed: 0, pushed: 0, pending: 0 }
    for (const q of pickedList) {
      const byLang = results[q.q_id] || {}
      for (const lang of languages) {
        const r = byLang[lang]
        if (!r) t.pending++
        else if (r.pushed) t.pushed++
        else if (r.status === 'verified') t.verified++
        else if (r.status === 'failed') t.failed++
        else t.pending++
      }
    }
    return t
  }, [pickedList, results, languages])

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold mb-0.5 flex items-center gap-2">
            <Hammer size={22} className="text-accent-pill" />
            {source ? source.label : 'Solution Forge'}
          </h1>
          <p className="text-sm text-muted">
            {source
              ? `${questions.length} question(s) · ${forgeable.length} eligible`
              : 'Add a solution in another language — generated, actually run against the real test cases, then pushed.'}
          </p>
        </div>
        {source && (
          <button
            onClick={() => { update({ source: null, questions: [], picked: {}, results: {} }); goTo(0) }}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-panel bg-panel-hover text-muted"
          >
            <ArrowLeftCircle size={16} /> Different source
          </button>
        )}
      </div>

      <StepHeader steps={STEPS} current={step} furthest={furthest} onGo={goTo} />

      <AnimatePresence mode="wait">
        {/* ============ STEP 1 — SOURCE ============ */}
        {step === 0 && (
          <StepPane key="source">
            <div className="flex gap-2">
              <div className="flex rounded-lg border border-theme overflow-hidden shrink-0">
                {[['test', 'Test', FileText], ['qb', 'Question Bank', Landmark]].map(([id, label, Icon]) => (
                  <button
                    key={id}
                    onClick={() => { setMode(id); setHits([]) }}
                    className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition ${
                      mode === id ? 'bg-accent-pill text-accent-pill' : 'text-muted bg-panel-hover'
                    }`}
                  >
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted2 pointer-events-none" />
                <input
                  value={term}
                  onChange={e => setTerm(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && runSearch()}
                  placeholder={mode === 'test' ? 'Search tests by name…' : 'Search question banks…'}
                  className="input"
                  style={{ paddingLeft: '2.25rem' }}
                />
              </div>
              <button onClick={runSearch} disabled={searching} className="px-4 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-sm font-semibold disabled:opacity-50">
                {searching ? <Loader2 size={16} className="animate-spin" /> : 'Search'}
              </button>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
            {searching && !hits.length && <SkeletonRows />}

            {hits.length > 0 && (
              <div className="rounded-xl border border-theme overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-panel text-muted text-left">
                    <tr>
                      <th className="px-4 py-2 font-medium">{mode === 'test' ? 'Test Name' : 'Question Bank'}</th>
                      <th className="px-4 py-2 font-medium">Info</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {hits.map((h, i) => (
                      <tr key={h.id || i} className="bg-panel-hover">
                        <td className="px-4 py-2.5">{h.name}</td>
                        <td className="px-4 py-2.5 text-muted2">{h.meta || '—'}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => openSource(h)} disabled={opening === h.id} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-accent-pill text-accent-pill disabled:opacity-50">
                            {opening === h.id ? 'Opening…' : 'Open'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </StepPane>
        )}

        {/* ============ STEP 2 — QUESTIONS ============ */}
        {step === 1 && (
          <StepPane key="questions">
            <div className="rounded-xl border border-theme bg-panel p-4">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <p className="text-xs text-muted">
                  Only programming questions that have test cases are listed — everything else can't be verified,
                  so it isn't offered.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => update({ picked: Object.fromEntries(forgeable.map(q => [q.q_id, true])) })}
                    className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-panel bg-panel-hover text-muted"
                  >
                    Select all ({forgeable.length})
                  </button>
                  <button
                    onClick={() => update({ picked: {} })}
                    className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-panel bg-panel-hover text-muted"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {order.map(sectionName => {
                const rows = (bySection[sectionName] || []).filter(isForgeable)
                if (!rows.length) return null
                return (
                  <div key={sectionName} className="mb-4">
                    <h3 className="text-xs font-semibold uppercase text-muted mb-2">
                      📂 {sectionName} <span className="text-muted2 font-normal normal-case">({rows.length} eligible)</span>
                    </h3>
                    <div className="flex flex-col gap-1.5">
                      {rows.map(q => {
                        const on = !!picked[q.q_id]
                        const existing = allSolutionsOf(q)
                        const cases = testCasesOf(q)
                        return (
                          <button
                            key={q.q_id}
                            onClick={() => update(prev => ({ picked: { ...(prev.picked || {}), [q.q_id]: !on } }))}
                            className={`flex items-start gap-2.5 text-left px-3 py-2.5 rounded-lg border transition ${
                              on ? 'border-indigo-400/50 bg-accent-pill' : 'border-theme bg-panel-hover'
                            }`}
                          >
                            <span className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              on ? 'bg-indigo-500 border-indigo-400' : 'border-white/25'
                            }`}>
                              {on && <Check size={11} className="text-white" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2 flex-wrap mb-0.5">
                                <span className="text-[11px] font-mono text-muted2">Q{q._qNum ?? '?'}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-panel text-muted">
                                  {cases.length} test case(s)
                                </span>
                                {existing.map(s => (
                                  <span key={s.language} className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                    s.best ? 'bg-emerald-500/15 text-emerald-300' : 'bg-panel text-muted2'
                                  }`}>
                                    {s.language}{s.best ? ' ★' : ''}
                                  </span>
                                ))}
                              </span>
                              <span className="block text-xs text-body-app leading-snug">
                                {stripHtml(q.question_data || '').slice(0, 120)}…
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            <StepNav
              onBack={() => goTo(0)} backLabel="Back to source"
              onNext={() => { goTo(2); checkToolchains() }}
              nextLabel={`Choose language (${pickedList.length} picked)`}
              nextDisabled={!pickedList.length}
            />
          </StepPane>
        )}

        {/* ============ STEP 3 — LANGUAGE ============ */}
        {step === 2 && (
          <StepPane key="language">
            <div className="rounded-xl border border-theme bg-panel p-5">
              <h2 className="font-semibold mb-1">Target language</h2>
              <p className="text-sm text-muted mb-4">
                The solution is generated in this language, then compiled and run here against every test case
                before anything is pushed.
              </p>

              <p className="text-xs text-muted2 mb-2">
                Tick every language you want generated. The bracketed version is what the portal runs, so
                that's what the generated code targets.
                <span className="text-emerald-400/90"> has</span> means every picked question already has a
                solution in that language. <AlertTriangle size={11} className="inline text-amber-400" /> means
                it can't be compiled or run on this machine, so it can't be verified — it will still be
                generated for you to review, but only verified languages are ever pushed.
              </p>
              <p className="text-xs text-muted2 mb-2">
                Only the languages you tick, plus any solution the question already has, are saved to the
                portal. Nothing else is added or removed.
              </p>
              <div className="flex flex-wrap gap-2 mb-5">
                {LANGUAGES.map(l => {
                  const on = languages.includes(l)
                  const probeKey = PROBE_KEY[l]
                  const tc = probeKey ? toolchains?.[probeKey] : null
                  // Two distinct reasons verification can't happen, and they
                  // read differently: there is no local runner for the language
                  // at all, vs. there is one but the toolchain isn't installed.
                  // Neither blocks SELECTION — you can generate for anything.
                  // It only means the result can't be verified, and Solution
                  // Forge still won't push what it couldn't actually run.
                  const noRunner = !probeKey
                  const unavailable = !noRunner && toolchains && tc && !tc.available
                  const cantVerify = noRunner || unavailable
                  const already = existingByLang[l.toLowerCase()] || 0
                  const allHave = already > 0 && already === pickedList.length
                  const why = [
                    noRunner ? `No local runner for ${l} — it can't be verified here, so it won't be pushed.`
                      : unavailable ? `${probeKey} toolchain isn't installed, so ${l} can't be verified here.`
                      : null,
                    VERSION_CAVEAT[l] || null,
                    already ? `${already} of ${pickedList.length} picked question(s) already have a ${l} solution.` : null
                  ].filter(Boolean).join(' ') || undefined
                  return (
                    <button
                      key={l}
                      title={why}
                      onClick={() => setLanguages(cur => {
                        const next = cur.includes(l) ? cur.filter(x => x !== l) : [...cur, l]
                        if (!next.length) return cur // never allow an empty selection
                        // Keep "best" pointing at something still selected.
                        if (!next.includes(bestLang)) setBestLang(next[0])
                        return next
                      })}
                      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium border transition ${
                        on ? 'border-indigo-400/60 bg-accent-pill text-accent-pill' : 'border-theme text-muted bg-panel-hover'
                      } ${!on && cantVerify ? 'opacity-60' : ''}`}
                    >
                      <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                        on ? 'bg-indigo-500 border-indigo-400' : 'border-white/25'
                      }`}>
                        {on && <Check size={9} className="text-white" />}
                      </span>
                      {LANGUAGE_LABEL[l] || l}
                      {allHave && <span className="text-[10px] text-emerald-400/90" title={why}>has</span>}
                      {cantVerify && <AlertTriangle size={12} className="text-amber-400" title={why} />}
                    </button>
                  )
                })}
              </div>

              {languages.length > 1 && (
                <div className="mb-5">
                  <h3 className="text-xs font-semibold uppercase text-muted mb-2">
                    ★ Which one is the Best Solution?
                  </h3>
                  <p className="text-[11px] text-muted2 mb-2">
                    The portal allows exactly one per question — every other language gets un-flagged on save.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {languages.map(l => (
                      <button
                        key={l}
                        onClick={() => setBestLang(l)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                          bestLang === l
                            ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300'
                            : 'border-theme text-muted bg-panel-hover'
                        }`}
                      >
                        <span className={`w-3 h-3 rounded-full border flex items-center justify-center shrink-0 ${
                          bestLang === l ? 'border-emerald-400' : 'border-white/25'
                        }`}>
                          {bestLang === l && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                        </span>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-theme bg-panel p-3">
                <div className="flex items-center gap-2 mb-2">
                  <ServerCog size={14} className="text-muted2" />
                  <span className="text-xs font-semibold text-muted">Local toolchains</span>
                  <button onClick={checkToolchains} className="ml-auto text-[11px] text-muted2 hover-strong">re-check</button>
                </div>
                {!toolchains ? (
                  <p className="text-xs text-muted2">Checking…</p>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-1.5">
                    {Object.entries(toolchains).map(([lang, info]) => (
                      <div key={lang} className="flex items-center gap-2 text-xs">
                        {info.available
                          ? <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                          : <XCircle size={13} className="text-red-400 shrink-0" />}
                        <span className="text-body-app">{lang}</span>
                        <span className="text-muted2 truncate">{info.available ? info.version : 'not installed'}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-muted2 mt-2">
                  A language without its compiler can't be verified here. Install it, or set the
                  <code className="mx-1 px-1 rounded bg-black/30">EXTRA_TOOLCHAIN_PATHS</code>
                  env var on the backend if it's installed somewhere unusual.
                </p>
              </div>
            </div>

            <StepNav
              onBack={() => goTo(1)} backLabel="Back to questions"
              onNext={() => goTo(3)}
              nextLabel={`Generate ${languages.length} language(s) × ${pickedList.length} question(s)`}
            />
          </StepPane>
        )}

        {/* ============ STEP 4 — FORGE & PUSH ============ */}
        {step === 3 && (
          <StepPane key="forge">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => forgeAll(pickedList)}
                disabled={running}
                className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 hover:opacity-90 disabled:opacity-40"
              >
                {running ? <Loader2 size={15} className="animate-spin" /> : <Hammer size={15} />}
                Generate &amp; verify — {languages.join(', ')}
              </button>
              {running && (
                <button onClick={() => { cancelRef.current = true; toast('Stopping after the current question…', 'info') }} className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30">
                  <StopCircle size={15} /> Stop
                </button>
              )}
              {/* Re-runs only what didn't verify. Anything already passing is
                  left exactly as it is — never re-rolled. */}
              <button
                onClick={() => forgeAll(pickedList, { onlyFailed: true })}
                disabled={running || !(tally.failed + tally.pending)}
                title="Generate again for every language that hasn't verified yet, leaving passing ones untouched"
                className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 disabled:opacity-40"
              >
                <RefreshCw size={15} /> Retry failed ({tally.failed + tally.pending})
              </button>
              <button
                onClick={pushAllVerified}
                disabled={running || !tally.verified}
                className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-600 to-green-600 hover:opacity-90 disabled:opacity-40"
              >
                <UploadCloud size={15} /> Push all verified ({tally.verified})
              </button>
            </div>

            {running && progress.total > 0 && (
              <div>
                <p className="text-xs text-muted mb-1.5">
                  {progress.done} / {progress.total} done {progress.current && <span className="text-muted2">· working on {progress.current}</span>}
                </p>
                <div className="h-1.5 rounded-full bg-panel overflow-hidden">
                  <motion.div className="h-full bg-gradient-to-r from-indigo-400 to-violet-400" animate={{ width: `${(progress.done / progress.total) * 100}%` }} transition={{ duration: 0.25 }} />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Tally label="Verified" value={tally.verified} cls="text-emerald-400" />
              <Tally label="Pushed" value={tally.pushed} cls="text-sky-400" />
              <Tally label="Failed" value={tally.failed} cls="text-red-400" />
              <Tally label="Not run" value={tally.pending} cls="text-muted2" />
            </div>

            <div className="flex flex-col gap-2">
              {pickedList.map(q => (
                <ForgeRow
                  key={q.q_id}
                  q={q}
                  byLang={results[q.q_id]}
                  languages={languages}
                  bestLang={bestLang}
                  pushing={!!pushing[q.q_id]}
                  expanded={!!expanded[q.q_id]}
                  onToggle={() => setExpanded(e => ({ ...e, [q.q_id]: !e[q.q_id] }))}
                  onPush={() => pushOne(q)}
                  onRetry={() => forgeAll([q])}
                  running={running}
                  toast={toast}
                />
              ))}
            </div>

            <StepNav onBack={() => goTo(2)} backLabel="Back to language" hideNext />
          </StepPane>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function StepPane({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.18 }}
      className="flex flex-col gap-4"
    >
      {children}
    </motion.div>
  )
}

const PHASE_TEXT = {
  generating: 'Generating…',
  running: 'Running test cases…',
  fixing: 'Fixing from the actual failure…',
  restarting: 'Starting over with a different approach…',
  'porting-snippet': 'Porting header/footer…',
  passed: 'Verified'
}

function ForgeRow({ q, byLang, languages, bestLang, pushing, expanded, onToggle, onPush, onRetry, running, toast }) {
  const results = byLang || {}
  const ref = bestSolutionOf(q)
  const cases = testCasesOf(q)

  const verifiedLangs = languages.filter(l => results[l]?.status === 'verified')
  const failedLangs = languages.filter(l => results[l]?.status === 'failed')
  const workingLang = languages.find(l => results[l]?.status === 'working')
  const pushError = languages.map(l => results[l]?.pushError).find(Boolean)
  const canPush = verifiedLangs.some(l => !results[l].pushed)

  return (
    <div className="rounded-xl border border-theme bg-panel overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <button onClick={onToggle} className="mt-0.5 text-muted2 hover-strong shrink-0">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className="text-[11px] font-mono text-muted2">Q{q._qNum ?? '?'}</span>
            {workingLang && (
              <Pill cls="bg-indigo-500/15 text-indigo-300" icon={Loader2} spin
                    text={`${workingLang}: ${PHASE_TEXT[results[workingLang].phase] || 'Working…'}`} />
            )}
            {/* One chip per language so it's clear which passed and which didn't */}
            {languages.map(l => {
              const r = results[l]
              if (!r || r.status === 'working') return null
              if (r.pushed) return <Pill key={l} cls="bg-sky-500/15 text-sky-300" icon={UploadCloud} text={`${l} pushed${l === bestLang ? ' ★' : ''}`} />
              if (r.status === 'verified') return <Pill key={l} cls="bg-emerald-500/15 text-emerald-300" icon={CheckCircle2} text={`${l} verified${l === bestLang ? ' ★' : ''}`} />
              return <Pill key={l} cls="bg-red-500/15 text-red-300" icon={XCircle} text={`${l} failed`} />
            })}
            {!Object.keys(results).length && <Pill cls="bg-panel text-muted2" icon={AlertTriangle} text="Not run" />}
          </div>
          <p className="text-xs text-body-app leading-snug">{stripHtml(q.question_data || '').slice(0, 130)}…</p>
          {failedLangs.map(l => (
            <p key={l} className="text-[11px] text-amber-400 mt-1">{l}: {results[l].reason}</p>
          ))}
          {pushError && <p className="text-[11px] text-red-400 mt-1">Push failed: {pushError}</p>}
          {failedLangs.length > 0 && verifiedLangs.length > 0 && (
            <p className="text-[11px] text-muted2 mt-1">
              Only the verified language(s) will be pushed — failures are never sent.
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {canPush && (
            <button
              onClick={onPush}
              disabled={pushing}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-50"
            >
              {pushing ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
              Push {verifiedLangs.filter(l => !results[l].pushed).length}
            </button>
          )}
          {(verifiedLangs.length > 0 || failedLangs.length > 0) && (
            <button onClick={onRetry} disabled={running} title="Re-generate" className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-panel bg-panel-hover text-muted disabled:opacity-40">
              <Wrench size={12} />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-theme p-3 flex flex-col gap-3">
          {ref.code && (
            <CodeBlock
              title={`Reference (${ref.language || 'unknown'})`}
              code={ref.code}
              onCopy={() => { copyRich('', ref.code); toast('Reference copied.', 'success') }}
            />
          )}

          {languages.map(l => {
            const r = results[l]
            if (!r || !r.code) return null
            return (
              <div key={l} className="rounded-lg border border-theme p-2.5">
                <CodeBlock
                  title={`${l}${l === bestLang ? ' ★ best' : ''} — ${r.status === 'verified' ? 'verified' : 'NOT passing'}`}
                  code={r.code}
                  highlight={r.status === 'verified'}
                  onCopy={() => { copyRich('', r.code); toast(`${l} code copied.`, 'success') }}
                />

                {r.compileError && (
                  <div className="mt-2">
                    <div className="text-[11px] font-semibold text-red-300 mb-1">Compiler output</div>
                    <pre className="text-[11px] bg-black/40 border border-theme rounded-lg p-2 max-h-40 overflow-auto whitespace-pre-wrap">{r.compileError}</pre>
                  </div>
                )}

                {/* Per-test-case evidence — the actual measured result */}
                {Array.isArray(r.results) && r.results.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[11px] font-semibold text-muted mb-1.5">
                      Test cases — {r.results.filter(x => x.passed).length}/{r.results.length} passed
                    </div>
                    <div className="flex flex-col gap-1">
                      {r.results.map(tc => (
                        <div key={tc.index} className="rounded-lg border border-theme bg-black/20 px-2.5 py-2">
                          <div className="flex items-center gap-2 mb-1">
                            {tc.passed
                              ? <CheckCircle2 size={12} className="text-emerald-400" />
                              : <XCircle size={12} className="text-red-400" />}
                            <span className="text-[11px] text-body-app">{tc.label || `Case ${tc.index + 1}`}</span>
                          </div>
                          {!tc.passed && (
                            <>
                              {/* A trailing-newline mismatch renders as two
                                  identical-looking blocks below, so it has to
                                  be stated in words or the diff reads as a
                                  bug in the tool. */}
                              {tc.note && (
                                <p className="text-[10px] text-amber-300/90 mb-1.5">{tc.note}</p>
                              )}
                              <div className="grid sm:grid-cols-2 gap-2 text-[10px] font-mono">
                                <div>
                                  <div className="text-muted2 mb-0.5">expected{tc.whitespaceOnly ? ' (quoted)' : ''}</div>
                                  <pre className="whitespace-pre-wrap text-emerald-300/90">
                                    {tc.whitespaceOnly ? JSON.stringify(tc.expected ?? '') : String(tc.expected ?? '')}
                                  </pre>
                                </div>
                                <div>
                                  <div className="text-muted2 mb-0.5">actual{tc.whitespaceOnly ? ' (quoted)' : ''}</div>
                                  <pre className="whitespace-pre-wrap text-red-300/90">
                                    {tc.error
                                      ? tc.error
                                      : tc.whitespaceOnly
                                        ? JSON.stringify(tc.actual ?? '')
                                        : String(tc.actual ?? '(no output)')}
                                  </pre>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {!Object.keys(results).length && (
            <p className="text-xs text-muted2">
              Not generated yet — {cases.length} test case(s) available to verify against.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function CodeBlock({ title, code, onCopy, highlight }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[11px] font-semibold ${highlight ? 'text-emerald-300' : 'text-muted'}`}>{title}</span>
        <button onClick={onCopy} className="ml-auto flex items-center gap-1 text-[10px] text-muted2 hover-strong">
          <Copy size={10} /> copy
        </button>
      </div>
      <pre className="text-[11px] leading-[1.55] bg-black/40 border border-theme rounded-lg p-2.5 max-h-64 overflow-auto whitespace-pre font-mono">{code}</pre>
    </div>
  )
}

function Pill({ cls, icon: Icon, text, spin }) {
  return (
    <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${cls}`}>
      <Icon size={10} className={spin ? 'animate-spin' : ''} /> {text}
    </span>
  )
}

function Tally({ label, value, cls }) {
  return (
    <div className="rounded-xl border border-theme bg-panel px-3 py-2.5 text-center">
      <div className={`text-xl font-bold ${cls}`}>{value}</div>
      <div className="text-[10px] text-muted2 tracking-wide uppercase mt-0.5">{label}</div>
    </div>
  )
}
