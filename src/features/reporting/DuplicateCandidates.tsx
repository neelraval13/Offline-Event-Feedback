import { useEffect, useState } from 'react'
import {
  describeFailure,
  fetchDuplicateCandidates,
} from '../../lib/reporting/reportingClient'
import type { DuplicateCandidateRow } from '../../lib/reporting/types'
import { useReportingSession } from './session'

/*
 * Registrations that might be the same person.
 *
 * Candidates, deliberately, matched on exact normalised phone or email, never
 * on a name. Two people at one event share a phone number often enough
 * (a couple, a parent and child, a company mobile) that treating a match as
 * proof would corrupt the participant list.
 *
 * So nothing here merges. The pair is shown side by side with both public
 * codes, and a human decides whether it is one person, off this screen.
 */

const BASIS_LABELS: Record<DuplicateCandidateRow['matchBasis'], string> = {
  phone_and_email: 'Same phone and email',
  phone_only: 'Same phone',
  email_only: 'Same email',
}

interface DuplicateCandidatesProps {
  readonly eventId: string
  readonly runId: string | undefined
  readonly refreshToken: number
}

export function DuplicateCandidates({
  eventId,
  runId,
  refreshToken,
}: DuplicateCandidatesProps) {
  const session = useReportingSession()
  const [candidates, setCandidates] = useState<readonly DuplicateCandidateRow[]>([])
  const [total, setTotal] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)

    void (async () => {
      const result = await session.call((secret) =>
        fetchDuplicateCandidates(secret, eventId, runId),
      )
      if (!active) {
        return
      }
      setLoading(false)

      if (result.ok) {
        setCandidates(result.value.candidates)
        setTotal(result.value.totalCandidates)
        setTruncated(result.value.truncated)
        setError(null)
      } else {
        setCandidates([])
        setTotal(0)
        setTruncated(false)
        setError(describeFailure(result.failure))
      }
    })()

    return () => {
      active = false
    }
  }, [session, eventId, runId, refreshToken])

  return (
    <section aria-labelledby="duplicates-heading">
      <h2 id="duplicates-heading" className="pending__title">
        Possible duplicate registrations
      </h2>

      <p className="screen__note">
        Pairs sharing a normalised phone number or email address. A shared
        number is common and legitimate at an event, so these are possibilities
        to check, not duplicates to remove. Merging is not available: this phase
        never rewrites a participant record.
      </p>

      {error !== null && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}

      {loading && <p className="screen__note">Loading…</p>}

      {truncated && (
        <p className="notice" role="status">
          Showing {candidates.length.toLocaleString()} of{' '}
          {total.toLocaleString()} pairs this run found. Export the duplicate
          candidates CSV for the complete list; it is never truncated.
        </p>
      )}

      {!loading && error === null && candidates.length === 0 && (
        <p className="screen__note">No pairs share a phone number or email.</p>
      )}

      <table className="report-table">
        <thead>
          <tr>
            <th scope="col">Matched on</th>
            <th scope="col">Registration</th>
            <th scope="col">Registration</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => (
            <tr key={`${candidate.left.recordId}:${candidate.right.recordId}`}>
              <td>{BASIS_LABELS[candidate.matchBasis]}</td>
              {[candidate.left, candidate.right].map((side) => (
                <td key={side.recordId}>
                  <span className="recent__code">{side.publicCode}</span>
                  <br />
                  {side.name}
                  <br />
                  {side.phone}
                  <br />
                  {side.email}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
