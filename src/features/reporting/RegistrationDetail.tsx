import { useEffect, useState } from 'react'
import {
  describeFailure,
  fetchRegistrationDetail,
} from '../../lib/reporting/reportingClient'
import type {
  RegistrationDetail as Detail,
  RegistrationReconciliationStatus,
} from '../../lib/reporting/types'
import { ResponseSummary } from './ResponseSummary'
import { useReportingSession } from './session'

/*
 * One participant, with every response reconciliation associated with them.
 *
 * Where there are several responses they are all shown, in full, side by side.
 * The screen does not pick one and does not offer a way to pick one: choosing
 * between two responses is a decision about what the event's record says, and
 * this phase does not make it.
 *
 * The identifiers are shown, not just the human-readable fields. When an operator
 * has to reconcile this screen against a device's Admin page, a support log or a
 * row in an export, the record and participant IDs are what they match on — and a
 * screen that shows only a name and a code cannot answer "is this the same row?".
 */

const STATUS_LABELS: Record<RegistrationReconciliationStatus, string> = {
  matched: 'Matched — exactly one valid response',
  without_feedback: 'No response matched',
  multiple_feedback: 'Several valid responses — no winner chosen',
}

interface RegistrationDetailProps {
  readonly eventId: string
  readonly runId: string | undefined
  readonly recordId: string
  readonly onClose: () => void
}

export function RegistrationDetail({
  eventId,
  runId,
  recordId,
  onClose,
}: RegistrationDetailProps) {
  const session = useReportingSession()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setDetail(null)
    setError(null)

    void (async () => {
      const result = await session.call((secret) =>
        fetchRegistrationDetail(secret, eventId, recordId, runId),
      )
      if (!active) {
        return
      }
      if (result.ok) {
        setDetail(result.value.registration)
      } else {
        setError(describeFailure(result.failure))
      }
    })()

    return () => {
      active = false
    }
  }, [session, eventId, recordId, runId])

  return (
    <aside className="report-detail" aria-label="Participant detail">
      <div className="button-row">
        <button type="button" className="button button--small" onClick={onClose}>
          Close
        </button>
      </div>

      {error !== null && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}

      {detail === null && error === null && <p className="screen__note">Loading…</p>}

      {detail !== null && (
        <>
          <h3 className="section-title">
            {detail.name} <span className="recent__code">{detail.publicCode}</span>
          </h3>

          <dl className="station-badge">
            <div>
              <dt>Public code</dt>
              <dd>{detail.publicCode}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{detail.phone}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{detail.email}</dd>
            </div>
            <div>
              <dt>Reconciliation status</dt>
              <dd>{STATUS_LABELS[detail.reconciliationStatus]}</dd>
            </div>
            <div>
              <dt>Valid responses</dt>
              <dd>{detail.validFeedbackCount}</dd>
            </div>
            <div>
              <dt>Possible duplicate</dt>
              <dd>{detail.potentialDuplicate ? 'Yes' : 'No'}</dd>
            </div>
            <div>
              <dt>Vehicle</dt>
              <dd>{detail.vehicle ?? '—'}</dd>
            </div>
            <div>
              <dt>Interested colour</dt>
              <dd>{detail.interestedColour ?? '—'}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{detail.location ?? '—'}</dd>
            </div>
            <div>
              <dt>Gender</dt>
              <dd>{detail.gender ?? '—'}</dd>
            </div>
            <div>
              <dt>Test ride</dt>
              <dd>
                {detail.testRideAt === null
                  ? '—'
                  : /* A wall-clock slot at the venue: shown as captured, never
                       shifted into the reader's timezone. */
                    detail.testRideAt.replace('T', ' ')}
              </dd>
            </div>
            <div>
              <dt>Pincode</dt>
              <dd>{detail.pincode ?? '—'}</dd>
            </div>
            <div>
              <dt>Driving licence (sensitive)</dt>
              <dd>{detail.drivingLicence ?? '—'}</dd>
            </div>
            <div>
              <dt>Registered</dt>
              <dd>{new Date(detail.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{new Date(detail.updatedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd>{detail.revision}</dd>
            </div>
            <div>
              <dt>Station</dt>
              <dd>{detail.stationId}</dd>
            </div>
            <div>
              <dt>Record ID</dt>
              <dd>{detail.recordId}</dd>
            </div>
            <div>
              <dt>Participant ID</dt>
              <dd>{detail.participantId}</dd>
            </div>
            <div>
              <dt>Captured on device</dt>
              <dd>{detail.sourceDeviceId}</dd>
            </div>
            <div>
              <dt>Uploaded by device</dt>
              <dd>{detail.lastUploaderDeviceId}</dd>
            </div>
          </dl>

          <h4 className="section-title">Responses ({detail.feedback.length})</h4>

          {detail.reconciliationStatus === 'multiple_feedback' && (
            <p className="notice" role="status">
              This participant has more than one valid response. All are shown in
              full and none is treated as the answer — the reconciliation run
              chose no winner and neither does this screen or the exports.
            </p>
          )}

          {detail.feedback.length === 0 && (
            <p className="screen__note">
              No response was matched to this participant.
            </p>
          )}

          <ul className="recent__list">
            {detail.feedback.map((response) => (
              <li className="recent__item" key={response.recordId}>
                <span className="recent__code">
                  {response.captureMethod === 'qr' ? 'Scanned' : 'Typed code'}
                </span>
                <span>
                  {/*
                    Each response summarised on its own questionnaire's terms.
                    Several responses means several lines, never a chosen one.
                  */}
                  <ResponseSummary response={response} />
                </span>
                <span className="recent__time">
                  {new Date(response.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  )
}
