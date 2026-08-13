import type { ReactNode } from 'react'
import { EVENT_CONFIG } from '../config/event'
import { hrefFor, type RoutePath } from '../lib/routing/hashRoute'

export interface NavLink {
  readonly path: RoutePath
  readonly label: string
}

interface AppShellProps {
  readonly navLinks: readonly NavLink[]
  readonly activePath: RoutePath | null
  readonly children: ReactNode
}

/**
 * Frame shared by every surface: event context on top, navigation, content.
 *
 * The event/day banner is not decoration — staff running a station needs to be
 * able to confirm at a glance which event and day this device is stamping onto
 * the records it captures.
 */
export function AppShell({ navLinks, activePath, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <div className="app-shell__event">
          <strong>{EVENT_CONFIG.eventName}</strong>
          <span className="app-shell__meta">{EVENT_CONFIG.eventDay}</span>
        </div>
        <nav className="app-shell__nav" aria-label="Surfaces">
          {navLinks.map((link) => (
            <a
              key={link.path}
              href={hrefFor(link.path)}
              className="app-shell__nav-link"
              aria-current={link.path === activePath ? 'page' : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="app-shell__main">{children}</main>
    </div>
  )
}
