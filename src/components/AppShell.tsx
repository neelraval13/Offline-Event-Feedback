import type { ReactNode } from 'react'
import { EVENT_CONFIG } from '../config/event'
import { AppShellV2, type ShellChrome } from './design-system/AppShellV2'
import { hrefFor, type RoutePath } from '../lib/routing/hashRoute'

export interface NavLink {
  readonly path: RoutePath
  readonly label: string
}

interface AppShellProps {
  readonly navLinks: readonly NavLink[]
  readonly activePath: RoutePath | null
  /** Which station the operator is at, for the shell's context line. */
  readonly context?: string
  /** Capture surfaces ask for `minimal`; see `AppShellV2`. */
  readonly chrome?: ShellChrome
  readonly children: ReactNode
}

/**
 * The application frame.
 *
 * Now a thin adapter over {@link AppShellV2}: it turns this application's
 * routing vocabulary into the design system's shell props and supplies the
 * event identity. The visual and structural decisions all live in the design
 * system, so a screen that wants a different amount of chrome asks for it
 * rather than building its own header.
 *
 * The event/day line is not decoration: staff running a station needs to
 * confirm at a glance which event and day this device is stamping onto the
 * records it captures.
 */
export function AppShell({
  navLinks,
  activePath,
  context,
  chrome,
  children,
}: AppShellProps) {
  return (
    <AppShellV2
      eventName={EVENT_CONFIG.eventName}
      eventDay={EVENT_CONFIG.eventDay}
      {...(context === undefined ? {} : { context })}
      {...(chrome === undefined ? {} : { chrome })}
      nav={navLinks.map((link) => ({
        href: hrefFor(link.path),
        label: link.label,
        active: link.path === activePath,
      }))}
    >
      {children}
    </AppShellV2>
  )
}
