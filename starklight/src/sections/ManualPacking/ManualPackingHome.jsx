import { Link } from 'react-router-dom'
import { FilePlus2, FolderCog } from 'lucide-react'

export default function ManualPackingHome() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Manual Test Packing</h1>
        <p className="text-sm text-muted">Build a new test section by section, or open an existing one to add and remove questions.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Link to="/manual-packing/create" className="group rounded-2xl border border-theme bg-panel p-6 bg-panel-hover transition">
          <FilePlus2 size={26} className="text-orange-400 mb-3" />
          <h2 className="font-semibold mb-1">Create a new test</h2>
          <p className="text-sm text-muted">Add sections, search question banks, and hand-pick questions from scratch.</p>
        </Link>
        <Link to="/manual-packing/edit" className="group rounded-2xl border border-theme bg-panel p-6 bg-panel-hover transition">
          <FolderCog size={26} className="text-orange-400 mb-3" />
          <h2 className="font-semibold mb-1">Edit an existing test</h2>
          <p className="text-sm text-muted">Open a published test, remove questions, add new ones, then re-save it.</p>
        </Link>
      </div>
    </div>
  )
}
