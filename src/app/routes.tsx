import type { ReactElement } from 'react'
import { AdminScreen } from '../features/admin/AdminScreen'
import { FeedbackScreen } from '../features/feedback/FeedbackScreen'
import { HomeScreen } from '../features/home/HomeScreen'
import { RegistrationScreen } from '../features/registration/RegistrationScreen'
import type { RoutePath } from '../lib/routing/hashRoute'

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
    title: 'Point A — Registration',
    navLabel: 'Point A',
    showInNav: true,
    render: () => <RegistrationScreen />,
  },
  {
    path: '/b',
    title: 'Point B — Feedback',
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
]

export function routeFor(path: RoutePath | null): RouteDefinition | undefined {
  return ROUTES.find((route) => route.path === path)
}

export const NAV_LINKS = ROUTES.filter((route) => route.showInNav).map(
  (route) => ({ path: route.path, label: route.navLabel }),
)
