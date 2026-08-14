import { useCallback, useEffect, useState } from 'react'
import { describeFailure, fetchOverview } from '../../lib/reporting/reportingClient'
import type { OverviewResponse } from '../../lib/reporting/types'
import { AnomalyReview } from './AnomalyReview'
import { DuplicateCandidates } from './DuplicateCandidates'
import { ExportPanel } from './ExportPanel'
import { FeedbackTable } from './FeedbackTable'
import { RegistrationTable } from './RegistrationTable'
import { ReportingOverview } from './ReportingOverview'
import { RunBanner } from './RunBanner'
import { RunSelector } from './RunSelector'
import { useReportingSession } from './session'

/*
 * The signed-in reporting screen.
 *
 * Separate from `ReportingScreen` so that everything holding central data lives
 * inside the session provider: when the session ends (Sign out, or a 401 from
 * any request), this whole subtree unmounts and the participants on screen go
 * with it. There is no path where the data outlives the credential.
 *
 * The overview is fetched here rather than inside the Overview tab, because the
 * historical and staleness warnings have to be visible from every tab, including
 * Export. One request serves both the banner and the tab.
 */

type Tab = 'overview' | 'participants' | 'responses' | 'review' | 'duplicates' | 'export'

const TABS: readonly { readonly key: Tab; readonly label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'participants', label: 'Participants' },
  { key: 'responses', label: 'Responses' },
  { key: 'review', label: 'Needs review' },
  { key: 'duplicates', label: 'Duplicates' },
  { key: 'export', label: 'Export' },
]

interface ReportingWorkspaceProps {
  readonly eventId: string
  readonly eventName: string
  readonly onSignOut: () => void
}

export function ReportingWorkspace({
  eventId,
  eventName,
  onSignOut,
}: ReportingWorkspaceProps) {
  const session = useReportingSession()

  const [tab, setTab] = useState<Tab>('overview')
  /*
   * Undefined means "whichever run is latest", resolved by the server. An
   * explicit run id is how an operator revisits the figures a decision was made
   * on, which runs being immutable is what makes possible.
   */
  const [runId, setRunId] = useState<string | undefined>(undefined)
  /** Bumped after a reconciliation run so every panel re-reads. */
  const [refreshToken, setRefreshToken] = useState(0)

  const [overview, setOverview] = useState<OverviewResponse | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [loadingOverview, setLoadingOverview] = useState(true)

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true)
    const result = await session.call((secret) =>
      fetchOverview(secret, eventId, runId),
    )
    setLoadingOverview(false)

    if (result.ok) {
      setOverview(result.value)
      setOverviewError(null)
    } else {
      setOverview(null)
      setOverviewError(describeFailure(result.failure))
    }
  }, [session, eventId, runId])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview, refreshToken])

  return (
    /* Wider than a station form: this screen is tables, read on a laptop. */
    <article className="screen screen--wide">
      <h1>Central reporting</h1>
      <div className="button-row">
        <span className="screen__note">
          {eventName} ({eventId})
        </span>
        <button type="button" className="button button--small" onClick={onSignOut}>
          Sign out
        </button>
      </div>

      <RunSelector
        eventId={eventId}
        selected={runId}
        refreshToken={refreshToken}
        onSelect={setRunId}
      />

      <RunBanner
        overview={overview}
        {...(tab === 'export' ? { context: 'export' as const } : {})}
      />

      <nav className="button-row" aria-label="Reporting sections">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="choice"
            aria-pressed={tab === entry.key}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <ReportingOverview
          eventId={eventId}
          overview={overview}
          error={overviewError}
          loading={loadingOverview}
          onReload={() => void loadOverview()}
          onReconciled={() => {
            // A new run is now the latest one; follow it rather than leaving the
            // screen pinned to the run that was current a moment ago.
            setRunId(undefined)
            setRefreshToken((token) => token + 1)
          }}
        />
      )}

      {tab === 'participants' && (
        <RegistrationTable
          eventId={eventId}
          runId={runId}
          refreshToken={refreshToken}
        />
      )}

      {tab === 'responses' && (
        <FeedbackTable eventId={eventId} runId={runId} refreshToken={refreshToken} />
      )}

      {tab === 'review' && (
        <AnomalyReview eventId={eventId} runId={runId} refreshToken={refreshToken} />
      )}

      {tab === 'duplicates' && (
        <DuplicateCandidates
          eventId={eventId}
          runId={runId}
          refreshToken={refreshToken}
        />
      )}

      {tab === 'export' && <ExportPanel eventId={eventId} runId={runId} />}
    </article>
  )
}
