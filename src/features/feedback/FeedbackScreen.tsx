import { PendingCapabilities } from '../../components/PendingCapabilities'
import { StationBadge } from '../../components/StationBadge'
import { stationFor } from '../../config/event'

/** Point B: the scanner and feedback terminal. Phase 0 placeholder. */
export function FeedbackScreen() {
  const station = stationFor('feedback')

  return (
    <article className="screen">
      <h1>Point B — Feedback</h1>
      <p className="screen__lede">
        This device will become the QR scanner and feedback terminal. Staff will
        scan the sticker — or type the printed fallback code — and record the
        participant's feedback.
      </p>
      <StationBadge station={station} />
      <PendingCapabilities
        items={[
          'QR camera scanning',
          'Manual fallback-code entry and validation',
          'Feedback questionnaire',
          'Local durable save of feedback',
        ]}
      />
      <p className="screen__note">
        Identifies participants from the sticker alone. It never reads Point A's
        database and never requires connectivity.
      </p>
    </article>
  )
}
