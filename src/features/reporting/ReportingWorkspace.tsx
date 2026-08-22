import { LogOutIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { AppSurface } from '../../components/design-system'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs'
import {
  describeFailure,
  fetchOverview,
  requestReconciliation,
} from '../../lib/reporting/reportingClient'
import type { OverviewResponse } from '../../lib/reporting/types'
import { AnomalyReview } from './AnomalyReview'
import { DuplicateCandidates } from './DuplicateCandidates'
import { ExportPanel } from './ExportPanel'
import { FeedbackTable } from './FeedbackTable'
import { RegistrationTable } from './RegistrationTable'
import { ReportingOverview } from './ReportingOverview'
import { RunBanner } from './RunBanner'
import { RunSelector } from './RunSelector'
import { SnapshotRail } from './SnapshotRail'
import { useReportingSession } from './session'

/*
 * The signed-in reporting screen.
 *
 * Separate from `ReportingScreen` so that everything holding central data lives
 * inside the session provider: when the session ends (Sign out, or a 401 from
 * any request), this whole subtree unmounts and the participants on screen go
 * with it, including any open detail Sheet. There is no path where the data
 * outlives the credential.
 *
 * The overview is fetched here rather than inside the Overview tab, because the
 * historical and staleness warnings have to be visible from every tab, including
 * Export. One request serves the rail, the banner and the tab.
 *
 * ## What V2 changed
 *
 * The layout and where the run context lives. The reconciliation action moved
 * out of the Overview panel and up into the snapshot rail beside the run
 * picker, because it is an action about the snapshot rather than about the
 * Overview; every section's figures change when it completes. Its behaviour is
 * unchanged: on success the screen returns to Latest and every panel re-reads.
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

  const [reconciling, setReconciling] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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

  async function reconcile() {
    setReconciling(true)
    setActionError(null)
    const result = await session.call((secret) =>
      requestReconciliation(secret, eventId),
    )
    setReconciling(false)

    if (result.ok) {
      // A new run is now the latest one; follow it rather than leaving the
      // screen pinned to the run that was current a moment ago.
      setRunId(undefined)
      setRefreshToken((token) => token + 1)
    } else {
      setActionError(describeFailure(result.failure))
    }
  }

  return (
    /* Wider than a station form: this screen is tables, read on a laptop. */
    <AppSurface width="wide" className="flex flex-col gap-page">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-accent">
            Central Reporting
          </span>
          {/*
            No counts in the title. They belong to a run, and the title does not
            change when the run does.
          */}
          <h1 className="font-display text-page leading-none tracking-wide text-ink">
            Event report
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <p className="flex flex-col text-right font-ui text-small leading-tight text-muted">
            <span>{eventName}</span>
            <span className="font-mono text-faint">{eventId}</span>
          </p>
          {/*
            Not navigation. This destroys the in-memory session: the secret is
            dropped, the workspace unmounts, and the central data it was showing
            goes with it.
          */}
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex min-h-touch items-center gap-2 rounded-control border border-line px-3.5 font-ui text-small text-muted transition-colors hover:border-line-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive"
          >
            <LogOutIcon aria-hidden="true" className="size-4" />
            Sign out
          </button>
        </div>
      </header>

      <SnapshotRail
        overview={overview}
        loading={loadingOverview}
        reconciling={reconciling}
        onReconcile={() => void reconcile()}
        onRefresh={() => void loadOverview()}
        selector={
          <RunSelector
            eventId={eventId}
            selected={runId}
            refreshToken={refreshToken}
            onSelect={setRunId}
          />
        }
      />

      <RunBanner
        overview={overview}
        {...(tab === 'export' ? { context: 'export' as const } : {})}
      />

      {/*
        Six sections, always six. Tabs on a laptop; a Select on a phone, where
        six compressed tabs are either an overflow or six unreadable labels.
        Merging any of them to save horizontal space would hide evidence.
      */}
      <nav aria-label="Reporting sections">
        <div className="hidden md:block">
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
            <TabsList>
              {TABS.map((entry) => (
                <TabsTrigger key={entry.key} value={entry.key}>
                  {entry.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="md:hidden">
          <label htmlFor="reporting-section" className="sr-only">
            Reporting section
          </label>
          <Select value={tab} onValueChange={(value) => setTab(value as Tab)}>
            <SelectTrigger id="reporting-section" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TABS.map((entry) => (
                <SelectItem key={entry.key} value={entry.key}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </nav>

      <section aria-labelledby="reporting-section-heading" className="flex flex-col">
        <h2 id="reporting-section-heading" className="sr-only">
          {TABS.find((entry) => entry.key === tab)?.label}
        </h2>

        {tab === 'overview' && (
          <ReportingOverview
            overview={overview}
            error={actionError ?? overviewError}
            loading={loadingOverview}
            onOpenSection={(section) => setTab(section as Tab)}
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
          <AnomalyReview
            eventId={eventId}
            runId={runId}
            refreshToken={refreshToken}
            overview={overview}
          />
        )}

        {tab === 'duplicates' && (
          <DuplicateCandidates
            eventId={eventId}
            runId={runId}
            refreshToken={refreshToken}
          />
        )}

        {tab === 'export' && <ExportPanel eventId={eventId} runId={runId} />}
      </section>
    </AppSurface>
  )
}
