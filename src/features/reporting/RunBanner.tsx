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
 * Rendered above the tabs, on every tab, for as long as either is true.
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

  return (
    <>
      {isHistoricalRun && (
        <p className="notice notice--warning" role="status">
          <strong>Viewing a historical run</strong> — reconciled{' '}
          {completed}. Every status, count and anomaly on this screen is that
          run&rsquo;s conclusion, not the current one. Names, phone numbers,
          email addresses and answers are the <strong>current</strong> canonical
          values and may have been corrected since, so a participant&rsquo;s
          details here can legitimately differ from what the run saw. A newer
          reconciliation exists for this event.
        </p>
      )}

      {freshness.dataChangedSinceRun && (
        <p className="notice notice--warning" role="status">
          <strong>This run no longer describes the event.</strong> Since it
          completed at {completed},{' '}
          {freshness.registrationsAddedSinceRun.toLocaleString()} registration(s)
          and {freshness.feedbackAddedSinceRun.toLocaleString()} response(s) have
          arrived that it never classified
          {freshness.latestContentChangeAt === null
            ? ''
            : `, or existing records were revised (last change ${new Date(
                freshness.latestContentChangeAt,
              ).toLocaleString()})`}
          . Run reconciliation on the Overview tab for a current picture.
          {context === 'export' && (
            <>
              {' '}
              <strong>
                A file produced now will describe the event as it was at{' '}
                {completed}, not as it is.
              </strong>{' '}
              Reconcile first if this is a final report.
            </>
          )}
        </p>
      )}
    </>
  )
}
