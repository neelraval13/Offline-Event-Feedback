import { TriangleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription } from '../../components/ui/alert'
import type { LocalCounts } from '../../lib/storage'
import { cn } from '../../lib/ui/cn'
import { FactRow, SectionHead } from './console'

/**
 * How much data is on this device, and how much of it exists nowhere else.
 *
 * Counts only. A support screen never needs a participant's name, and putting
 * one on a desk-facing display would be a privacy leak that buys nothing.
 *
 * The pending figures are the ones that matter operationally: a pending record
 * lives on exactly one machine, and that number is the size of the loss if the
 * machine is dropped. So the totals are quiet and first, and "waiting to sync"
 * gets its own panel that turns amber the moment it is not zero. Six equal
 * figures in a row, which is what V1 rendered, says they are equally important,
 * and they are not.
 *
 * The counts are read once for the whole console and passed in, so the overview
 * at the top and this section cannot disagree.
 */
interface LocalDataPanelProps {
  readonly counts: LocalCounts | null
  readonly error: string | null
}

export function LocalDataPanel({ counts, error }: LocalDataPanelProps) {
  const format = (value: number) => value.toLocaleString()
  const waiting =
    counts === null
      ? 0
      : counts.registrations.pending + counts.feedback.pending

  /*
   * "Counting…" only while it is still true. Once the read has failed, the
   * ellipsis is a promise of a number that is not coming, sitting directly
   * under an alert saying the data could not be read.
   */
  const value = (read: (counts: LocalCounts) => number) =>
    counts !== null
      ? format(read(counts))
      : error !== null
        ? 'Unavailable'
        : 'Counting…'

  return (
    <section aria-labelledby="local-data-heading" className="flex flex-col">
      <SectionHead
        title="Local data"
        note="Counts only. No participant details."
      />
      <h2 id="local-data-heading" className="sr-only">
        Local data
      </h2>

      {error !== null && (
        <Alert tone="danger" className="mb-3">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription>
            Local data could not be read: {error}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-x-10 md:grid-cols-2">
        <div className="flex flex-col">
          <FactRow label="Registrations">
            <span data-testid="count-registrations" className="font-ui tabular-nums">
              {value((c) => c.registrations.total)}
            </span>
          </FactRow>
          <FactRow label="Feedback">
            <span data-testid="count-feedback" className="font-ui tabular-nums">
              {value((c) => c.feedback.total)}
            </span>
          </FactRow>
          <FactRow label="Synced">
            <span
              data-testid="count-synced"
              className="font-ui tabular-nums text-muted"
            >
              {value((c) => c.registrations.synced + c.feedback.synced)}
            </span>
          </FactRow>
          <FactRow label="Errors">
            <span
              data-testid="count-error"
              className={cn(
                'font-ui tabular-nums',
                counts !== null &&
                  counts.registrations.error + counts.feedback.error > 0 &&
                  'text-danger',
              )}
            >
              {value((c) => c.registrations.error + c.feedback.error)}
            </span>
          </FactRow>
        </div>

        <div
          className={cn(
            'mt-3 flex flex-col rounded-card border px-4 py-1 md:mt-0',
            waiting > 0
              ? 'border-warn-line bg-warn-soft/40'
              : 'border-line bg-surface',
          )}
        >
          <p className="pt-3 font-ui text-label font-semibold uppercase tracking-[0.1em] text-muted">
            Waiting to sync
          </p>
          <FactRow label="Registrations">
            <span
              data-testid="count-registrations-pending"
              className="font-ui text-stat-small font-semibold tabular-nums"
            >
              {value((c) => c.registrations.pending)}
            </span>
          </FactRow>
          <FactRow label="Feedback">
            <span
              data-testid="count-feedback-pending"
              className="font-ui text-stat-small font-semibold tabular-nums"
            >
              {value((c) => c.feedback.pending)}
            </span>
          </FactRow>
          <p className="border-t border-line py-3 font-body text-small text-muted">
            {error !== null
              ? 'How much is waiting here is not known while the store cannot be read.'
              : waiting > 0 || counts === null
                ? 'These exist only on this device. Keep an encrypted backup.'
                : 'Everything captured here has reached the central database.'}
          </p>
        </div>
      </div>
    </section>
  )
}
