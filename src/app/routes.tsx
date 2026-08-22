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
