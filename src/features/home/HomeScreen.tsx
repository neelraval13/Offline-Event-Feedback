import { FlyingFleaBrandHeader } from '../../components/brand/FlyingFleaBrandHeader'
import { EVENT_CONFIG } from '../../config/event'
import { formatEventDay } from '../../config/eventTime'
import { hrefFor, type RoutePath } from '../../lib/routing/hashRoute'
import { FLYING_FLEA_CAMPAIGN } from '../campaign/flying-flea/config'

interface SurfaceLink {
  readonly path: RoutePath
  readonly title: string
  readonly description: string
  /** A condition on reaching the surface, not a second description. */
  readonly note?: string
}

/*
 * Every destination, in one list.
 *
 * Reporting used to sit under its own heading in a second grid, on the
 * reasoning that it reads the central server's copy of every participant and
 * belongs on an organiser's machine rather than a desk. That is still true, and
 * it is a fact about credentials rather than about layout: the screen said it
 * twice (a heading and a card title), left Device Admin alone on a row, and
 * still could not stop anyone clicking the link. The access requirement is
 * where it can actually be read, on the card itself.
 */
const SURFACES: readonly SurfaceLink[] = [
  {
    path: '/a',
    title: 'Point A: Registration',
    description: 'Register a rider and print the QR sticker.',
  },
  {
    path: '/b',
    title: 'Point B: Feedback',
    description: 'Scan the sticker or enter the code to collect feedback.',
  },
  {
    path: '/admin',
    title: 'Device Admin',
    description: 'View local records, export backups and check this device.',
  },
  {
    path: '/reporting',
    title: 'Central Reporting',
    description: 'Review and export reconciled central data.',
    note: 'Requires reporting access.',
  },
]

/**
 * Development entry point. In the field a device is opened directly on its own
 * surface URL, so this screen exists for developers and for setup, not for
 * staff to navigate during the event.
 *
 * It is a menu, and it is composed as one: a short identity block, then four
 * equal targets. The venue is stated once, in the badge; the event date once,
 * under the title. Repeating either in a paragraph underneath was the reason
 * the screen scrolled on a phone before anything clickable appeared.
 */
export function HomeScreen() {
  return (
    <article className="screen">
      <FlyingFleaBrandHeader venue={FLYING_FLEA_CAMPAIGN.lockedLocation} />

      <header className="ff-home__intro">
        <div className="ff-eyebrow">{FLYING_FLEA_CAMPAIGN.hero.eyebrow}</div>
        <h1 className="ff-display ff-heading">
          Test Ride <span className="ff-heading__accent">Stations</span>
        </h1>
        <p className="ff-home__date">{formatEventDay(EVENT_CONFIG.eventDay)}</p>
        <p className="ff-home__hint">Choose a station to begin.</p>
      </header>

      {/*
        One grid, four cards, one component. Device Admin and Central Reporting
        are not made quieter than the two station links: an operator looking for
        the backup screen at the end of a long day should not have to find a
        smaller version of the same control.
      */}
      <ul className="ff-home__surfaces">
        {SURFACES.map((surface) => (
          <li key={surface.path}>
            <a className="ff-home__link" href={hrefFor(surface.path)}>
              <span className="ff-home__title">{surface.title}</span>
              <p className="ff-home__desc">{surface.description}</p>
              {surface.note !== undefined && (
                <p className="ff-home__note">{surface.note}</p>
              )}
            </a>
          </li>
        ))}
      </ul>
    </article>
  )
}
