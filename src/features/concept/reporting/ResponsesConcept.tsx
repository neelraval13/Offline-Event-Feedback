import { SearchIcon } from 'lucide-react'
import { useState } from 'react'
import {
  AppButton,
  DataTable,
  EmptyState,
  ErrorState,
  type DataColumn,
} from '../../../components/design-system'
import { Input } from '../../../components/ui/input'
import { cn } from '@/lib/ui/cn'
import { CAPTURE_LABELS, ResponseStatusPill } from './statusPills'
import { RESPONSES, type ConceptResponse, type DataState, type ResponseStatus } from './fixtures'

/*
 * The response browser.
 *
 * Every response is listed, including the ones reconciliation could not attach
 * to a participant: a mistyped code at Point B is still somebody's opinion of
 * the event.
 *
 * ## "No registration" and "Direct feedback" are different findings
 *
 * They look almost identical in the data, one response and no registration
 * attached, and they mean opposite things:
 *
 *   No registration   a sticker code that resolved to nobody. Something went
 *                     wrong: a typo, or a Point A device that has not synced.
 *   Direct feedback   a rider who gave their contact details at Point B and
 *                     never registered. The path working as designed.
 *
 * Two filters, two labels, two treatments. Collapsing them into one "no
 * registration" bucket would file every direct respondent as a fault, which is
 * both wrong and the fastest way to make the genuine typos unfindable.
 */

type StatusFilter = ResponseStatus | 'all'

const FILTERS: readonly { readonly key: StatusFilter; readonly label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'matched', label: 'Matched' },
  { key: 'without_registration', label: 'No registration' },
  { key: 'standalone', label: 'Direct feedback' },
  { key: 'identity_conflict', label: 'Identity conflict' },
  { key: 'multiple_feedback', label: 'In a multiple-response group' },
]

interface ResponsesConceptProps {
  readonly data: DataState
  readonly initialStatus?: StatusFilter
  readonly onOpen: (response: ConceptResponse) => void
  readonly filtersHidden?: boolean
}

export function ResponsesConcept({
  data,
  initialStatus = 'all',
  onOpen,
  filtersHidden = false,
}: ResponsesConceptProps) {
  const [status, setStatus] = useState<StatusFilter>(initialStatus)
  const [term, setTerm] = useState('')

  const all =
    data === 'mixed'
      ? RESPONSES
      : RESPONSES.filter((row) => row.formVersion === 'flying-flea-feedback-v1')

  const rows =
    data === 'empty'
      ? []
      : all.filter((row) => status === 'all' || row.status === status)

  const columns: readonly DataColumn<ConceptResponse>[] = [
    {
      key: 'identity',
      header: 'Identity',
      width: '13rem',
      cell: (row) =>
        row.publicCode === null ? (
          /* Said in words. A blank in a column of codes reads as data that
             failed to load, and the first thing anybody does about that is go
             looking for a code that never existed. */
          <span className="font-ui text-small text-faint">No code</span>
        ) : (
          <span className="font-mono text-small text-ink">{row.publicCode}</span>
        ),
    },
    {
      key: 'captured',
      header: 'Captured via',
      width: '9rem',
      hideOnNarrow: true,
      cell: (row) => (
        <span className="font-ui text-small text-muted">
          {CAPTURE_LABELS[row.captureMethod] ?? row.captureMethod}
        </span>
      ),
    },
    {
      key: 'participant',
      header: 'Participant',
      cell: (row) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-body text-base text-ink">
            {row.participantName ?? row.respondentName ?? 'None'}
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
      cell: (row) => <ResponseStatusPill status={row.status} />,
    },
    {
      key: 'rating',
      header: 'Rating',
      numeric: true,
      width: '8rem',
      cell: (row) => (
        /* Never a bare number: `5` is ambiguous between a 1-5 and a 1-7
           questionnaire, and this table shows both. */
        <span className="font-ui text-small tabular-nums text-ink">{row.rating}</span>
      ),
    },
    {
      key: 'open',
      header: '',
      width: '6rem',
      cell: () => <span className="font-ui text-small text-interactive">Open</span>,
    },
  ]

  if (data === 'error') {
    return (
      <ErrorState title="The central server failed to answer">
        No response data is on screen. Try again shortly.
      </ErrorState>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        role="search"
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label
            htmlFor="response-search"
            className="font-ui text-label font-semibold uppercase tracking-[0.1em] text-muted"
          >
            Search by code, name, phone or email
          </label>
          <Input
            id="response-search"
            type="search"
            autoComplete="off"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="A1-27CBAF-00104-6, Meera, 90000 20031…"
          />
        </div>
        <AppButton type="submit" variant="secondary">
          <SearchIcon />
          Search
        </AppButton>
      </form>

      <p className="font-body text-small text-faint">
        Search terms are sent in the request body and never placed in the address
        bar, because they are usually contact details.
      </p>

      {!filtersHidden && (
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              aria-pressed={status === filter.key}
              onClick={() => setStatus(filter.key)}
              className={cn(
                'min-h-touch rounded-chip border px-3.5 font-ui text-small transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive',
                status === filter.key
                  ? 'border-interactive bg-interactive-soft font-medium text-ink'
                  : 'border-line bg-surface text-muted hover:text-ink',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      )}

      <p aria-live="polite" className="font-body text-small text-muted">
        {data === 'loading'
          ? 'Loading…'
          : `Showing ${rows.length.toLocaleString()} of 1,109 responses, more available.`}
      </p>

      <DataTable
        label="Responses"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.recordId}
        loading={data === 'loading'}
        onRowClick={onOpen}
        empty={
          <EmptyState
            title="No responses match this view"
            description="Clear the search or choose a different filter."
          />
        }
      />

      {rows.length > 0 && data !== 'loading' && (
        <div>
          <AppButton variant="secondary">Load more</AppButton>
        </div>
      )}
    </div>
  )
}
