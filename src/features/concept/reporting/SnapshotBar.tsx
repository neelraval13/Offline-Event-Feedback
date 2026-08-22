import { ClockIcon, HistoryIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { AppButton } from '../../../components/design-system'
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'
import { cn } from '@/lib/ui/cn'
import { RUNS, STALE, type ConceptRun, type RunState } from './fixtures'

/*
 * Which snapshot the whole screen is reporting on, and whether it still
 * describes the event.
 *
 * Every classification, count and anomaly in Reporting is a conclusion from one
 * immutable reconciliation run. That makes the selected run the single most
 * load-bearing fact on the screen, and the easiest one to lose: the production
 * version is a `<select>` labelled "Reconciliation run" among the other
 * controls, which is accurate and completely unmemorable.
 *
 * So the snapshot is its own rail, above the section navigation and present on
 * every section. It carries the timestamp and the two record counts as the
 * human-facing identity of the run; the run ID is there for a support call and
 * nothing is asked to remember it.
 *
 * ## Two different warnings
 *
 * Historical and stale are not the same thing and must not read as one.
 *
 *   historical  an older run. Legitimate evidence: it is what the event looked
 *               like when a figure was quoted. Not an error.
 *   stale       records arrived, or were revised, after the run completed. The
 *               conclusions are still sound about what they classified; they
 *               are simply no longer the whole event.
 *
 * Both are amber, and both say so in words as well: an operator with a monitor
 * in daylight, or with a common colour vision deficiency, gets the same message
 * as everybody else.
 */

interface SnapshotBarProps {
  readonly runState: RunState
  readonly run: ConceptRun
  readonly onRunState: (state: RunState) => void
  readonly reconciling: boolean
  readonly onReconcile: () => void
  /** Adds the sentence that matters when a file is about to be produced. */
  readonly context?: 'export'
}

export function SnapshotBar({
  runState,
  run,
  onRunState,
  reconciling,
  onReconcile,
  context,
}: SnapshotBarProps) {
  const historical = runState === 'historical'
  const stale = runState === 'latest-stale'

  return (
    <section aria-labelledby="snapshot-heading" className="flex flex-col gap-3">
      <h2 id="snapshot-heading" className="sr-only">
        Report snapshot
      </h2>

      <div
        className={cn(
          'flex flex-col gap-4 rounded-card border px-5 py-4',
          'lg:flex-row lg:items-center lg:justify-between',
          historical
            ? 'border-warn-line bg-warn-soft/30'
            : 'border-line bg-surface',
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
              {run.completedAt}
            </span>
            <span className="font-ui text-small tabular-nums text-muted">
              {run.registrations.toLocaleString()} registrations ·{' '}
              {run.responses.toLocaleString()} responses
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/*
            Timestamp and counts, not run IDs. Nobody chooses between
            `run_01JQ8F3M2C7B4K` and `run_01JQ7Y0T5H9D2M`; they choose between
            "the five o'clock one" and "the one from lunchtime".
          */}
          <label htmlFor="concept-run" className="sr-only">
            Reconciliation run
          </label>
          <Select
            value={runState === 'historical' ? 'historical' : 'latest'}
            onValueChange={(value) =>
              onRunState(value === 'historical' ? 'historical' : 'latest')
            }
          >
            <SelectTrigger id="concept-run" className="min-w-[19rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">
                Latest · {RUNS[0]?.completedAt} ·{' '}
                {RUNS[0]?.registrations.toLocaleString()} registrations
              </SelectItem>
              <SelectItem value="historical">
                {RUNS[1]?.completedAt} · {RUNS[1]?.registrations.toLocaleString()}{' '}
                registrations
              </SelectItem>
            </SelectContent>
          </Select>

          <AppButton
            variant="secondary"
            busy={reconciling}
            busyLabel="Reconciling…"
            onClick={onReconcile}
          >
            <RefreshCwIcon />
            Run reconciliation
          </AppButton>
        </div>
      </div>

      {historical && (
        <Alert tone="warn">
          <HistoryIcon aria-hidden="true" />
          <AlertTitle>
            Historical snapshot, reconciled {run.completedAt}
          </AlertTitle>
          <AlertDescription>
            Every status, count and anomaly on this screen is that run&rsquo;s
            conclusion. Names, contact details and answers are the current
            values and may have been corrected since, so a participant&rsquo;s
            details here can legitimately differ from what the run saw. A newer
            reconciliation exists for this event. This is valid evidence, not an
            error.
          </AlertDescription>
        </Alert>
      )}

      {stale && (
        <Alert tone="warn">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>Event data changed since this snapshot</AlertTitle>
          <AlertDescription>
            {STALE.registrationsAdded} registrations and {STALE.responsesAdded}{' '}
            responses arrived, or existing records changed, after this
            reconciliation completed. Last change {STALE.latestContentChangeAt}.
            Run reconciliation for a current picture.
            {context === 'export' && (
              <>
                {' '}
                <strong>
                  A file downloaded now describes the selected snapshot, not the
                  event as it currently exists.
                </strong>{' '}
                It will not contain those {STALE.registrationsAdded} registrations
                or {STALE.responsesAdded} responses. Reconcile first for a
                current final report.
              </>
            )}
          </AlertDescription>
        </Alert>
      )}
    </section>
  )
}
