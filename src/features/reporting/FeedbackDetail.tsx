import { useEffect, useState } from 'react'
import {
  describeFailure,
  fetchFeedbackDetail,
} from '../../lib/reporting/reportingClient'
import type {
  FeedbackDetail as Detail,
  FeedbackReconciliationStatus,
} from '../../lib/reporting/types'
import { FLYING_FLEA_CAMPAIGN } from '../campaign/flying-flea/config'
import { useReportingSession } from './session'

/*
 * One response, with the answers exactly as they were captured.
 *
 * The answers are rendered from the stored structure rather than from four known
 * `feedback-v1` fields, and the version is displayed beside them. A response
 * captured under a future questionnaire is therefore fully visible without any
 * part of this screen pretending to know what its keys mean.
 *
 * For an identity conflict, where the scanned participant ID and the printed
 * code point at different people, the screen shows what each identifier resolves
 * to *right now*. That is a diagnostic to help an organiser work out what happened
 * at the desk, not a decision: nothing here resolves the conflict or picks a side.
 */

const STATUS_LABELS: Record<FeedbackReconciliationStatus, string> = {
  matched: 'Matched to one participant',
  without_registration: 'No matching registration',
  identity_conflict: 'Identity conflict: identifiers disagree',
  multiple_feedback: 'One of several responses for one participant',
}

const SUPPORTED_FORM_VERSION = 'feedback-v1'
const CAMPAIGN_FORM_VERSION = FLYING_FLEA_CAMPAIGN.formVersion

/**
 * The wording each stored answer key belongs to.
 *
 * A report that showed `rotaryKnobUsage: 6` would be asking its reader to
 * remember what question that was. The campaign config is the authority on the
 * wording, so the two can never drift apart.
 */
const CAMPAIGN_QUESTIONS = [
  ...FLYING_FLEA_CAMPAIGN.ratingQuestions,
  ...FLYING_FLEA_CAMPAIGN.textQuestions,
]

interface FeedbackDetailProps {
  readonly eventId: string
  readonly runId: string | undefined
  readonly recordId: string
  readonly onClose: () => void
}

function renderAnswer(value: unknown): string {
  if (value === null || value === undefined) {
    return 'None'
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  if (typeof value === 'object') {
    // A future questionnaire may nest. Show it rather than dropping it.
    return JSON.stringify(value)
  }
  return String(value)
}

export function FeedbackDetail({
  eventId,
  runId,
  recordId,
  onClose,
}: FeedbackDetailProps) {
  const session = useReportingSession()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setDetail(null)
    setError(null)

    void (async () => {
      const result = await session.call((secret) =>
        fetchFeedbackDetail(secret, eventId, recordId, runId),
      )
      if (!active) {
        return
      }
      if (result.ok) {
        setDetail(result.value.feedback)
      } else {
        setError(describeFailure(result.failure))
      }
    })()

    return () => {
      active = false
    }
  }, [session, eventId, recordId, runId])

  return (
    <aside className="report-detail" aria-label="Response detail">
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
            Response <span className="recent__code">{detail.publicCode}</span>
          </h3>

          <dl className="station-badge">
            <div>
              <dt>Public code</dt>
              <dd>{detail.publicCode}</dd>
            </div>
            <div>
              <dt>Reconciliation status</dt>
              <dd>{STATUS_LABELS[detail.reconciliationStatus]}</dd>
            </div>
            <div>
              <dt>Captured</dt>
              <dd>
                {detail.captureMethod === 'qr' ? 'Scanned sticker' : 'Typed code'}
              </dd>
            </div>
            <div>
              <dt>Matched by</dt>
              <dd>
                {detail.matchMethod === 'qr_identity'
                  ? 'Participant ID'
                  : detail.matchMethod === 'manual_public_code'
                    ? 'Public code'
                    : 'Not matched'}
              </dd>
            </div>
            <div>
              <dt>Linked registration</dt>
              <dd>
                {detail.linkedRegistration === null
                  ? 'None'
                  : `${detail.linkedRegistration.name} (${detail.linkedRegistration.publicCode})`}
              </dd>
            </div>
            <div>
              <dt>Questionnaire</dt>
              <dd>
                {detail.formVersion}
                {detail.formVersion === SUPPORTED_FORM_VERSION ||
                detail.formVersion === CAMPAIGN_FORM_VERSION
                  ? ''
                  : ' (not readable by this build)'}
              </dd>
            </div>
            <div>
              <dt>Answered</dt>
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
            {detail.participantId !== null && (
              <div>
                <dt>Participant ID</dt>
                <dd>{detail.participantId}</dd>
              </div>
            )}
            <div>
              <dt>Captured on device</dt>
              <dd>{detail.sourceDeviceId}</dd>
            </div>
            <div>
              <dt>Uploaded by device</dt>
              <dd>{detail.lastUploaderDeviceId}</dd>
            </div>
          </dl>

          <h4 className="section-title">Answers as recorded</h4>

          {/*
            The campaign's own questions, in its own words. Rendered from the
            campaign config rather than from the stored keys, so a reader sees
            what the rider was asked rather than what the database calls it.
          */}
          {detail.formVersion === CAMPAIGN_FORM_VERSION && (
            <dl className="station-badge">
              {CAMPAIGN_QUESTIONS.map((question) => (
                <div key={question.key}>
                  <dt>{question.prompt}</dt>
                  <dd>{renderAnswer(detail.answers[question.key])}</dd>
                </div>
              ))}
            </dl>
          )}

          {detail.formVersion !== SUPPORTED_FORM_VERSION &&
            detail.formVersion !== CAMPAIGN_FORM_VERSION && (
            <p className="notice" role="status">
              This response was captured under questionnaire{' '}
              <strong>{detail.formVersion}</strong>, which this build does not
              know. The answers are shown exactly as
              stored and are excluded from every rating, experience and
              recommendation figure. A later questionnaire may reuse a field name
              for a different question, and reading it as if it were the same
              would produce a number that looks right and means nothing.
            </p>
          )}

          {/*
            The raw fallback, for `feedback-v1` and for any questionnaire this
            build does not know. Nothing is hidden and nothing is relabelled.
          */}
          {detail.formVersion !== CAMPAIGN_FORM_VERSION && (
            <dl className="station-badge">
              {Object.entries(detail.answers).map(([question, answer]) => (
                <div key={question}>
                  <dt>{question.replace(/_/g, ' ')}</dt>
                  <dd>{renderAnswer(answer)}</dd>
                </div>
              ))}
            </dl>
          )}

          {detail.diagnostics !== null && (
            <>
              <h4 className="section-title">Identity conflict</h4>
              <p className="notice" role="status">
                The scanned participant ID and the printed code on this response
                point at different registrations. Shown for diagnosis only.
                Nothing on this screen resolves the conflict.
              </p>
              <dl className="station-badge">
                <div>
                  <dt>Participant ID resolves to</dt>
                  <dd>
                    {detail.diagnostics.participantIdResolvesTo === null
                      ? 'No registration'
                      : `${detail.diagnostics.participantIdResolvesTo.name} (${detail.diagnostics.participantIdResolvesTo.publicCode})`}
                  </dd>
                </div>
                <div>
                  <dt>Printed code resolves to</dt>
                  <dd>
                    {detail.diagnostics.publicCodeResolvesTo === null
                      ? 'No registration'
                      : `${detail.diagnostics.publicCodeResolvesTo.name} (${detail.diagnostics.publicCodeResolvesTo.publicCode})`}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </>
      )}
    </aside>
  )
}
