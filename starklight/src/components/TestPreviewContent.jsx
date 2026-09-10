import { Eye } from 'lucide-react'
import QuestionDetailCard from './QuestionDetailCard'

export default function TestPreviewContent({ testName, sections }) {
  const total = sections.reduce((n, s) => n + s.questions.length, 0)

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Eye size={18} className="text-indigo-300" />
        <h2 className="text-xl font-bold">{testName || 'Untitled test'}</h2>
      </div>
      <p className="text-sm text-muted mb-5">👁️ Preview — {total} question(s) across {sections.length} section(s)</p>

      <div className="flex flex-col gap-5">
        {sections.map(sec => (
          <div key={sec.name}>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              📂 {sec.name} <span className="text-muted2 font-normal">({sec.questions.length} question{sec.questions.length !== 1 ? 's' : ''}, {sec.duration} min)</span>
            </h3>
            {sec.questions.length === 0 ? (
              <p className="text-sm text-muted2 italic">No questions in this section.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sec.questions.map(q => (
                  <QuestionDetailCard key={q.q_id} q={q} mode="view" />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
