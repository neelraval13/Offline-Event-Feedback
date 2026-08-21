import { MenuIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ParachuteMark } from '@/components/brand/marks/ParachuteMark'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/ui/cn'
import { OperationalStatus } from './OperationalStatus'

/*
 * The V2 application shell.
 *
 * ## What was wrong with the V1 shell
 *
 * A single row carrying the event name in bold, the date in grey, and three
 * underlined links. Three problems, all of them operational rather than
 * cosmetic:
 *
 *   - No product identity. On the Home screen the campaign banner rendered
 *     directly beneath it, so the screen had two headers and neither was doing
 *     the job of one.
 *   - No context. The header said which *event* the device was stamping onto
 *     records, but not which *station* the operator was standing at, which is
 *     the thing they actually need to confirm at a glance.
 *   - No status. A product whose defining property is that it survives losing
 *     the network had nowhere that said whether it was prepared to.
 *
 * ## The structure
 *
 *   brand + product     who this is, always in the same corner
 *   context             event, day, and the current station
 *   navigation          the stations, as a real tab-like row
 *   status              offline readiness, and whatever the screen adds
 *
 * ## Height is a feature
 *
 * Every row of chrome is a row of the participant's form that an operator
 * cannot see. Below `md` the header is a single non-wrapping row that sheds
 * detail rather than gaining height; see the note on the row itself.
 *
 * ## Navigation is not forced on every flow
 *
 * `chrome="minimal"` collapses the navigation to a single way back. Point A
 * and Point B are high-throughput capture surfaces where the operator is
 * mid-participant several hundred times a day, and a row of tempting links to
 * other stations at the top of a half-filled registration form is a mis-tap
 * that loses somebody's data. Reporting and Admin are information surfaces and
 * get the full navigation.
 *
 * Same shell, same tokens, same components, different amount of chrome. That
 * is the difference between adapting to a flow and having two products.
 */

export type ShellChrome = 'full' | 'minimal'

export interface ShellNavItem {
  readonly href: string
  readonly label: string
  readonly active: boolean
}

interface AppShellV2Props {
  /** Product identity: the event this device is stamping onto records. */
  readonly eventName: string
  readonly eventDay: string
  /** Which station the operator is standing at. The thing they check. */
  readonly context?: string
  readonly nav: readonly ShellNavItem[]
  readonly chrome?: ShellChrome
  /** Extra status beside connectivity: sync state, pending counts. */
  readonly status?: ReactNode
  readonly children: ReactNode
}

export function AppShellV2({
  eventName,
  eventDay,
  context,
  nav,
  chrome = 'full',
  status,
  children,
}: AppShellV2Props) {
  const [navOpen, setNavOpen] = useState(false)

  return (
    /*
     * Note what this root does NOT carry: the `v2` class.
     *
     * The scoped reset in `src/styles/v2/reset.css` applies to `.v2` and every
     * descendant, so putting it here would reach straight through `main` into
     * the four screens that are still rendered by the V1 stylesheet and unstyle
     * their headings, lists and controls: precisely the breakage that scoping
     * the reset was meant to avoid, reintroduced by the shell.
     *
     * The class therefore sits on the header, which is V2, and on whatever each
     * screen puts inside `main` (V2 screens use `AppSurface`, which adds it).
     * Tailwind's utilities need no reset and work in both worlds, so the root
     * can still use them for the page background and layout.
     */
    <div className="flex min-h-screen flex-col bg-canvas font-ui text-base text-ink">
      <header className="v2 sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur-sm">
        {/*
          One row, at every width, deliberately never wrapping.

          The first version wrapped, and on a phone the result was three stacked
          rows of chrome before a single word of the actual screen: roughly a
          fifth of the first viewport spent telling an operator things they
          already knew. Below `md` the row now sheds detail instead of gaining
          height, and what it sheds reappears in the navigation sheet, which is
          one tap away and is where somebody who wants to check the event is
          already going.
        */}
        <div className="mx-auto flex w-full max-w-wide items-center gap-3 px-gutter py-2 md:gap-4 md:py-2.5">
          {/* Brand. Always the first thing, always in the same corner. */}
          <a
            href="#/"
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-control md:gap-2.5',
              'transition-opacity hover:opacity-80',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
            )}
          >
            <ParachuteMark height={22} className="text-accent" />
            <span className="flex flex-col leading-none">
              <span className="font-display text-base tracking-wide text-ink md:text-lead">
                Flying Flea
              </span>
              {/* The strapline is identity, not information. It goes first. */}
              <span className="mt-0.5 hidden font-ui text-caption font-semibold uppercase tracking-[0.16em] text-faint md:block">
                Event Operations
              </span>
            </span>
          </a>

          <div className="hidden h-7 w-px shrink-0 bg-line md:block" />

          {/*
            Context, at two levels of detail.

            Wide enough, and the operator gets the event, the day and the
            station. Narrow, and they get the one line that changes between
            devices: which station this is. The event and day are constant for
            the whole deployment, so repeating them on a phone costs a row of
            height to restate something that was true an hour ago.
          */}
          <div className="hidden min-w-0 flex-col leading-tight md:flex">
            <span className="truncate font-ui text-small font-medium text-ink">
              {eventName}
            </span>
            <span className="font-ui text-caption text-faint">
              {eventDay}
              {context !== undefined && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="text-muted">{context}</span>
                </>
              )}
            </span>
          </div>

          {/*
            Nothing at all when there is no station to name.

            The first attempt fell back to the event day here, and at 430px it
            truncated to "2026-0…", which is not a smaller version of a fact: it
            is noise that looks like a bug. A phone header should drop what it
            cannot show rather than show a stump of it, and the day is one tap
            away in the sheet either way.
          */}
          {context !== undefined && (
            <span className="min-w-0 flex-1 truncate font-ui text-small text-muted md:hidden">
              {context}
            </span>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1.5 md:gap-2">
            {status}
            <OperationalStatus />

            {chrome === 'full' && nav.length > 0 && (
              <Sheet open={navOpen} onOpenChange={setNavOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-mr-2 md:hidden"
                    aria-label="Open navigation"
                  >
                    <MenuIcon />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left">
                  <SheetHeader>
                    <SheetTitle>Stations</SheetTitle>
                    {/*
                      Where the event identity goes on a phone. Not decoration:
                      this is the confirmation the header gave up, kept one tap
                      away rather than dropped.
                    */}
                    <p className="font-ui text-small text-muted">
                      {eventName}
                    </p>
                    <p className="font-ui text-caption text-faint">
                      {eventDay}
                      {context !== undefined && (
                        <>
                          <span aria-hidden="true"> · </span>
                          {context}
                        </>
                      )}
                    </p>
                  </SheetHeader>
                  <nav className="flex flex-col gap-1" aria-label="Stations">
                    {nav.map((item) => (
                      <a
                        key={item.href}
                        href={item.href}
                        onClick={() => setNavOpen(false)}
                        aria-current={item.active ? 'page' : undefined}
                        className={cn(
                          'flex min-h-touch items-center rounded-control px-3',
                          'font-ui text-lead font-medium transition-colors',
                          item.active
                            ? 'bg-interactive-soft text-ink'
                            : 'text-muted hover:bg-surface hover:text-ink',
                        )}
                      >
                        {item.label}
                      </a>
                    ))}
                  </nav>
                </SheetContent>
              </Sheet>
            )}
          </div>
        </div>

        {/*
          The station row. A real navigation band rather than three links
          floated to the right, so the current station is unmistakable: an
          operator glancing down at a tablet sees which desk this device is.
        */}
        {chrome === 'full' && nav.length > 0 && (
          <nav
            aria-label="Stations"
            className="mx-auto hidden w-full max-w-wide gap-1 px-gutter md:flex"
          >
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                aria-current={item.active ? 'page' : undefined}
                className={cn(
                  'relative -mb-px inline-flex min-h-11 items-center border-b-2 px-3.5',
                  'font-ui text-base font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive focus-visible:ring-inset',
                  item.active
                    ? 'border-interactive text-ink'
                    : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {item.label}
              </a>
            ))}
          </nav>
        )}
      </header>

      <main className="flex-1 px-gutter py-page">{children}</main>
    </div>
  )
}
