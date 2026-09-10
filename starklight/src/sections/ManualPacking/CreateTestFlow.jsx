import ManualPackingWizard from './ManualPackingWizard'

export default function CreateTestFlow() {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h1 className="text-2xl font-bold mb-1">Create a New Test</h1>
        <p className="text-sm text-muted">Fill in the details, add questions, preview, then save.</p>
      </div>
      <ManualPackingWizard mode="create" />
    </div>
  )
}
