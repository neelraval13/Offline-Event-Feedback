import { lazy, Suspense, type ReactElement } from 'react'
import { AdminScreen } from '../features/admin/AdminScreen'
import { FeedbackScreen } from '../features/feedback/FeedbackScreen'
import { HomeScreen } from '../features/home/HomeScreen'
import { RegistrationScreen } from '../features/registration/RegistrationScreen'
import type { ShellChrome } from '../components/design-system/AppShellV2'
import type { RoutePath } from '../lib/routing/hashRoute'

/*
 * Reporting is the one screen loaded on demand.
 *
 * Every other surface has to survive the network disappearing mid-shift, so it
 * is compiled into the eager bundle. Reporting cannot work without the network
 * by definition, and it never runs on a station device, so keeping it out of
 * the startup bundle means a tablet parses less code at every cold start and
 * carries no participant-browsing UI at all until someone asks for it.
 *
 * The chunk is still precached like every other emitted asset (verified by
 * `scripts/verify-pwa-build.mjs`), so this is a startup-cost decision, not an
 * availability one.
 */
const ReportingScreen = lazy(async () => ({
  default: (await import('../features/reporting/ReportingScreen')).ReportingScreen,
}))

/*
 * The design-system gallery is loaded on demand, for the same reason.
 *
 * It is a review surface, not a station: nobody opens it during a shift and
 * nothing about capturing a registration depends on it. Leaving it in the
 * eager bundle would have put its fixtures and every component it demonstrates
 * on to every tablet, which is 30 kB of precache budget spent on a page an
 * operator will never see.
 */
const FoundationScreen = lazy(async () => ({
  default: (await import('../features/foundation/FoundationScreen')).FoundationScreen,
}))

/*
 * The Point A V2 concept, loaded on demand.
 *
 * A design-review surface. It never runs on a station device, so it stays out
 * of the eager bundle for the same reason Reporting and the foundation gallery
 * do: a tablet should not parse a prototype it will never open.
 */
const PointAConcept = lazy(async () => ({
  default: (await import('../features/concept/point-a/PointAConcept'))
    .PointAConcept,
}))

/** The Device Admin V2 concept. Same reasoning as the Point A one above. */
const AdminConcept = lazy(async () => ({
  default: (await import('../features/concept/admin/AdminConcept')).AdminConcept,
}))

/*
 * The Central Reporting V2 concept, loaded on demand.
 *
 * Lazy for the same reason the real reporting screen is: it never runs on a
 * station device, and a tablet's precache budget should not carry a design
 * review surface it will never open. It also carries the largest fixture set of
 * any concept, which is exactly the kind of weight that must not be eager.
 */
const ReportingConcept = lazy(async () => ({
  default: (await import('../features/concept/reporting/ReportingConcept')).ReportingConcept,
}))

/** The Point B V2 concept. Same reasoning as the Point A one above. */
const PointBConcept = lazy(async () => ({
  default: (await import('../features/concept/point-b/PointBConcept'))
    .PointBConcept,
}))

export interface RouteDefinition {
  readonly path: RoutePath
  /** Document title, so a device left on a station is identifiable. */
  readonly title: string
  /** Short label used in navigation. */
  readonly navLabel: string
  /** Whether the route appears in the shell's navigation. */
  readonly showInNav: boolean
  /**
   * How much shell chrome this surface wants.
   *
   * Capture surfaces ask for `minimal`: a row of links to other stations above
   * a half-filled registration form is a mis-tap that loses somebody's data.
   * Omitted means the shell's default, which is the full station navigation.
   */
  readonly chrome?: ShellChrome
  /** Which station the operator is at, for the shell's context line. */
  readonly context?: string
  readonly render: () => ReactElement
}

export const ROUTES: readonly RouteDefinition[] = [
  {
    path: '/',
    title: 'Offline Event Feedback',
    navLabel: 'Home',
    showInNav: false,
    render: () => <HomeScreen />,
  },
  {
    /*
     * Minimal chrome, from Phase 3.
     *
     * Point A is a high-throughput capture surface where the operator is
     * mid-participant several hundred times a day, and a row of links to other
     * stations above a half-filled registration form is a mis-tap that loses
     * somebody's data. The stations are still reachable through the shell's
     * menu; they are just no longer sitting over the form.
     */
    path: '/a',
    title: 'Point A: Registration',
    navLabel: 'Point A',
    showInNav: true,
    chrome: 'minimal',
    context: 'Point A · Registration',
    render: () => <RegistrationScreen />,
  },
  {
    /*
     * Minimal chrome, from Phase 5, for the same reason Point A has it: a row
     * of links to other stations above a rider midway through a questionnaire
     * is a mis-tap that loses their answers. The stations are still reachable
     * through the shell's menu.
     */
    path: '/b',
    title: 'Point B: Feedback',
    navLabel: 'Point B',
    showInNav: true,
    chrome: 'minimal',
    context: 'Point B · Feedback',
    render: () => <FeedbackScreen />,
  },
  {
    path: '/admin',
    title: 'Device Admin',
    navLabel: 'Admin',
    showInNav: true,
    render: () => <AdminScreen />,
  },
  {
    /*
     * The V2 design-system gallery. Unlisted for the same reason as reporting:
     * it is not a station, and a station tablet's navigation should offer only
     * the things an operator is meant to open mid-shift.
     */
    path: '/foundation',
    title: 'V2 Foundation',
    navLabel: 'Foundation',
    showInNav: false,
    render: () => (
      <Suspense
        fallback={
          <article className="screen">
            <p className="screen__note">Loading the design system…</p>
          </article>
        }
      >
        <FoundationScreen />
      </Suspense>
    ),
  },
  {
    /*
     * The Point A V2 concept. Unlisted, and deliberately not `/a`.
     *
     * `/a` still renders `RegistrationScreen` exactly as it did. This route is
     * a visual prototype on static fixtures: it writes nothing, calls no
     * registration function, renders no real record and prints nothing. It is
     * the only surface using `chrome="minimal"` so far, which is the point of
     * having it before the production screen moves.
     */
    path: '/concept/point-a',
    title: 'Point A concept',
    navLabel: 'Point A concept',
    showInNav: false,
    chrome: 'minimal',
    context: 'Point A · Registration',
    render: () => (
      <Suspense
        fallback={
          <article className="screen">
            <p className="screen__note">Loading the Point A concept…</p>
          </article>
        }
      >
        <PointAConcept />
      </Suspense>
    ),
  },
  {
    /*
     * The Point B V2 concept. Unlisted, and deliberately not `/b`.
     *
     * `/b` still renders `FeedbackScreen` exactly as it did. This route is a
     * visual prototype on static fixtures: it opens no camera, calls no
     * scanner, writes no feedback record and captures no identity. It uses
     * `chrome="minimal"` for the same reason Point A does, which is that a row
     * of links to other stations above a rider midway through a questionnaire
     * is a mis-tap that loses their answers.
     */
    path: '/concept/point-b',
    title: 'Point B concept',
    navLabel: 'Point B concept',
    showInNav: false,
    chrome: 'minimal',
    context: 'Point B · Feedback',
    render: () => (
      <Suspense
        fallback={
          <article className="screen">
            <p className="screen__note">Loading the Point B concept…</p>
          </article>
        }
      >
        <PointBConcept />
      </Suspense>
    ),
  },
  {
    /*
     * The Device Admin V2 concept. Unlisted, and deliberately not `/admin`.
     *
     * Full chrome, unlike the two station concepts: this is an operational and
     * support surface, not a rider mid-flow, and whoever is on it has reason to
     * move between stations.
     */
    path: '/concept/admin',
    title: 'Device Admin concept',
    navLabel: 'Admin concept',
    showInNav: false,
    render: () => (
      <Suspense
        fallback={
          <article className="screen">
            <p className="screen__note">Loading the Device Admin concept…</p>
          </article>
        }
      >
        <AdminConcept />
      </Suspense>
    ),
  },
  {
    /*
     * The Central Reporting V2 concept. Unlisted, and deliberately not
     * `/reporting`.
     *
     * `/reporting` still renders `ReportingScreen` exactly as it did. This
     * route calls no reporting API, sends no secret, runs no reconciliation,
     * downloads no export and reads nothing from IndexedDB or the central
     * database. Every participant on it is invented.
     *
     * Full chrome, like the Admin concept: an organiser deliberately entered
     * this route on a laptop, and Reporting stays out of the station nav
     * whether or not the shell is showing.
     */
    path: '/concept/reporting',
    title: 'Reporting concept',
    navLabel: 'Reporting concept',
    showInNav: false,
    render: () => (
      <Suspense
        fallback={
          <article className="screen">
            <p className="screen__note">Loading the Reporting concept…</p>
          </article>
        }
      >
        <ReportingConcept />
      </Suspense>
    ),
  },
  {
    /*
     * Deliberately absent from the shell navigation. This is the only screen
     * that shows every participant's contact details, and a station tablet
     * should not have it one mis-tap away.
     */
    path: '/reporting',
    title: 'Central Reporting',
    navLabel: 'Reporting',
    showInNav: false,
    render: () => (
      <Suspense
        fallback={
          <article className="screen">
            <p className="screen__note">Loading reporting…</p>
          </article>
        }
      >
        <ReportingScreen />
      </Suspense>
    ),
  },
]

export function routeFor(path: RoutePath | null): RouteDefinition | undefined {
  return ROUTES.find((route) => route.path === path)
}

export const NAV_LINKS = ROUTES.filter((route) => route.showInNav).map(
  (route) => ({ path: route.path, label: route.navLabel }),
)
