import { FlyingFleaBrandHeader } from '../../components/brand/FlyingFleaBrandHeader'
import { EVENT_CONFIG } from '../../config/event'
import { hrefFor, type RoutePath } from '../../lib/routing/hashRoute'
import { FLYING_FLEA_CAMPAIGN } from '../campaign/flying-flea/config'

interface SurfaceLink {
  readonly path: RoutePath
  readonly title: string
  readonly description: string
}

const SURFACES: readonly SurfaceLink[] = [
  {
    path: '/a',
    title: 'Point A — Registration',
    description: 'Register a rider, then print the QR sticker.',
  },
  {
    path: '/b',
    title: 'Point B — Feedback',
    description:
      'Scan the sticker, or type the fallback code, and collect the test-ride feedback.',
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
      <FlyingFleaBrandHeader
        venue={FLYING_FLEA_CAMPAIGN.lockedLocation ?? undefined}
      />

      <div className="ff-eyebrow">{FLYING_FLEA_CAMPAIGN.hero.eyebrow}</div>
      <h1 className="ff-display ff-heading">
        Test Ride <span className="ff-heading__accent">Stations</span>
      </h1>
      <p className="ff-sub">
        {EVENT_CONFIG.eventName} — {EVENT_CONFIG.eventDay}. Offline-first
        registration and feedback for the {FLYING_FLEA_CAMPAIGN.name} campaign.
      </p>

      {/*
        Still a field application, not a landing page: the two things staff open
        at a desk are the two largest targets on the screen, and everything else
        is deliberately quieter.
      */}
      <ul className="ff-home__surfaces">
        {SURFACES.map((surface) => (
          <li key={surface.path}>
            <a className="ff-home__link" href={hrefFor(surface.path)}>
              <span className="ff-home__title">{surface.title}</span>
              <p className="ff-home__desc">{surface.description}</p>
            </a>
          </li>
        ))}
      </ul>

      <h2 className="ff-display ff-heading" style={{ fontSize: '20px' }}>
        Central reporting
      </h2>
      <ul className="ff-home__surfaces">
        {CENTRAL.map((surface) => (
          <li key={surface.path}>
            <a className="ff-home__link" href={hrefFor(surface.path)}>
              <span className="ff-home__title">{surface.title}</span>
              <p className="ff-home__desc">{surface.description}</p>
            </a>
          </li>
        ))}
      </ul>
    </article>
  )
}
