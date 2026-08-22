import { ClockIcon, HistoryIcon, RefreshCwIcon, RotateCwIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { AppButton } from '../../components/design-system'
import { cn } from '@/lib/ui/cn'
import type { OverviewResponse } from '../../lib/reporting/types'

/*
 * Which snapshot the whole screen is reporting on, stated once and prominently.
 *
 * Every classification, count and anomaly in Reporting is a conclusion from one
 * immutable reconciliation run, which makes the selected run the most
 * load-bearing fact on the screen and the easiest one to lose. V1 carried it as
 * a labelled `<select>` among the other controls; an operator could read the
 * whole Overview without noticing which run produced it.
 *
 * So it gets its own rail, above the section navigation, on every section. The
 * human-facing identity is the completion timestamp and the two record counts.
 * The run id is not shown: nobody chooses between two ULIDs, and anyone who
 * needs one has the export's Metadata sheet.
 *
 * Presentation only. The run picker and the reconcile action are passed in as
 * children and actions; this component decides where they sit and what the
 * snapshot is called, and reads nothing but the overview it is given.
 */

interface SnapshotRailProps {
  readonly overview: OverviewResponse | null
  readonly loading: boolean
  /** The run picker. Owns its own fetch and its own Latest semantics. */
  readonly selector: ReactNode
  readonly reconciling: boolean
  readonly onReconcile: () => void
  readonly onRefresh: () => void
}

export function SnapshotRail({
  overview,
  loading,
  selector,
  reconciling,
  onReconcile,
  onRefresh,
}: SnapshotRailProps) {
  const historical = overview?.isHistoricalRun === true

  return (
    <section aria-labelledby="snapshot-heading" className="flex flex-col">
      <h2 id="snapshot-heading" className="sr-only">
        Report snapshot
      </h2>

      <div
        className={cn(
          'flex flex-col gap-4 rounded-card border px-5 py-4',
          'lg:flex-row lg:items-center lg:justify-between',
          /*
            The rail itself goes amber on a historical run. The banner below
            explains it; this is what makes an operator notice before they have
            read anything.
          */
          historical ? 'border-warn-line bg-warn-soft/30' : 'border-line bg-surface',
        )}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="flex items-center gap-2 font-ui text-label font-semibold uppercase tracking-[0.16em] text-muted">
            {historical ? (
              <HistoryIcon aria-hidden="true" className="size-3.5 text-warn" />
            ) : (
              <ClockIcon aria-hidden="true" className="size-3.5" />
            )}
            Report snapshot
          </span>

          {overview === null ? (
            <p className="font-ui text-base text-muted">
              {loading ? 'Reading the reconciliation run…' : 'No run selected.'}
            </p>
          ) : (
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                className={cn(
                  'font-ui text-title font-semibold',
                  historical ? 'text-warn' : 'text-ink',
                )}
              >
                {historical ? 'Historical snapshot' : 'Current snapshot'}
              </span>
              <span className="font-ui text-base tabular-nums text-ink">
                {new Date(overview.run.completedAt).toLocaleString()}
              </span>
              <span className="font-ui text-small tabular-nums text-muted">
                {overview.run.counts.registrationCount.toLocaleString()}{' '}
                registrations ·{' '}
                {overview.run.counts.feedbackCount.toLocaleString()} responses
              </span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {selector}

          {/*
            Reconciliation reads the central records and writes a new run. It
            never edits, merges or deletes a registration or a response, so it
            gets no destructive confirmation: a dialog would teach an operator
            that this is dangerous, and the next thing they would do is avoid
            the one action that makes the report current.
          */}
          <AppButton
            variant="secondary"
            busy={reconciling}
            busyLabel="Reconciling…"
            onClick={onReconcile}
          >
            <RefreshCwIcon />
            Run reconciliation
          </AppButton>

          <AppButton variant="ghost" disabled={loading} onClick={onRefresh}>
            <RotateCwIcon />
            Refresh
          </AppButton>
        </div>
      </div>

      <p className="pt-2 font-body text-small text-faint">
        Reconciliation reads the central records and writes a new run. It never
        edits, merges or deletes a registration or a response. Every figure on
        this screen describes exactly the records the selected run classified.
      </p>
    </section>
  )
}
