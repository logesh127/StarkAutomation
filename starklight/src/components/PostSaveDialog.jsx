import { useEffect } from 'react'
import { motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import Modal from './Modal'

export default function PostSaveDialog({ open, testName, onRunQc, onNotNow, onQuit }) {
  useEffect(() => {
    if (!open) return
    // A little celebration, not just a single puff — fires from both sides for a couple beats.
    const colors = ['#6366f1', '#f59e0b', '#10b981', '#ec4899']
    const end = Date.now() + 700
    ;(function frame() {
      confetti({ particleCount: 4, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors })
      confetti({ particleCount: 4, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors })
      if (Date.now() < end) requestAnimationFrame(frame)
    })()
    confetti({ particleCount: 80, spread: 100, origin: { y: 0.6 }, colors })
  }, [open])

  return (
    <Modal open={open} onClose={onNotNow} title={null}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 22 }}
        className="text-center mb-5"
      >
        <div className="text-4xl mb-3">✅</div>
        <h2 className="text-lg font-bold">Test saved &amp; published</h2>
        <p className="text-sm text-body-app mt-1">
          <span className="font-semibold text-white">{testName}</span> is live. What would you like to do next?
        </p>
      </motion.div>

      <div className="flex flex-col gap-2">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={onRunQc}
          className="flex items-center gap-2 justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2.5 font-semibold hover:opacity-90 transition shadow-lg shadow-indigo-500/20"
        >
          🔍 Run QC on this test
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={onNotNow}
          className="flex items-center gap-2 justify-center rounded-xl bg-white/10 px-4 py-2.5 font-medium hover:bg-white/15 transition"
        >
          ↩️ Not now — back to Manual Packing
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={onQuit}
          className="flex items-center gap-2 justify-center rounded-xl bg-white/5 px-4 py-2.5 font-medium text-muted hover:bg-white/10 transition"
        >
          🚪 Quit to home
        </motion.button>
      </div>
    </Modal>
  )
}
