import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import confetti from 'canvas-confetti'

// Rotating sign-off lines — pure flavour, picked at random each time.
const SIGN_OFFS = [
  { title: 'GG WP', sub: 'Good game, well played.' },
  { title: 'RUN COMPLETE', sub: 'See you in the next session.' },
  { title: 'SAVING PROGRESS…', sub: 'Your run has been logged.' },
  { title: 'QUEST PAUSED', sub: 'Resume anytime, adventurer.' },
  { title: 'LOGGING OUT', sub: 'Press start to play again.' },
  { title: 'VICTORY ROYALE', sub: 'Question banks cleared.' }
]

const RANKS = [
  { min: 0, label: 'ROOKIE', color: 'text-slate-300' },
  { min: 1, label: 'ANALYST', color: 'text-emerald-300' },
  { min: 10, label: 'VETERAN', color: 'text-sky-300' },
  { min: 25, label: 'ELITE', color: 'text-violet-300' },
  { min: 50, label: 'LEGENDARY', color: 'text-amber-300' }
]

function rankFor(n) {
  return [...RANKS].reverse().find(r => n >= r.min) || RANKS[0]
}

export default function LogoutOverlay({ open, stats, onDone }) {
  const [pick] = useState(() => SIGN_OFFS[Math.floor(Math.random() * SIGN_OFFS.length)])

  useEffect(() => {
    if (!open) return
    // Two quick side-cannons — reads as a match-end flourish rather than a celebration burst.
    const colors = ['#818cf8', '#38bdf8', '#f59e0b', '#e2e8f0']
    confetti({ particleCount: 45, angle: 55, spread: 62, origin: { x: 0, y: 0.75 }, colors })
    confetti({ particleCount: 45, angle: 125, spread: 62, origin: { x: 1, y: 0.75 }, colors })
    const t = setTimeout(onDone, 2100)
    return () => clearTimeout(t)
  }, [open, onDone])

  if (!open) return null

  const analyzed = stats?.analyzed ?? 0
  const rank = rankFor(analyzed)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.85, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 18 }}
        className="text-center px-8"
      >
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          className="text-6xl mb-4"
        >
          🎮
        </motion.div>

        <motion.h1
          initial={{ letterSpacing: '0.5em', opacity: 0 }}
          animate={{ letterSpacing: '0.12em', opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="text-4xl sm:text-5xl font-black tracking-widest bg-gradient-to-r from-indigo-300 via-sky-300 to-violet-300 bg-clip-text text-transparent"
        >
          {pick.title}
        </motion.h1>
        <p className="text-sm text-slate-400 mt-2 mb-7">{pick.sub}</p>

        <div className="flex items-center justify-center gap-8 mb-7">
          <Stat label="QUESTIONS QC'D" value={analyzed} />
          <div className="w-px h-10 bg-white/15" />
          <div>
            <div className="text-[10px] tracking-[0.2em] text-slate-500 mb-1">RANK</div>
            <div className={`text-xl font-black tracking-wider ${rank.color}`}>{rank.label}</div>
          </div>
        </div>

        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 1.9, ease: 'linear' }}
          className="h-0.5 w-56 mx-auto bg-gradient-to-r from-indigo-400 to-violet-400 rounded-full origin-left"
        />
        <p className="text-[11px] text-slate-600 mt-3 tracking-widest">RETURNING TO LOGIN…</p>
      </motion.div>
    </motion.div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.2em] text-slate-500 mb-1">{label}</div>
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.25, type: 'spring', stiffness: 300 }}
        className="text-3xl font-black text-white"
      >
        {value}
      </motion.div>
    </div>
  )
}
