import {
  ChevronRightIcon,
  KeyboardIcon,
  ScanLineIcon,
  UserIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AppButton } from '@/components/design-system'
import { cn } from '@/lib/ui/cn'

/*
 * The first thing a rider or an operator sees at Point B.
 *
 * ## Three paths, two weights, one meaning
 *
 * There are three legitimate ways to identify a rider, and the design has to
 * say two things at once that pull in opposite directions:
 *
 *   - Scanning is the fastest, so it should be the obvious thing to reach for.
 *   - The other two are not fallbacks. A rider who never registered at Point A
 *     has nothing to scan and nothing to type, and their feedback counts
 *     exactly as much as anybody else's.
 *
 * So the weight difference is about *convenience* and lives only between the
 * scan action and the rest: one large primary button. The *validity* difference
 * is zero, and that shows in the two rows below being identical to each other
 * in size, treatment and target height. Neither is nested under the other,
 * neither is phrased as a failure, and the line under the heading says outright
 * that all three record the same thing.
 *
 * V1 offered these as three buttons of near-equal weight in a row, which read
 * as three unlabelled choices and made the operator read all three every time.
 * Three SaaS cards would be the other failure: a lot of chrome to say "pick
 * one of three", and a rider-facing screen that looks like a pricing page.
 */

interface IdentityChoiceProps {
  readonly onScan: () => void
  readonly onManual: () => void
  readonly onContact: () => void
}

export function IdentityChoice({
  onScan,
  onManual,
  onContact,
}: IdentityChoiceProps) {
  return (
    <section aria-labelledby="identify-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2
          id="identify-heading"
          className="font-display text-title tracking-wide text-ink"
        >
          Identify rider
        </h2>
        <p className="max-w-measure font-body text-lead text-muted">
          Any of these three records the same feedback. Scanning is simply the
          quickest.
        </p>
      </div>

      {/*
        The fast path. Large because it is quick to reach for, not because the
        others are lesser.
      */}
      <AppButton size="lg" onClick={onScan} className="min-h-16 justify-start gap-4 px-5">
        <ScanLineIcon className="size-6" />
        <span className="flex flex-col items-start gap-0.5 text-left">
          <span className="font-ui text-lead font-semibold">Scan QR</span>
          <span className="font-body text-small font-normal opacity-80">
            Point the camera at the sticker
          </span>
        </span>
      </AppButton>

      <div className="flex flex-col border-t border-line">
        <ChoiceRow
          icon={KeyboardIcon}
          title="Enter code"
          detail="Type the code printed under the QR"
          onClick={onManual}
        />
        <ChoiceRow
          icon={UserIcon}
          title="No QR or code"
          detail="Take the rider's name, phone and email instead"
          onClick={onContact}
        />
      </div>
    </section>
  )
}

interface ChoiceRowProps {
  readonly icon: LucideIcon
  readonly title: string
  readonly detail: string
  readonly onClick: () => void
}

/**
 * One alternate path.
 *
 * Identical to its sibling in every respect that carries meaning: same height,
 * same weight, same border, same icon size. The only thing that differs between
 * the two rows is what they say, which is the point.
 */
function ChoiceRow({ icon: Icon, title, detail, onClick }: ChoiceRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-touch items-center gap-4 border-b border-line px-1 py-4 text-left',
        'transition-colors duration-150 hover:bg-surface',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive',
      )}
    >
      <Icon aria-hidden="true" className="size-5 shrink-0 text-interactive" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-ui text-base font-semibold text-ink">{title}</span>
        <span className="font-body text-small text-muted">{detail}</span>
      </span>
      {/* An affordance, not a meaning: everything this row says, it says in
          words. A QR glyph here would be actively wrong on the second row. */}
      <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-faint" />
    </button>
  )
}
