import { InfoIcon } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { cn } from '@/lib/ui/cn'
import type { OverviewResponse } from '../../lib/reporting/types'
import { FeedbackTable } from './FeedbackTable'
import { RegistrationTable } from './RegistrationTable'

/*
 * Everything reconciliation could not resolve cleanly.
 *
 * Presented for review, not for resolution. There is no "mark as handled", no
 * "link this response to that participant" and no "ignore". An anomaly is a
 * fact about what happened at the desks; the record of it belongs in the
 * reconciliation run, and hiding one behind a resolved flag would make the next
 * run's counts disagree with the screen for no traceable reason.
 *
 * What an organiser does with an anomaly is human work: find the person, ask at
 * the desk, accept the loss.
 *
 * Direct feedback is deliberately not a category here. A rider who identified
 * themselves by contact details and matched no registration did not go through
 * Point A, which is what the contact path is for; nothing about it needs
 * reviewing. Those responses are browsed under Responses with everything else,
 * filtered by their own status. The `without_registration` category below is a
 * different finding entirely: a sticker code that led nowhere, which usually
 * means a typo at Point B or a Point A device that has not synced.
 *
 * ## The counts come from the overview already on screen
 *
 * All four are fields of the run's counts, which the workspace has fetched for
 * the snapshot rail. Putting them on the controls costs no request and stops
 * somebody opening four categories to discover three were empty. When the
 * overview has not loaded, the labels render without badges rather than with
 * placeholders that would read as zero.
 */

type Anomaly =
  | 'without_registration'
  | 'identity_conflict'
  | 'multiple_feedback'
  | 'without_feedback'

const CATEGORIES: readonly {
  readonly key: Anomaly
  readonly label: string
  readonly explanation: string
}[] = [
  {
    key: 'without_registration',
    label: 'Codes that matched no registration',
    explanation:
      'The code on the response matches no registration in this event. Usually a mistyped code at Point B, or a registration that has not been uploaded yet. The response is kept in full. Direct feedback from riders who never registered is not listed here: nothing went wrong for them, and they appear under Responses.',
  },
  {
    key: 'identity_conflict',
    label: 'Identity conflicts',
    explanation:
      'Identifiers that should describe one person do not. For a scanned sticker, the participant ID and the printed code point at different registrations; open a response to see what each resolves to now. For contact details, the phone and email pair belongs to more than one registration, so there is no single rider the response could be from.',
  },
  {
    key: 'multiple_feedback',
    label: 'Several responses',
    explanation:
      'More than one valid response is attached to one participant. Every response is kept and none is treated as the answer, in this screen or in the exports.',
  },
  {
    key: 'without_feedback',
    label: 'No response',
    explanation:
      'The participant registered but no response was matched to them. This is coverage that is incomplete, not data that is wrong: most of these riders simply did not stop at Point B.',
  },
]

interface AnomalyReviewProps {
  readonly eventId: string
  readonly runId: string | undefined
  readonly refreshToken: number
  /** Already loaded for the snapshot rail; no request is made for the counts. */
  readonly overview: OverviewResponse | null
}

function countFor(anomaly: Anomaly, overview: OverviewResponse | null): number | null {
  if (overview === null) {
    return null
  }
  const counts = overview.run.counts
  switch (anomaly) {
    case 'without_registration':
      return counts.feedbackWithoutRegistration
    case 'identity_conflict':
      return counts.feedbackIdentityConflicts
    case 'multiple_feedback':
      return counts.registrationsWithMultipleFeedback
    case 'without_feedback':
      return counts.registrationsWithoutFeedback
  }
}

export function AnomalyReview({
  eventId,
  runId,
  refreshToken,
  overview,
}: AnomalyReviewProps) {
  const [anomaly, setAnomaly] = useState<Anomaly>('without_registration')
  const active = CATEGORIES.find((category) => category.key === anomaly)
  const browsesParticipants =
    anomaly === 'without_feedback' || anomaly === 'multiple_feedback'

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-measure font-body text-base text-muted">
        Read-only. Nothing here can be merged, linked, deleted or marked
        resolved. The reconciliation run is the record of what the evidence says,
        and this screen does not overrule it.
      </p>

      <div role="group" aria-label="Anomaly type" className="flex flex-wrap gap-2.5">
        {CATEGORIES.map((category) => {
          const count = countFor(category.key, overview)
          const selected = anomaly === category.key

          return (
            <button
              key={category.key}
              type="button"
              aria-pressed={selected}
              onClick={() => setAnomaly(category.key)}
              className={cn(
                'flex min-h-touch items-center gap-3 rounded-card border px-4 py-2.5 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive',
                selected
                  ? 'border-interactive bg-interactive-soft'
                  : 'border-line bg-surface hover:border-line-strong',
              )}
            >
              <span
                className={cn(
                  'font-ui text-small',
                  selected ? 'font-medium text-ink' : 'text-muted',
                )}
              >
                {category.label}
              </span>
              {count !== null && (
                <span
                  className={cn(
                    'font-ui text-base font-semibold tabular-nums',
                    count === 0
                      ? 'text-faint'
                      : /* No response is incomplete coverage, not corrupt
                           evidence, so it is not coloured like a fault. */
                        category.key === 'without_feedback'
                        ? 'text-ink'
                        : 'text-danger',
                  )}
                >
                  {count.toLocaleString()}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {active !== undefined && (
        <Alert tone="neutral">
          <InfoIcon aria-hidden="true" />
          <AlertDescription>{active.explanation}</AlertDescription>
        </Alert>
      )}

      {browsesParticipants ? (
        <RegistrationTable
          key={anomaly}
          eventId={eventId}
          runId={runId}
          refreshToken={refreshToken}
          initialStatus={anomaly}
          filtersHidden
        />
      ) : (
        <FeedbackTable
          key={anomaly}
          eventId={eventId}
          runId={runId}
          refreshToken={refreshToken}
          initialStatus={anomaly}
          filtersHidden
        />
      )}
    </div>
  )
}
