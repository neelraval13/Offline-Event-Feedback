import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  describeFailure,
  queryRegistrations,
} from '../../lib/reporting/reportingClient'
import type {
  RegistrationRow,
  RegistrationReconciliationStatus,
} from '../../lib/reporting/types'
import { RegistrationDetail } from './RegistrationDetail'
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
 */

type StatusFilter = RegistrationReconciliationStatus | 'all'

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  matched: 'Matched',
  without_feedback: 'No response',
  multiple_feedback: 'Several responses',
}

interface RegistrationTableProps {
  readonly eventId: string
  readonly runId: string | undefined
  readonly refreshToken: number
  /** Opens the browser pre-filtered, used by the anomaly screens. */
  readonly initialStatus?: StatusFilter
  readonly duplicatesOnly?: boolean
}

export function RegistrationTable({
  eventId,
  runId,
  refreshToken,
  initialStatus = 'all',
  duplicatesOnly = false,
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

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    setSearch(searchInput.trim())
  }

  return (
    <section aria-labelledby="registration-table-heading">
      <h2 id="registration-table-heading" className="pending__title">
        Participants
      </h2>

      <form className="button-row" onSubmit={submitSearch} role="search">
        <label className="field__label" htmlFor="registration-search">
          Search name, code, phone or email
        </label>
        <input
          id="registration-search"
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

      {!duplicatesOnly && (
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
      )}

      {error !== null && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}

      <p className="screen__note" aria-live="polite">
        {loading && rows.length === 0
          ? 'Loading…'
          : `Showing ${rows.length.toLocaleString()} participant(s)${cursor === null ? '' : ', more available'}.`}
      </p>

      <table className="report-table">
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Name</th>
            <th scope="col">Phone</th>
            <th scope="col">Status</th>
            <th scope="col">Responses</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.recordId}>
              <td>
                <span className="recent__code">{row.publicCode}</span>
                {row.potentialDuplicate && (
                  <span className="report-flag" title="Possible duplicate registration">
                    {' '}
                    possible duplicate
                  </span>
                )}
              </td>
              <td>{row.name}</td>
              <td>{row.phone}</td>
              {/* Always a status: a run contains exactly what it classified. */}
              <td>{STATUS_LABELS[row.reconciliationStatus]}</td>
              <td>
                {row.validFeedbackCount}
                {/*
                  Deliberately blank for several responses: showing one of them
                  would present a guess as the participant's answer.
                */}
                {row.feedbackSummary !== null &&
                  `, rated ${row.feedbackSummary.overallRating ?? 'none'}`}
              </td>
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
        <p className="screen__note">No participants match this view.</p>
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
        <RegistrationDetail
          eventId={eventId}
          runId={runId}
          recordId={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  )
}
