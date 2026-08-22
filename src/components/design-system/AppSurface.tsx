import type { ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * The V2 root, and the boundary of the design system.
 *
 * Everything V2 renders sits inside a `.v2` element. That class is what the
 * scoped reset in `src/styles/v2/reset.css` hangs off, so the boundary is not
 * a convention that can be forgotten: a component rendered outside it simply
 * does not get the normalisation, and it shows immediately.
 *
 * The two width modes are the reason this is a component rather than a `div`
 * with a class, because the choice between them is a real design decision that
 * every screen has to make:
 *
 *   measure  a reading and input measure, about 46rem. Prose, and any form
 *            short enough to be one column. A paragraph stretched across a
 *            27-inch monitor is not more readable.
 *   station  60rem. A capture terminal: Point A and Point B. Wide enough for
 *            two columns of fields and a motorcycle beside its colour control,
 *            narrow enough that a label and its field stay in one glance.
 *   wide     up to 88rem. Device Admin and Central Reporting. These carry
 *            tables of ten thousand participants, and squeezing them into a
 *            reading measure is why the current Admin screen looks like a form
 *            that grew rather than a console.
 *
 * This is how the design system serves very different kinds of surface without
 * becoming unrelated visual languages: same tokens, same components, same
 * shell, different measure.
 */

export type SurfaceWidth = 'measure' | 'station' | 'wide' | 'full'

const WIDTHS: Readonly<Record<SurfaceWidth, string>> = {
  measure: 'max-w-measure',
  station: 'max-w-station',
  wide: 'max-w-wide',
  /* No cap. For a scanner viewport or anything that owns the whole screen. */
  full: 'max-w-none',
}

interface AppSurfaceProps {
  readonly width?: SurfaceWidth
  readonly children: ReactNode
  readonly className?: string
}

export function AppSurface({
  width = 'measure',
  children,
  className,
}: AppSurfaceProps) {
  return (
    <div
      className={cn(
        'v2 mx-auto w-full font-ui text-base text-ink',
        WIDTHS[width],
        className,
      )}
    >
      {children}
    </div>
  )
}
