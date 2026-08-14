import { useEffect, useState } from 'react'
import { describeFailure, fetchRuns } from '../../lib/reporting/reportingClient'
import type { RunDescriptor } from '../../lib/reporting/types'
import { useReportingSession } from './session'

/*
 * Which reconciliation run the whole screen is reporting on.
 *
 * Runs accumulate and are never overwritten, so an older one is a legitimate
 * thing to look at: it is what the event looked like when a figure was quoted in
 * a meeting. Being able to return to it is the difference between "the number
 * changed" and "the number was wrong".
 *
 * Latest is the default, and it is resolved by the server rather than pinned
 * here — the client should not have to know which run is current.
 */

interface RunSelectorProps {
  readonly eventId: string
  readonly selected: string | undefined
  readonly refreshToken: number
  readonly onSelect: (runId: string | undefined) => void
}

export function RunSelector({
  eventId,
  selected,
  refreshToken,
  onSelect,
}: RunSelectorProps) {
  const session = useReportingSession()
  const [runs, setRuns] = useState<readonly RunDescriptor[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void (async () => {
      const result = await session.call((secret) => fetchRuns(secret, eventId))
      if (!active) {
        return
      }
      if (result.ok) {
        setRuns(result.value.runs)
        setError(null)
      } else {
        setRuns([])
        setError(describeFailure(result.failure))
      }
    })()

    return () => {
      active = false
    }
  }, [session, eventId, refreshToken])

  if (error !== null) {
    return (
      <p className="notice notice--error" role="alert">
        {error}
      </p>
    )
  }

  if (runs.length === 0) {
    return null
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor="reporting-run">
        Reconciliation run
      </label>
      <select
        id="reporting-run"
        className="field__input"
        value={selected ?? ''}
        onChange={(event) =>
          onSelect(event.target.value === '' ? undefined : event.target.value)
        }
      >
        <option value="">Latest ({runs.length} run(s) recorded)</option>
        {runs.map((run) => (
          <option key={run.runId} value={run.runId}>
            {new Date(run.completedAt).toLocaleString()} —{' '}
            {run.counts.registrationCount.toLocaleString()} registrations,{' '}
            {run.counts.feedbackCount.toLocaleString()} responses
          </option>
        ))}
      </select>
    </div>
  )
}
