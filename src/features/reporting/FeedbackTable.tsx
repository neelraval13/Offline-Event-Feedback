import { useCallback, useEffect, useState } from 'react'
import {
  AppButton,
  DataTable,
  EmptyState,
  ErrorState,
  type DataColumn,
} from '../../components/design-system'
import { describeFailure, queryFeedback } from '../../lib/reporting/reportingClient'
import type {
  FeedbackReconciliationStatus,
  FeedbackRow,
} from '../../lib/reporting/types'
import { FeedbackDetail } from './FeedbackDetail'
import { ratingCell } from './ratingCell'
import { captureLabel, codeLabel, participantLabel } from './responseIdentity'
import {
  FEEDBACK_STATUS_LABELS,
  FeedbackStatusPill,
  FilterChips,
  SearchForm,
} from './statusPills'
import { useReportingSession } from './session'

/*
 * The response browser.
 *
 * Every response is listed, including the ones reconciliation could not attach
 * to a participant. Those are the interesting ones operationally: a response
 * with no registration usually means a code was mistyped at Point B, and it is
 * still someone's opinion of the event.
 *
 * Direct feedback is listed here on exactly the same terms as everything else.
 * It is a rider who identified themselves by contact details and matched no
 * registration, which is the ordinary outcome for somebody who never went
 * through Point A, not an anomaly.
 *
 * ## Two findings that look alike and mean the opposite
 *
 *   No registration   a sticker code that resolved to nobody. Something went
 *                     wrong: a typo, or a Point A device that has not synced.
 *   Direct feedback   the contact path working as designed.
 *
 * Two filters, two labels, two treatments. Collapsing them into one bucket
 * would file every direct respondent as a fault and bury the genuine typos.
 */

type StatusFilter = FeedbackReconciliationStatus | 'all'

const FILTERS: readonly { readonly key: StatusFilter; readonly label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'matched', label: FEEDBACK_STATUS_LABELS.matched },
  { key: 'without_registration', label: FEEDBACK_STATUS_LABELS.without_registration },
  { key: 'standalone', label: FEEDBACK_STATUS_LABELS.standalone },
  { key: 'identity_conflict', label: FEEDBACK_STATUS_LABELS.identity_conflict },
  { key: 'multiple_feedback', label: FEEDBACK_STATUS_LABELS.multiple_feedback },
]

interface FeedbackTableProps {
  readonly eventId: string
  readonly runId: string | undefined
  readonly refreshToken: number
  readonly initialStatus?: StatusFilter
  /** Hidden where Needs review has already chosen the status above. */
  readonly filtersHidden?: boolean
}

export function FeedbackTable({
  eventId,
  runId,
  refreshToken,
  initialStatus = 'all',
  filtersHidden = false,
}: FeedbackTableProps) {
  const session = useReportingSession()
  const [status, setStatus] = useState<StatusFilter>(initialStatus)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<readonly FeedbackRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(
    async (nextCursor: string | null) => {
      setLoading(true)
      const result = await session.call((secret) =>
        queryFeedback(secret, {
          eventId,
          ...(runId === undefined ? {} : { runId }),
          ...(status === 'all' ? {} : { status }),
          ...(search.length === 0 ? {} : { search }),
          ...(nextCursor === null ? {} : { cursor: nextCursor }),
        }),
      )
      setLoading(false)

      if (!result.ok) {
        setError(describeFailure(result.failure))
        return
      }

      setError(null)
      setCursor(result.value.nextCursor)
      setRows((previous) =>
        nextCursor === null ? result.value.rows : [...previous, ...result.value.rows],
      )
    },
    [session, eventId, runId, status, search],
  )

  useEffect(() => {
    setSelected(null)
    void load(null)
  }, [load, refreshToken])

  const columns: readonly DataColumn<FeedbackRow>[] = [
    {
      key: 'identity',
      header: 'Identity',
      width: '13rem',
      cell: (row) =>
        row.publicCode === null ? (
          /* Said in words. A blank in a column of codes reads as data that
             failed to load, and the first thing anybody does about that is go
             looking for a code that never existed. */
          <span className="font-ui text-small text-faint">{codeLabel(row)}</span>
        ) : (
          <span className="font-mono text-small text-ink">{row.publicCode}</span>
        ),
    },
    {
      key: 'captured',
      header: 'Captured via',
      width: '10rem',
      hideOnNarrow: true,
      cell: (row) => (
        <span className="font-ui text-small text-muted">{captureLabel(row)}</span>
      ),
    },
    {
      key: 'participant',
      header: 'Participant',
      cell: (row) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-body text-base text-ink">
            {participantLabel(row)}
          </span>
          {row.respondentEmail !== null && (
            <span className="truncate font-ui text-small text-faint">
              {row.respondentEmail}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '15rem',
      /* Always a status: a run contains exactly what it classified. */
      cell: (row) => <FeedbackStatusPill status={row.reconciliationStatus} />,
    },
    {
      key: 'rating',
      header: 'Rating',
      numeric: true,
      width: '8rem',
      /* Read per questionnaire: the two this build knows share neither a
         rating key nor a scale. See `ratingCell.ts`. */
      cell: (row) => (
        <span className="font-ui text-small tabular-nums text-ink">
          {ratingCell(row)}
        </span>
      ),
    },
    {
      key: 'open',
      header: '',
      width: '5rem',
      cell: () => <span className="font-ui text-small text-interactive">Open</span>,
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <SearchForm
        id="feedback-search"
        label="Search by code, name, phone or email"
        placeholder="Code, name, phone or email"
        value={searchInput}
        onChange={setSearchInput}
        onSubmit={() => setSearch(searchInput.trim())}
        onClear={() => {
          setSearchInput('')
          setSearch('')
        }}
        hasSearch={search.length > 0}
      />

      {!filtersHidden && (
        <FilterChips
          label="Filter by status"
          options={FILTERS}
          value={status}
          onChange={setStatus}
        />
      )}

      {error !== null && (
        <ErrorState title="Responses could not be read">{error}</ErrorState>
      )}

      <p aria-live="polite" className="font-body text-small text-muted">
        {loading && rows.length === 0
          ? 'Loading…'
          : `Showing ${rows.length.toLocaleString()} response(s)${cursor === null ? '' : ', more available'}.`}
      </p>

      <DataTable
        label="Responses"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.recordId}
        loading={loading && rows.length === 0}
        onRowClick={(row) => setSelected(row.recordId)}
        isRowSelected={(row) => row.recordId === selected}
        empty={
          error === null ? (
            <EmptyState
              title="No responses match this view"
              description="Clear the search or choose a different filter."
            />
          ) : null
        }
      />

      {cursor !== null && (
        <div>
          <AppButton
            variant="secondary"
            busy={loading}
            busyLabel="Loading…"
            onClick={() => void load(cursor)}
          >
            Load more
          </AppButton>
        </div>
      )}

      {selected !== null && (
        <FeedbackDetail
          eventId={eventId}
          runId={runId}
          recordId={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
