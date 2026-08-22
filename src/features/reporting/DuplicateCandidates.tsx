import { InfoIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState, ErrorState, LoadingState } from '../../components/design-system'
import { Alert, AlertDescription } from '../../components/ui/alert'
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
 * So nothing here merges, deletes, or marks a pair confirmed. The pair is shown
 * with both public codes and a human decides, off this screen.
 *
 * ## What V2 changed
 *
 * The comparison. V1 rendered a table row with two multi-line cells, which
 * leaves the reader to do the diffing themselves. The two records are now
 * parallel columns with aligned labels, so the eye can run down one line and
 * see which values differ, and the field that matched is marked on both sides:
 * "same phone" is the reason the pair exists and should not have to be
 * inferred. On a narrow viewport the two stack, which loses the side-by-side
 * scan; every alternative loses the values themselves.
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
    <div className="flex flex-col gap-5">
      <p className="max-w-measure font-body text-base text-muted">
        Pairs sharing a normalised phone number or email address. A shared number
        is common and legitimate at an event, so these are possibilities to
        check, not duplicates to remove. Names are never matched on.
      </p>

      <Alert tone="neutral">
        <InfoIcon aria-hidden="true" />
        <AlertDescription>
          Merging is not available. This product never rewrites a participant
          record: the registrations are the event&rsquo;s evidence, and deciding
          that two of them are one person is a judgement made by a human, off
          this screen.
        </AlertDescription>
      </Alert>

      {error !== null && (
        <ErrorState title="Duplicate candidates could not be read">{error}</ErrorState>
      )}

      {loading && <LoadingState label="Reading duplicate candidates…" rows={3} />}

      {truncated && (
        <Alert tone="warn" role="status">
          <InfoIcon aria-hidden="true" />
          <AlertDescription>
            Showing {candidates.length.toLocaleString()} of{' '}
            {total.toLocaleString()} pairs this run found. Export the possible
            duplicates CSV for the complete list; it is never truncated.
          </AlertDescription>
        </Alert>
      )}

      {!loading && error === null && candidates.length === 0 && (
        <EmptyState
          title="No pairs share a phone number or email"
          description="Nothing in this run looks like the same person registering twice."
        />
      )}

      {candidates.length > 0 && (
        <div className="flex flex-col gap-4">
          {candidates.map((candidate) => (
            <Pair
              key={`${candidate.left.recordId}:${candidate.right.recordId}`}
              candidate={candidate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Pair({ candidate }: { readonly candidate: DuplicateCandidateRow }) {
  const phoneMatched = candidate.matchBasis !== 'email_only'
  const emailMatched = candidate.matchBasis !== 'phone_only'

  return (
    <section className="flex flex-col rounded-card border border-line bg-surface">
      <h3 className="border-b border-line px-5 py-3 font-ui text-label font-semibold uppercase tracking-[0.14em] text-warn">
        Matched on: {BASIS_LABELS[candidate.matchBasis]}
      </h3>

      <div className="grid md:grid-cols-2">
        {[candidate.left, candidate.right].map((side, index) => (
          <div
            key={side.recordId}
            className={
              index === 0
                ? 'flex flex-col border-b border-line px-5 py-4 md:border-b-0 md:border-r'
                : 'flex flex-col px-5 py-4'
            }
          >
            <span className="pb-2 font-ui text-caption uppercase tracking-[0.1em] text-faint">
              Registration {index === 0 ? 'A' : 'B'}
            </span>
            <Field label="Code" value={side.publicCode} mono />
            <Field label="Name" value={side.name} />
            <Field label="Phone" value={side.phone} matched={phoneMatched} />
            <Field label="Email" value={side.email} matched={emailMatched} />
          </div>
        ))}
      </div>
    </section>
  )
}

function Field({
  label,
  value,
  mono = false,
  matched = false,
}: {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
  readonly matched?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line py-2.5 first:border-t-0">
      <span className="font-ui text-caption uppercase tracking-[0.08em] text-faint">
        {label}
        {/* The word as well as the colour: this is the reason the pair exists. */}
        {matched && <span className="pl-1.5 text-warn">Matched</span>}
      </span>
      <span
        className={
          mono
            ? 'break-all font-mono text-small text-ink'
            : matched
              ? 'break-words font-body text-base font-medium text-warn'
              : 'break-words font-body text-base text-ink'
        }
      >
        {value}
      </span>
    </div>
  )
}
