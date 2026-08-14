import { EVENT_CONFIG } from '../../config/event'
import { hrefFor, type RoutePath } from '../../lib/routing/hashRoute'

interface SurfaceLink {
  readonly path: RoutePath
  readonly title: string
  readonly description: string
}

const SURFACES: readonly SurfaceLink[] = [
  {
    path: '/a',
    title: 'Point A — Registration',
    description: 'Capture participant details and print the QR sticker.',
  },
  {
    path: '/b',
    title: 'Point B — Feedback',
    description: 'Scan the sticker, or type the fallback code, and collect feedback.',
  },
  {
    path: '/admin',
    title: 'Device Admin',
    description: 'Local record counts, export and diagnostics for this device.',
  },
]

/*
 * Kept apart from the station surfaces above. Reporting reads the central
 * server's copy of every participant, needs its own secret, and belongs on the
 * organiser's machine rather than on a desk.
 */
const CENTRAL: readonly SurfaceLink[] = [
  {
    path: '/reporting',
    title: 'Central Reporting',
    description:
      'Review, analyse and export the reconciled central data. Requires the reporting secret.',
  },
]

/**
 * Development entry point. In the field a device is opened directly on its own
 * surface URL, so this screen exists for developers and for setup, not for
 * staff to navigate during the event.
 */
export function HomeScreen() {
  return (
    <article className="screen">
      <h1>Offline Event Feedback</h1>
      <p className="screen__lede">
        {EVENT_CONFIG.eventName} — {EVENT_CONFIG.eventDay}. Offline-first
        registration and feedback for a single event day.
      </p>
      <ul className="surface-list">
        {SURFACES.map((surface) => (
          <li key={surface.path}>
            <a className="surface-list__link" href={hrefFor(surface.path)}>
              {surface.title}
            </a>
            <p className="surface-list__description">{surface.description}</p>
          </li>
        ))}
      </ul>
      <h2 className="section-title">Central reporting</h2>
      <ul className="surface-list">
        {CENTRAL.map((surface) => (
          <li key={surface.path}>
            <a className="surface-list__link" href={hrefFor(surface.path)}>
              {surface.title}
            </a>
            <p className="surface-list__description">{surface.description}</p>
          </li>
        ))}
      </ul>
    </article>
  )
}
