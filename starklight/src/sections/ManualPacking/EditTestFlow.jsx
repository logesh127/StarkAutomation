import { useState } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { api } from '../../lib/api'
import { assignSectionQuestionNumbers } from '../../lib/helpers'
import SkeletonRows from '../../components/SkeletonRows'
import ManualPackingWizard from './ManualPackingWizard'

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

export default function EditTestFlow() {
  const { token, deptIds, manualPackingState: mp } = useApp()

  const [search, setSearch] = useState('')
  const [tests, setTests] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [loadedTest, setLoadedTest] = useState(null) // { id, name, testType, visibility, sections }

  // Resume an in-progress edit session across navigation (e.g. came back from Test QC)
  // without re-searching or re-opening the test.
  const resuming = !loadedTest && mp?._mode === 'edit' && mp._existingTestId

  async function runSearch() {
    if (!token) { setError('Paste an access token first.'); return }
    setLoading(true); setError('')
    try {
      const body = { branch_id: 'All', department_id: deptIds, limit: 25, mainDepartmentUser: true, page: 1 }
      if (search.trim()) body.search = search.trim()
      const data = await api.searchTests(token, body)
      const results = data.results || data.data || data
      const rows = Array.isArray(results) ? results
        : Array.isArray(results?.tests) ? results.tests
        : Array.isArray(results?.testList) ? results.testList
        : Array.isArray(results?.data) ? results.data
        : []
      setTests(rows)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function openTest(t) {
    const id = t._id || t.test_id || t.testId || t.id
    const name = t.testName || t.test_name || t.t_name || t.name || 'Untitled test'
    if (!id) { setError('This row has no usable test ID.'); return }
    setLoading(true); setError('')
    try {
      const [detail, questionsData] = await Promise.all([
        api.getTestDetail(token, id).catch(() => null),
        api.getQuestionsForTest(token, id)
      ])
      const merged = parseQuestionsByTestResponse(questionsData)
      if (!merged.length) { setError('No question data found for this test.'); return }
      assignSectionQuestionNumbers(merged)

      const sectionMeta = Array.isArray(detail?.sections) ? detail.sections : []
      const bySection = {}
      merged.forEach(q => { (bySection[q._sectionName] ||= []).push(q) })

      const sectionNames = sectionMeta.length ? sectionMeta.map(s => s.name) : Object.keys(bySection)
      const newSections = sectionNames.map(name => ({
        name,
        duration: sectionMeta.find(s => s.name === name)?.duration ?? '60',
        questions: bySection[name] || []
      }))

      setLoadedTest({
        id, name,
        testType: detail?.testType || 'Manual Assessment Test',
        visibility: detail?.visibility || 'Within Department',
        sections: newSections
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (loadedTest || resuming) {
    const testId = loadedTest?.id ?? mp._existingTestId
    const name = loadedTest?.name ?? mp.testName
    return (
      <div className="flex flex-col gap-2">
        <div>
          <h1 className="text-2xl font-bold mb-1">Edit "{name}"</h1>
          <p className="text-sm text-muted">Add or remove questions, then save changes.</p>
        </div>
        <ManualPackingWizard
          mode="edit"
          existingTestId={testId}
          initialTestName={name}
          initialTestType={loadedTest?.testType ?? mp.testType}
          initialVisibility={loadedTest?.visibility ?? mp.visibility}
          initialSections={loadedTest?.sections ?? mp.sections}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Edit an Existing Test</h1>
        <p className="text-sm text-muted">Search for a test to open it in the editor.</p>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted2 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runSearch()}
            placeholder="Search tests by name..."
            className="input"
            style={{ paddingLeft: '2.25rem' }}
          />
        </div>
        <button onClick={runSearch} disabled={loading} className="px-4 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-sm font-semibold disabled:opacity-50">
          {loading ? <Loader2 size={16} className="animate-spin" /> : 'Search'}
        </button>
      </div>

      {loading && !tests.length && <SkeletonRows />}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {tests.length > 0 && (
        <div className="rounded-xl border border-theme overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-muted text-left">
              <tr><th className="px-4 py-2 font-medium">Test Name</th><th className="px-4 py-2"></th></tr>
            </thead>
            <tbody>
              {tests.map((t, i) => (
                <tr key={i} className="bg-panel-hover">
                  <td className="px-4 py-2.5">{t.testName || t.test_name || t.t_name || t.name || '(unnamed)'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => openTest(t)} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30">
                      Open to Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
