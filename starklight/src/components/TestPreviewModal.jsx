import Modal from './Modal'
import TestPreviewContent from './TestPreviewContent'

export default function TestPreviewModal({ open, onClose, testName, sections }) {
  return (
    <Modal open={open} onClose={onClose} title={null} wide>
      <TestPreviewContent testName={testName} sections={sections} />
    </Modal>
  )
}
