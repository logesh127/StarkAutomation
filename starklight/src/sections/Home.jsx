import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ShieldCheck, ClipboardList, Wand2, Sparkles, Telescope, Hammer } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { decodeJwtPayload } from '../lib/api'

const CARDS = [
  {
    to: '/test-qc',
    icon: ShieldCheck,
    title: 'Test QC',
    desc: 'Search a published test, pull its questions section-wise, and run the AI QC rubric — verdicts, star ratings, and one-click fixes.',
    color: 'from-indigo-500 to-blue-500',
    emoji: '🛡️'
  },
  {
    to: '/manual-packing',
    icon: ClipboardList,
    title: 'Manual Test Packing',
    desc: 'Build a test section by section, or open an existing one to add and remove questions — then QC it right after.',
    color: 'from-orange-500 to-amber-500',
    emoji: '📋'
  },
  {
    to: '/smart-packer',
    icon: Wand2,
    title: 'Smart Test Packer',
    desc: "Describe each section's language, topic, and count — Starklight finds and assembles the questions automatically.",
    color: 'from-emerald-500 to-teal-500',
    emoji: '🪄'
  },
  {
    to: '/topic-analyser',
    icon: Telescope,
    title: 'Topic Analyser',
    desc: 'Check a test or question bank against a syllabus — flags any question that strays into restricted or future topics.',
    color: 'from-violet-500 to-fuchsia-500',
    emoji: '🔭'
  },
  {
    to: '/solution-forge',
    icon: Hammer,
    title: 'Solution Forge',
    desc: 'Add a solution in another language — generated, actually compiled and run against the real test cases, then pushed back.',
    color: 'from-rose-500 to-pink-500',
    emoji: '⚒️'
  }
]

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } }
}
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 26 } }
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 5) return { text: 'Burning the midnight oil', emoji: '🌙' }
  if (hour < 12) return { text: 'Good morning', emoji: '☀️' }
  if (hour < 17) return { text: 'Good afternoon', emoji: '🌤️' }
  if (hour < 21) return { text: 'Good evening', emoji: '🌆' }
  return { text: 'Working late', emoji: '🌙' }
}

export default function Home() {
  const { token } = useApp()
  const payload = token ? decodeJwtPayload(token) : null
  const greeting = getGreeting()

  return (
    <div className="py-10">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="flex items-center gap-3 mb-2"
      >
        <motion.span
          animate={{ rotate: [0, 15, -10, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1 }}
          className="text-3xl"
        >
          {greeting.emoji}
        </motion.span>
        <h1 className="text-3xl font-bold">
          {greeting.text}{payload?.name ? `, ${payload.name.split(/[\s$]/)[0]}` : ''}! 👋
        </h1>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="text-muted mb-10 flex items-center gap-1.5"
      >
        <Sparkles size={14} className="text-accent-pill" /> Welcome to Starklight — pick a section to get started.
      </motion.p>

      <motion.div variants={container} initial="hidden" animate="show" className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {CARDS.map(c => (
          <motion.div key={c.to} variants={item} whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}>
            <Link
              to={c.to}
              className="group relative overflow-hidden rounded-2xl border border-theme bg-panel bg-panel-hover transition flex flex-col h-full p-6"
            >
              <div className={`absolute -right-10 -top-10 w-32 h-32 rounded-full bg-gradient-to-br ${c.color} opacity-0 group-hover:opacity-20 blur-2xl transition-opacity duration-500`} />
              <motion.div
                whileHover={{ rotate: [0, -8, 8, 0] }}
                transition={{ duration: 0.5 }}
                className={`w-11 h-11 rounded-xl bg-gradient-to-br ${c.color} flex items-center justify-center mb-4 shadow-lg text-lg`}
              >
                <c.icon size={22} />
              </motion.div>
              <h2 className="text-lg font-semibold mb-1.5 flex items-center gap-1.5">
                {c.title} <span className="opacity-0 group-hover:opacity-100 transition-opacity">{c.emoji}</span>
              </h2>
              <p className="text-sm text-muted leading-relaxed">{c.desc}</p>
            </Link>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}
