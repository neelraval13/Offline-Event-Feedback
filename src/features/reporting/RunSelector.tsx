import { useEffect, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { TriangleAlertIcon } from 'lucide-react'
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
 * here: the client should not have to know which run is current. The empty
 * string is the sentinel for that, exactly as before, and `onSelect` still
 * receives `undefined` for it.
 *
 * ## What V2 changed
 *
 * Presentation only. V1 rendered a labelled `<select>` among the other controls,
 * which is accurate and completely unmemorable, on the screen where the
 * selected run is the most load-bearing fact there is. It now sits in the
 * snapshot rail, and its options lead with the timestamp and the record counts
 * rather than the run id: nobody chooses between `run_01JQ8F` and `run_01JQ7Y`,
 * they choose between the five o'clock one and the one from lunchtime.
 *
 * The request, the sentinel and the callback are untouched.
 */

interface RunSelectorProps {
  readonly eventId: string
  readonly selected: string | undefined
  readonly refreshToken: number
  readonly onSelect: (runId: string | undefined) => void
}

/**
 * The sentinel for "whichever run is latest".
 *
 * Radix reserves the empty string for "no value at all", so Latest needs a
 * token of its own. It is mapped back to `undefined` before it leaves this
 * component, which is what the rest of the screen and the server mean by it.
 */
const LATEST = '__latest__'

/** `2026-02-01T08:00:00.000Z` as an operator reads it. */
function moment(value: string): string {
  return new Date(value).toLocaleString()
}

function describeRun(run: RunDescriptor): string {
  return `${moment(run.completedAt)} · ${run.counts.registrationCount.toLocaleString()} registrations, ${run.counts.feedbackCount.toLocaleString()} responses`
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
      <Alert tone="danger">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (runs.length === 0) {
    return null
  }

  const latest = runs[0]

  return (
    <>
      <label htmlFor="reporting-run" className="sr-only">
        Reconciliation run
      </label>
      <Select
        value={selected ?? LATEST}
        onValueChange={(value) => onSelect(value === LATEST ? undefined : value)}
      >
        <SelectTrigger id="reporting-run" className="min-w-[19rem]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {/*
            Radix treats the empty string as "no value", so Latest carries a
            sentinel of its own and is mapped back to `undefined` above. The
            meaning is unchanged: no run id, server resolves the current one.
          */}
          <SelectItem value={LATEST}>
            Latest{latest === undefined ? '' : ` · ${describeRun(latest)}`}
          </SelectItem>
          {runs.map((run) => (
            <SelectItem key={run.runId} value={run.runId}>
              {describeRun(run)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}
