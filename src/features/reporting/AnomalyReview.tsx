import { useState } from 'react'
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
 * What an organiser does with an anomaly is human work — find the person, ask
 * at the desk, accept the loss.
 */

type Anomaly =
  | 'without_registration'
  | 'identity_conflict'
  | 'multiple_feedback'
  | 'without_feedback'

const TABS: readonly { readonly key: Anomaly; readonly label: string; readonly explanation: string }[] = [
  {
    key: 'without_registration',
    label: 'Responses with no registration',
    explanation:
      'The code on the response matches no registration in this event. Usually a mistyped code at Point B, or a registration that has not been uploaded yet. The response is kept in full.',
  },
  {
    key: 'identity_conflict',
    label: 'Identity conflicts',
    explanation:
      'The scanned participant ID and the printed code point at different registrations. Open a response to see what each identifier resolves to now.',
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
      'The participant registered but no response was matched to them.',
  },
]

interface AnomalyReviewProps {
  readonly eventId: string
  readonly runId: string | undefined
  readonly refreshToken: number
}

export function AnomalyReview({
  eventId,
  runId,
  refreshToken,
}: AnomalyReviewProps) {
  const [anomaly, setAnomaly] = useState<Anomaly>('without_registration')
  const active = TABS.find((tab) => tab.key === anomaly)

  return (
    <section aria-labelledby="anomaly-heading">
      <h2 id="anomaly-heading" className="pending__title">
        Needs review
      </h2>

      <p className="screen__note">
        These are read-only. Nothing here can be merged, linked, deleted or
        marked resolved — the reconciliation run is the record of what the
        evidence says, and this screen does not overrule it.
      </p>

      <div className="button-row" role="group" aria-label="Anomaly type">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className="choice"
            aria-pressed={anomaly === tab.key}
            onClick={() => setAnomaly(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active !== undefined && <p className="screen__note">{active.explanation}</p>}

      {anomaly === 'without_feedback' || anomaly === 'multiple_feedback' ? (
        <RegistrationTable
          key={anomaly}
          eventId={eventId}
          runId={runId}
          refreshToken={refreshToken}
          initialStatus={anomaly}
        />
      ) : (
        <FeedbackTable
          key={anomaly}
          eventId={eventId}
          runId={runId}
          refreshToken={refreshToken}
          initialStatus={anomaly}
        />
      )}
    </section>
  )
}
