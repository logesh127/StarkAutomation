import { useId } from 'react'

/**
 * The Starklight mark: a robot head.
 *
 * One component rather than the SVG repeated at each call site, so the
 * header, the sign-in card, the transition and the dashboard can never drift
 * apart. Kept identical to public/favicon.svg — change both together, or the
 * browser tab stops matching the app.
 *
 * `tile={false}` drops the dark background for places already sitting on a
 * dark panel that only want the glyph.
 *
 * Two things here are load-bearing and easy to undo by accident:
 *
 *  - Gradients use gradientUnits="userSpaceOnUse". The default,
 *    objectBoundingBox, is undefined for a shape whose bounding box has zero
 *    width or height — and the antenna stem and both ears are exactly that,
 *    straight vertical lines. With the default they silently paint nothing.
 *  - Gradient ids are unique per instance. SVG ids are document-global, so
 *    two copies sharing an id both resolve to whichever mounted first.
 */
export default function Logo({ size = 32, tile = true, className = '' }) {
  // useId rather than a module counter: incrementing one during render is a
  // side effect, so StrictMode's double render would hand the two passes
  // different ids. Colons are stripped because useId emits them and they are
  // awkward inside url(#...) references.
  const uid = `sl-logo-${useId().replace(/:/g, '')}`
  const tileId = `${uid}-tile`
  const inkId = `${uid}-ink`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Starklight"
    >
      <defs>
        <linearGradient id={tileId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="64" y2="64">
          <stop offset="0%" stopColor="#1b2032" />
          <stop offset="100%" stopColor="#0c0f18" />
        </linearGradient>
        <linearGradient id={inkId} gradientUnits="userSpaceOnUse" x1="7" y1="9" x2="57" y2="55">
          <stop offset="0%" stopColor="#a5b4fc" />
          <stop offset="55%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#c084fc" />
        </linearGradient>
      </defs>

      {tile && (
        <>
          <rect width="64" height="64" rx="16" fill={`url(#${tileId})`} />
          <rect
            x="1" y="1" width="62" height="62" rx="15"
            fill="none" stroke="#6366f1" strokeOpacity="0.45" strokeWidth="2"
          />
        </>
      )}

      {/* Every element is symmetric about x=32, and the ink spans y 9..55 /
          x 7..57, so the mark is optically centred rather than roughly
          placed. Ears sit on the head's y-centre (37.5). */}
      <g stroke={`url(#${inkId})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 15 V22" strokeWidth="3.4" />
        <rect x="13" y="22" width="38" height="31" rx="9" strokeWidth="4" />
        <path d="M9 32 V43" strokeWidth="4" />
        <path d="M55 32 V43" strokeWidth="4" />
        <path d="M26 41.5 C29 44.5 35 44.5 38 41.5" strokeWidth="3.4" />
      </g>

      <g fill={`url(#${inkId})`}>
        <circle cx="32" cy="12" r="3" />
        <rect x="21" y="30" width="7" height="7" rx="3.5" />
        <rect x="36" y="30" width="7" height="7" rx="3.5" />
      </g>
    </svg>
  )
}
