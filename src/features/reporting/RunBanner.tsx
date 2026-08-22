import { HistoryIcon, TriangleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import type { OverviewResponse } from '../../lib/reporting/types'

/*
 * The two warnings that must never be hidden behind a tab.
 *
 * An operator who opens Participants, Responses or Export directly is looking at
 * one run's conclusions and current contact details, and both of those facts
 * change what the screen means. Putting the warning only on the Overview tab
 * would mean the person exporting a file is the person least likely to have read
 * it.
 *
 * Rendered above the section navigation, on every section, for as long as either
 * is true.
 *
 * ## Two different warnings
 *
 * Historical and stale are not the same thing and must not read as one.
 *
 *   historical  an older run. Legitimate evidence: it is what the event looked
 *               like when a figure was quoted. Not an error, and V2 says so in
 *               those words, because amber alone gets read as "something is
 *               wrong here".
 *   stale       records arrived, or were revised, after the run completed. Its
 *               conclusions are still sound about what it classified; they are
 *               simply no longer the whole event.
 *
 * Both carry their meaning in words as well as in colour: this screen is read
 * on a laptop in a venue office, and one reader in twelve cannot rely on the
 * amber.
 *
 * Every figure below comes from `OverviewResponse`. Nothing here computes
 * freshness, and nothing infers it from a timestamp comparison in the browser.
 */

interface RunBannerProps {
  readonly overview: OverviewResponse | null
  /** Emphasises the staleness warning where acting on it matters most. */
  readonly context?: 'export'
}

export function RunBanner({ overview, context }: RunBannerProps) {
  if (overview === null) {
    return null
  }

  const { run, freshness, isHistoricalRun } = overview
  const completed = new Date(run.completedAt).toLocaleString()

  if (!isHistoricalRun && !freshness.dataChangedSinceRun) {
    return null
  }

  return (
    <div className="flex flex-col gap-3">
      {isHistoricalRun && (
        <Alert tone="warn" role="status">
          <HistoryIcon aria-hidden="true" />
          <AlertTitle>Historical snapshot, reconciled {completed}</AlertTitle>
          <AlertDescription>
            Every status, count and anomaly on this screen is that run&rsquo;s
            conclusion, not the current one. Names, phone numbers, email
            addresses and answers are the <strong>current</strong> canonical
            values and may have been corrected since, so a participant&rsquo;s
            details here can legitimately differ from what the run saw. A newer
            reconciliation exists for this event. This is valid evidence, not an
            error.
          </AlertDescription>
        </Alert>
      )}

      {freshness.dataChangedSinceRun && (
        <Alert tone="warn" role="status">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>Event data changed since this snapshot</AlertTitle>
          <AlertDescription>
            {freshness.registrationsAddedSinceRun.toLocaleString()} registration(s)
            and {freshness.feedbackAddedSinceRun.toLocaleString()} response(s)
            arrived that this run never classified
            {freshness.latestContentChangeAt === null
              ? ''
              : `, or existing records were revised (last change ${new Date(
                  freshness.latestContentChangeAt,
                ).toLocaleString()})`}
            . It completed at {completed}. Run reconciliation for a current
            picture.
            {context === 'export' && (
              <>
                {' '}
                <strong>
                  A file downloaded now describes the selected snapshot, not the
                  event as it currently exists.
                </strong>{' '}
                It will not contain what arrived afterwards. Reconcile first for
                a current final report.
              </>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
