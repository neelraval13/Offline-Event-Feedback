import {
  ChartNoAxesColumnIcon,
  ChevronRightIcon,
  ClipboardPenIcon,
  MessageSquareQuoteIcon,
  SmartphoneIcon,
  type LucideIcon,
} from 'lucide-react'
import { AppSurface } from '../../components/design-system'
import { EVENT_CONFIG } from '../../config/event'
import { formatEventDay } from '../../config/eventTime'
import { hrefFor, type RoutePath } from '../../lib/routing/hashRoute'
import { FLYING_FLEA_CAMPAIGN } from '../campaign/flying-flea/config'

/*
 * The station menu.
 *
 * A launcher and nothing else. It answers one question, "where do I need to
 * go", and the measure of it is how long the answer takes: on a tablet at the
 * start of a shift the four destinations should be on screen before anything
 * has to be read, let alone scrolled past.
 *
 * So there is no hero, no photography, no figures and no participant data.
 * Every number this product holds is one deliberate click away on a screen
 * built to show it, and a rider's name has no reason to be on the first thing
 * a device displays.
 *
 * ## Four equal destinations
 *
 * Reporting used to sit under its own heading in a second grid, on the
 * reasoning that it reads the central server's copy of every participant and
 * belongs on an organiser's machine rather than a desk. That is still true, and
 * it is a fact about credentials rather than about layout: the screen said it
 * twice (a heading and a card title), left Device Admin alone on a row, and
 * still could not stop anyone clicking the link. The access requirement is now
 * where it can actually be read, on the destination itself, and all four get
 * the same shape.
 *
 * An operator hunting for the backup screen at the end of a long day should not
 * have to find a smaller version of the same control.
 *
 * ## What V2 changed
 *
 * The screen no longer draws its own brand topbar. The V2 shell carries the
 * parachute, the product name, the event, the day and the offline status, and
 * Home rendering a second banner underneath it was the double header the shell
 * was built to remove. What is left here is the part the shell cannot say: the
 * venue this device is standing in, the day in words, and the four ways on.
 *
 * Readiness is not restated either. The shell already reports it, on every
 * screen, from the one source that knows; a Home-only copy would be a second
 * answer to a question that must only have one.
 */

interface Destination {
  readonly path: RoutePath
  /** What the station is called on a lanyard and over a radio. */
  readonly title: string
  /** The job, in two or three words. */
  readonly role: string
  readonly description: string
  /** A condition on reaching the destination, not a second description. */
  readonly note?: string
  readonly icon: LucideIcon
}

const DESTINATIONS: readonly Destination[] = [
  {
    path: '/a',
    title: 'Point A',
    role: 'Registration',
    description: 'Register riders and print their QR sticker.',
    icon: ClipboardPenIcon,
  },
  {
    path: '/b',
    title: 'Point B',
    role: 'Feedback',
    description: 'Capture test ride feedback by QR, code or rider details.',
    icon: MessageSquareQuoteIcon,
  },
  {
    path: '/admin',
    title: 'Device Admin',
    role: 'Device operations',
    description: 'Check offline readiness, local data, sync and backups.',
    icon: SmartphoneIcon,
  },
  {
    path: '/reporting',
    title: 'Central Reporting',
    role: 'Event reporting',
    description: 'Review the central event record, reconciliation and exports.',
    note: 'Requires reporting access.',
    icon: ChartNoAxesColumnIcon,
  },
]

export function HomeScreen() {
  return (
    /*
     * The station measure, not the reporting one. Home is closer to a terminal
     * than to a table: four targets across 88rem would put the two on the right
     * outside the arc a thumb travels while the tablet is held.
     */
    <AppSurface width="station" className="flex flex-col gap-page">
      <header className="flex flex-col gap-1">
        <span className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-accent">
          {FLYING_FLEA_CAMPAIGN.hero.eyebrow}
        </span>
        <h1 className="font-display text-page leading-none tracking-wide text-ink">
          Test Ride <span className="text-accent">Stations</span>
        </h1>
        {/*
          The venue and the day, once each and on one line. Both used to be
          repeated in a paragraph underneath, which is why the screen scrolled
          on a phone before anything clickable appeared.
        */}
        <p className="flex flex-wrap items-baseline gap-x-2.5 pt-1 font-ui text-base text-muted">
          <span>{FLYING_FLEA_CAMPAIGN.lockedLocation}</span>
          <span aria-hidden="true" className="text-faint">
            ·
          </span>
          <span>{formatEventDay(EVENT_CONFIG.eventDay)}</span>
        </p>
        <p className="font-body text-small text-faint">Choose a station to begin.</p>
      </header>

      {/*
        One list, four destinations, one component. Two columns where there is
        room and one where there is not; nothing is hidden or demoted at either
        size.
      */}
      <ul className="grid gap-3 sm:grid-cols-2">
        {DESTINATIONS.map((destination) => (
          <li key={destination.path} className="flex">
            <DestinationLink destination={destination} />
          </li>
        ))}
      </ul>
    </AppSurface>
  )
}

/**
 * One destination, as a real anchor.
 *
 * The whole surface is the link rather than a card containing one: a target
 * that is only partly clickable is a target an operator misses with a thumb,
 * and a nested button inside a link is two things for a keyboard to stop at
 * where there is only one destination.
 *
 * `<a href="#/...">` and nothing else. Not a div with a handler, not a button
 * that assigns to `location`: this is what Tab reaches, what Enter follows,
 * what a screen reader announces as a destination, and what a middle click
 * opens in a new tab.
 */
function DestinationLink({ destination }: { readonly destination: Destination }) {
  const Icon = destination.icon

  return (
    <a
      href={hrefFor(destination.path)}
      data-home-destination
      className="group flex min-h-touch w-full items-start gap-4 rounded-card border border-line bg-surface px-5 py-4 transition-colors hover:border-line-strong hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive"
    >
      <Icon
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-muted transition-colors group-hover:text-accent"
      />

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-baseline gap-x-2.5">
          <span className="font-display text-title tracking-wide text-ink">
            {destination.title}
          </span>
          <span className="font-ui text-label font-semibold uppercase tracking-[0.14em] text-muted">
            {destination.role}
          </span>
        </span>

        <span className="font-body text-small text-muted">
          {destination.description}
        </span>

        {destination.note !== undefined && (
          <span
            data-home-note
            className="font-ui text-small text-warn"
          >
            {destination.note}
          </span>
        )}
      </span>

      {/* The directional affordance. Decorative: the link says where it goes. */}
      <ChevronRightIcon
        aria-hidden="true"
        className="mt-1 size-4 shrink-0 text-faint transition-colors group-hover:text-interactive"
      />
    </a>
  )
}
