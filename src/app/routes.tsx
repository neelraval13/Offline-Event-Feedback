import { lazy, Suspense, type ReactElement } from 'react'
import { AdminScreen } from '../features/admin/AdminScreen'
import { FeedbackScreen } from '../features/feedback/FeedbackScreen'
import { HomeScreen } from '../features/home/HomeScreen'
import { RegistrationScreen } from '../features/registration/RegistrationScreen'
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

export interface RouteDefinition {
  readonly path: RoutePath
  /** Document title, so a device left on a station is identifiable. */
  readonly title: string
  /** Short label used in navigation. */
  readonly navLabel: string
  /** Whether the route appears in the shell's navigation. */
  readonly showInNav: boolean
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
    path: '/a',
    title: 'Point A: Registration',
    navLabel: 'Point A',
    showInNav: true,
    render: () => <RegistrationScreen />,
  },
  {
    path: '/b',
    title: 'Point B: Feedback',
    navLabel: 'Point B',
    showInNav: true,
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
