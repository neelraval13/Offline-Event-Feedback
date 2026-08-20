import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { describeFailure, queryFeedback } from '../../lib/reporting/reportingClient'
import type {
  FeedbackReconciliationStatus,
  FeedbackRow,
} from '../../lib/reporting/types'
import { FeedbackDetail } from './FeedbackDetail'
import { ratingCell } from './ratingCell'
import { captureLabel, codeLabel, participantLabel } from './responseIdentity'
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
 */

type StatusFilter = FeedbackReconciliationStatus | 'all'

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  matched: 'Matched',
  without_registration: 'No registration',
  /*
   * Not "no registration", although that is what it literally is. This is the
   * contact path working as designed, and a label phrased as an absence would
   * put valid feedback under a heading that reads like a fault.
   */
  standalone: 'Direct feedback',
  identity_conflict: 'Identity conflict',
  multiple_feedback: 'In a multiple-response group',
}


interface FeedbackTableProps {
  readonly eventId: string
  readonly runId: string | undefined
  readonly refreshToken: number
  readonly initialStatus?: StatusFilter
}

export function FeedbackTable({
  eventId,
  runId,
  refreshToken,
  initialStatus = 'all',
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

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    setSearch(searchInput.trim())
  }

  return (
    <section aria-labelledby="feedback-table-heading">
      <h2 id="feedback-table-heading" className="pending__title">
        Responses
      </h2>

      <form className="button-row" onSubmit={submitSearch} role="search">
        <label className="field__label" htmlFor="feedback-search">
          Search by code, name, phone or email
        </label>
        <input
          id="feedback-search"
          className="field__input"
          type="search"
          autoComplete="off"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <button type="submit" className="button">
          Search
        </button>
        {search.length > 0 && (
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              setSearchInput('')
              setSearch('')
            }}
          >
            Clear
          </button>
        )}
      </form>

      <div className="button-row" role="group" aria-label="Filter by status">
        {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((option) => (
          <button
            key={option}
            type="button"
            className="choice"
            aria-pressed={status === option}
            onClick={() => setStatus(option)}
          >
            {STATUS_LABELS[option]}
          </button>
        ))}
      </div>

      {error !== null && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}

      <p className="screen__note" aria-live="polite">
        {loading && rows.length === 0
          ? 'Loading…'
          : `Showing ${rows.length.toLocaleString()} response(s)${cursor === null ? '' : ', more available'}.`}
      </p>

      <table className="report-table">
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Captured</th>
            <th scope="col">Participant</th>
            <th scope="col">Status</th>
            <th scope="col">Rating</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.recordId}>
              <td>
                {row.publicCode === null ? (
                  // Said in words, not as an empty cell: a blank in a column
                  // of codes reads as data that failed to load.
                  <span>{codeLabel(row)}</span>
                ) : (
                  <span className="recent__code">{row.publicCode}</span>
                )}
              </td>
              <td>{captureLabel(row)}</td>
              <td>{participantLabel(row)}</td>
              {/* Always a status: a run contains exactly what it classified. */}
              <td>{STATUS_LABELS[row.reconciliationStatus]}</td>
              {/* Read per questionnaire: the two this build knows do not
                  share a rating key or a scale. See `ratingCell.ts`. */}
              <td>{ratingCell(row)}</td>
              <td>
                <button
                  type="button"
                  className="button button--small"
                  onClick={() =>
                    setSelected((current) =>
                      current === row.recordId ? null : row.recordId,
                    )
                  }
                >
                  {selected === row.recordId ? 'Hide' : 'Open'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 && !loading && error === null && (
        <p className="screen__note">No responses match this view.</p>
      )}

      {cursor !== null && (
        <div className="button-row">
          <button
            type="button"
            className="button"
            disabled={loading}
            onClick={() => void load(cursor)}
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
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
    </section>
  )
}
