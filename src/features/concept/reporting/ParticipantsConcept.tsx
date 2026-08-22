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
import { ParticipantStatusPill } from './statusPills'
import { PARTICIPANTS, type ConceptParticipant, type DataState, type ParticipantStatus } from './fixtures'

/*
 * The participant browser. Read-only, and visibly so.
 *
 * There is no edit, no merge and no delete anywhere on this screen, because
 * central records are the event's evidence. What an organiser does about a
 * wrong phone number is human work at the desk, not a text field here.
 *
 * ## Search never reaches a URL
 *
 * The term is very often a phone number or an email address, and a URL is the
 * one place in a web application that is guaranteed to be copied into a server
 * access log, a browser history, and a `Referer` header on the next request.
 * So there is no query parameter, no shareable filtered link, and no search
 * history: the term lives in component state and is submitted in a POST body.
 * This concept keeps that shape, because a design that offered a shareable
 * filter would be proposing exactly the leak the real client avoids.
 */

type StatusFilter = ParticipantStatus | 'all'

const FILTERS: readonly { readonly key: StatusFilter; readonly label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'matched', label: 'Matched' },
  { key: 'without_feedback', label: 'No response' },
  { key: 'multiple_feedback', label: 'Several responses' },
]

interface ParticipantsConceptProps {
  readonly data: DataState
  readonly initialStatus?: StatusFilter
  readonly onOpen: (participant: ConceptParticipant) => void
  /** Hides the filter row where the section above already fixed the filter. */
  readonly filtersHidden?: boolean
}

export function ParticipantsConcept({
  data,
  initialStatus = 'all',
  onOpen,
  filtersHidden = false,
}: ParticipantsConceptProps) {
  const [status, setStatus] = useState<StatusFilter>(initialStatus)
  const [term, setTerm] = useState('')

  const rows =
    data === 'empty'
      ? []
      : PARTICIPANTS.filter((row) => status === 'all' || row.status === status)

  const columns: readonly DataColumn<ConceptParticipant>[] = [
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
      width: '9rem',
      hideOnNarrow: true,
      cell: (row) => (
        <span className="font-ui text-small tabular-nums text-muted">{row.phone}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '11rem',
      cell: (row) => <ParticipantStatusPill status={row.status} />,
    },
    {
      key: 'responses',
      header: 'Responses',
      numeric: true,
      width: '7rem',
      cell: (row) => (
        <span className="font-ui text-small tabular-nums text-ink">{row.responses}</span>
      ),
    },
    {
      key: 'open',
      header: '',
      width: '6rem',
      cell: () => (
        <span className="font-ui text-small text-interactive">Open</span>
      ),
    },
  ]

  if (data === 'error') {
    return (
      <ErrorState title="The central server failed to answer">
        No participant data is on screen. Try again shortly.
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
            htmlFor="participant-search"
            className="font-ui text-label font-semibold uppercase tracking-[0.1em] text-muted"
          >
            Search name, code, phone or email
          </label>
          <Input
            id="participant-search"
            type="search"
            autoComplete="off"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Ananya, A1-27CBAF-00104-6, 90000 10104…"
          />
        </div>
        <AppButton type="submit" variant="secondary">
          <SearchIcon />
          Search
        </AppButton>
      </form>

      {/*
        Said where somebody typing a phone number can read it, not buried in a
        privacy page nobody opens.
      */}
      <p className="font-body text-small text-faint">
        Search terms are sent in the request body and never placed in the
        address bar, because they are usually contact details.
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
          : `Showing ${rows.length.toLocaleString()} of 1,284 participants, more available.`}
      </p>

      <DataTable
        label="Participants"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.recordId}
        loading={data === 'loading'}
        onRowClick={onOpen}
        empty={
          <EmptyState
            title="No participants match this view"
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
