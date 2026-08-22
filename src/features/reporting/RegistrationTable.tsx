import { useCallback, useEffect, useState } from 'react'
import {
  AppButton,
  DataTable,
  EmptyState,
  ErrorState,
  type DataColumn,
} from '../../components/design-system'
import {
  describeFailure,
  queryRegistrations,
} from '../../lib/reporting/reportingClient'
import type {
  RegistrationRow,
  RegistrationReconciliationStatus,
} from '../../lib/reporting/types'
import { RegistrationDetail } from './RegistrationDetail'
import {
  FilterChips,
  REGISTRATION_STATUS_LABELS,
  RegistrationStatusPill,
  SearchForm,
} from './statusPills'
import { useReportingSession } from './session'

/*
 * The participant browser.
 *
 * Read-only. There is no edit, no merge and no delete: central records are the
 * event's evidence, and this phase's job is to let an organiser see them, not
 * to let them be rewritten after the fact.
 *
 * The search term is sent in a POST body. It is very often a phone number, and
 * a phone number in a URL ends up in the server's access log and the browser's
 * history.
 *
 * ## What V2 changed
 *
 * Presentation. The query, the cursor, the filters and the detail request are
 * untouched. The detail moved from a panel appended below the table into a
 * right-side Sheet, because opening one participant in a list of a thousand
 * should not move the rows around them: the next action is almost always to
 * close it and open the next, and a layout that shifts several hundred pixels
 * each time makes that a hunt.
 */

type StatusFilter = RegistrationReconciliationStatus | 'all'

const FILTERS: readonly { readonly key: StatusFilter; readonly label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'matched', label: REGISTRATION_STATUS_LABELS.matched },
  { key: 'without_feedback', label: REGISTRATION_STATUS_LABELS.without_feedback },
  { key: 'multiple_feedback', label: REGISTRATION_STATUS_LABELS.multiple_feedback },
]

interface RegistrationTableProps {
  readonly eventId: string
  readonly runId: string | undefined
  readonly refreshToken: number
  /** Opens the browser pre-filtered, used by the anomaly screens. */
  readonly initialStatus?: StatusFilter
  readonly duplicatesOnly?: boolean
  /**
   * Hides the status chips where something above has already chosen the
   * filter. Needs review picks a category and then shows this table; two rows
   * of status controls that can disagree with each other is one row too many.
   */
  readonly filtersHidden?: boolean
}

export function RegistrationTable({
  eventId,
  runId,
  refreshToken,
  initialStatus = 'all',
  duplicatesOnly = false,
  filtersHidden = false,
}: RegistrationTableProps) {
  const session = useReportingSession()
  const [status, setStatus] = useState<StatusFilter>(initialStatus)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<readonly RegistrationRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(
    async (nextCursor: string | null) => {
      setLoading(true)
      const result = await session.call((secret) =>
        queryRegistrations(secret, {
          eventId,
          ...(runId === undefined ? {} : { runId }),
          ...(status === 'all' ? {} : { status }),
          ...(search.length === 0 ? {} : { search }),
          ...(duplicatesOnly ? { duplicateCandidateOnly: true } : {}),
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
      // A cursor means "continue", so append; otherwise this is a fresh query.
      setRows((previous) =>
        nextCursor === null ? result.value.rows : [...previous, ...result.value.rows],
      )
    },
    [session, eventId, runId, status, search, duplicatesOnly],
  )

  useEffect(() => {
    setSelected(null)
    void load(null)
  }, [load, refreshToken])

  const columns: readonly DataColumn<RegistrationRow>[] = [
    {
      key: 'code',
      header: 'Code',
      width: '13rem',
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-small text-ink">{row.publicCode}</span>
          {row.potentialDuplicate && (
            <span className="font-ui text-caption uppercase tracking-[0.08em] text-warn">
              Possible duplicate
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'participant',
      header: 'Participant',
      cell: (row) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-body text-base text-ink">{row.name}</span>
          <span className="truncate font-ui text-small text-faint">{row.email}</span>
        </span>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      width: '10rem',
      hideOnNarrow: true,
      cell: (row) => (
        <span className="font-ui text-small tabular-nums text-muted">{row.phone}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '11rem',
      /* Always a status: a run contains exactly what it classified. */
      cell: (row) => <RegistrationStatusPill status={row.reconciliationStatus} />,
    },
    {
      key: 'responses',
      header: 'Responses',
      numeric: true,
      width: '9rem',
      cell: (row) => (
        <span className="flex flex-col items-end gap-0.5">
          <span className="font-ui text-small tabular-nums text-ink">
            {row.validFeedbackCount}
          </span>
          {/*
            Absent for several responses, because the server sends no summary
            there: showing one of them would present a guess as the
            participant's answer.

            Also absent when the summary carries no rating. `overallRating` is
            the `feedback-v1` field and is null under any other questionnaire,
            so V1's "rated none" told a reader that a Flying Flea rider had
            skipped a question they had in fact answered on a different scale.
            The count beside it is unaffected, and the answer itself is one
            click away in the detail panel. This is the same mistake
            `ratingCell.ts` exists to prevent in the response list.
          */}
          {row.feedbackSummary?.overallRating != null && (
            <span className="font-ui text-caption text-faint">
              rated {row.feedbackSummary.overallRating}
            </span>
          )}
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
        id="registration-search"
        label="Search name, code, phone or email"
        placeholder="Name, code, phone or email"
        value={searchInput}
        onChange={setSearchInput}
        onSubmit={() => setSearch(searchInput.trim())}
        onClear={() => {
          setSearchInput('')
          setSearch('')
        }}
        hasSearch={search.length > 0}
      />

      {!duplicatesOnly && !filtersHidden && (
        <FilterChips
          label="Filter by status"
          options={FILTERS}
          value={status}
          onChange={setStatus}
        />
      )}

      {error !== null && (
        <ErrorState title="Participants could not be read">{error}</ErrorState>
      )}

      <p aria-live="polite" className="font-body text-small text-muted">
        {loading && rows.length === 0
          ? 'Loading…'
          : `Showing ${rows.length.toLocaleString()} participant(s)${cursor === null ? '' : ', more available'}.`}
      </p>

      <DataTable
        label="Participants"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.recordId}
        loading={loading && rows.length === 0}
        onRowClick={(row) => setSelected(row.recordId)}
        isRowSelected={(row) => row.recordId === selected}
        empty={
          error === null ? (
            <EmptyState
              title="No participants match this view"
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
        <RegistrationDetail
          eventId={eventId}
          runId={runId}
          recordId={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
