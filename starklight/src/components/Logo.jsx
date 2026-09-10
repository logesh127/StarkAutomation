import { useId } from 'react'

/**
 * The Starklight mark: a robot head on an indigo→violet tile.
 *
 * One component rather than the SVG repeated at each call site, so the
 * header, the sign-in card, the transition and the dashboard can never drift
 * apart. Kept identical to public/favicon.svg — change both together, or the
 * browser tab stops matching the app.
 *
 * Props:
 *   tile  — draw the coloured tile. `false` gives the bare glyph in
 *           currentColor, for places that already sit on a panel. It must be
 *           currentColor and not white there, or the mark would vanish
 *           against the light theme.
 *   blink — occasional eye blink. Off by default: charming once on the
 *           sign-in screen, distracting in a header that is always on
 *           screen. Honours prefers-reduced-motion (see index.css).
 *
 * Gradient ids come from useId(): SVG ids are document-global, so two copies
 * sharing one would both resolve to whichever mounted first. A module-level
 * counter would be mutated during render, which StrictMode's double pass
 * turns into two different ids.
 */
export default function Logo({ size = 32, tile = true, blink = false, className = '' }) {
  const uid = `sl-logo-${useId().replace(/:/g, '')}`
  const tileId = `${uid}-tile`
  const ink = tile ? '#ffffff' : 'currentColor'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Starklight"
    >
      {tile && (
        <>
          <defs>
            <linearGradient id={tileId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="64" y2="64">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#a855f7" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="16" fill={`url(#${tileId})`} />
        </>
      )}

      {/* Symmetric about x=32; ink spans x 7..57 and y 9..55, so the mark is
          optically centred rather than eyeballed. */}
      <g stroke={ink} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 15 V22" strokeWidth="3.4" />
        <rect x="13" y="22" width="38" height="31" rx="9" strokeWidth="4" />
        <path d="M9 32 V43" strokeWidth="4" />
        <path d="M55 32 V43" strokeWidth="4" />
        <path d="M26 41.5 C29 44.5 35 44.5 38 41.5" strokeWidth="3.4" />
      </g>

      <circle cx="32" cy="12" r="3" fill={ink} />
      <rect className={blink ? 'logo-eye' : undefined} x="21" y="30" width="7" height="7" rx="3.5" fill={ink} />
      <rect className={blink ? 'logo-eye' : undefined} x="36" y="30" width="7" height="7" rx="3.5" fill={ink} />
    </svg>
  )
}
