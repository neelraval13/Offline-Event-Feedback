import { InfoIcon, OctagonAlertIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { ErrorState, LoadingState } from '../../components/design-system'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet'
import {
  describeFailure,
  fetchFeedbackDetail,
} from '../../lib/reporting/reportingClient'
import type {
  FeedbackDetail as Detail,
  FeedbackReconciliationStatus,
} from '../../lib/reporting/types'
import { FLYING_FLEA_CAMPAIGN } from '../campaign/flying-flea/config'
import { captureLabel } from './responseIdentity'
import { FeedbackStatusPill } from './statusPills'
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
 * to *right now*. That is a diagnostic to help an organiser work out what
 * happened at the desk, not a decision: nothing here resolves the conflict,
 * reassigns the response or picks a side.
 *
 * ## Read-only, in a Sheet inside the session
 *
 * No edit, no reassign, no delete. The component stays in the workspace subtree,
 * so a 401 unmounts it along with everything else it was showing.
 */

const STATUS_EXPLANATION: Record<FeedbackReconciliationStatus, string> = {
  matched: 'Matched to exactly one participant.',
  without_registration:
    'The code on this response matches no registration in this event. Usually a mistyped code at Point B, or a Point A device that has not synced. The response is kept in full.',
  standalone:
    'No registration in this event has both this phone number and this email address, so this rider did not go through Point A. That is the expected outcome for the contact path, not a problem to resolve. Their answers count towards the event figures.',
  identity_conflict:
    'Identifiers that should describe one person do not. Nothing on this screen picks one.',
  multiple_feedback:
    'One of several valid responses for one participant. None of them is treated as the answer.',
}

const MATCH_LABELS: Record<string, string> = {
  qr_identity: 'Participant ID',
  manual_public_code: 'Public code',
  contact_identity: 'Phone and email (both matched one registration)',
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

  const readable =
    detail !== null &&
    (detail.formVersion === SUPPORTED_FORM_VERSION ||
      detail.formVersion === CAMPAIGN_FORM_VERSION)

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="sm:max-w-2xl" aria-label="Response detail">
        <SheetHeader>
          <SheetTitle>
            {detail === null
              ? 'Response'
              : (detail.publicCode ?? detail.respondentName ?? 'Response without a code')}
          </SheetTitle>
          <SheetDescription>
            {detail === null
              ? 'Loading this response.'
              : `${new Date(detail.createdAt).toLocaleString()} · Read only. Nothing on this panel edits, reassigns or deletes a response.`}
          </SheetDescription>
        </SheetHeader>

        {error !== null && (
          <ErrorState title="This response could not be read">{error}</ErrorState>
        )}

        {detail === null && error === null && (
          <LoadingState label="Reading this response…" rows={4} />
        )}

        {detail !== null && (
          <>
            <div className="flex flex-col gap-1.5">
              <FeedbackStatusPill status={detail.reconciliationStatus} />
              <p className="font-body text-small text-muted">
                {STATUS_EXPLANATION[detail.reconciliationStatus]}
              </p>
            </div>

            <Group title="Identity resolution">
              {/* A contact response never had a sticker. An empty cell would
                  read as a code that failed to load. */}
              <Row label="Public code" value={detail.publicCode ?? 'No code'} />
              <Row label="Captured" value={captureLabel(detail)} />
              <Row
                label="Matched by"
                value={
                  detail.matchMethod === null
                    ? 'Not matched'
                    : (MATCH_LABELS[detail.matchMethod] ?? detail.matchMethod)
                }
              />
              <Row
                label="Linked registration"
                value={
                  detail.linkedRegistration === null
                    ? 'None'
                    : `${detail.linkedRegistration.name} (${detail.linkedRegistration.publicCode})`
                }
              />
              <Row
                label="Questionnaire"
                value={
                  readable
                    ? detail.formVersion
                    : `${detail.formVersion} (not readable by this build)`
                }
                mono
              />
            </Group>

            {/*
              The rider's own details, when they are what identifies the
              response. Privileged PII on a privileged screen, shown exactly as
              the rider typed it: this is the evidence a match was made from,
              or, on a direct response, the only way to reach the person at all.
            */}
            {detail.captureMethod === 'contact' && (
              <Group title="Details given by the rider">
                <p className="pb-2 font-body text-small text-faint">
                  Entered at Point B by the rider themselves. Nothing was looked
                  up: these details are the identity of this response.
                </p>
                <Row label="Name" value={detail.respondentName ?? 'None'} />
                <Row label="Phone" value={detail.respondentPhone ?? 'None'} />
                <Row label="Email" value={detail.respondentEmail ?? 'None'} />
              </Group>
            )}

            {detail.reconciliationStatus === 'identity_conflict' &&
              detail.captureMethod === 'contact' && (
                <Alert tone="danger">
                  <OctagonAlertIcon aria-hidden="true" />
                  <AlertDescription>
                    More than one registration in this event has both this phone
                    number and this email address, so there is no single rider
                    this response could belong to. Nothing on this screen picks
                    one. The registrations concerned are listed under possible
                    duplicate registrations.
                  </AlertDescription>
                </Alert>
              )}

            {detail.diagnostics !== null && (
              <Alert tone="danger">
                <OctagonAlertIcon aria-hidden="true" />
                <AlertTitle>Identifiers disagree</AlertTitle>
                <AlertDescription>
                  <span className="block pb-1">
                    Participant ID resolves to{' '}
                    {detail.diagnostics.participantIdResolvesTo === null
                      ? 'no registration'
                      : `${detail.diagnostics.participantIdResolvesTo.name} (${detail.diagnostics.participantIdResolvesTo.publicCode})`}
                    .
                  </span>
                  <span className="block pb-1">
                    Printed code resolves to{' '}
                    {detail.diagnostics.publicCodeResolvesTo === null
                      ? 'no registration'
                      : `${detail.diagnostics.publicCodeResolvesTo.name} (${detail.diagnostics.publicCodeResolvesTo.publicCode})`}
                    .
                  </span>
                  Shown for diagnosis only. Nothing on this screen resolves the
                  conflict.
                </AlertDescription>
              </Alert>
            )}

            <Group title="Answers as recorded">
              {!readable && (
                <Alert tone="neutral" className="mb-3">
                  <InfoIcon aria-hidden="true" />
                  <AlertDescription>
                    Captured under questionnaire{' '}
                    <span className="font-mono">{detail.formVersion}</span>, which
                    this build does not know. The answers are shown exactly as
                    stored and are excluded from every rating, experience and
                    recommendation figure. A later questionnaire may reuse a field
                    name for a different question, and reading it as if it were
                    the same would produce a number that looks right and means
                    nothing.
                  </AlertDescription>
                </Alert>
              )}

              {/*
                The campaign's own questions, in its own words, rendered from the
                campaign config rather than from the stored keys so a reader sees
                what the rider was asked.
              */}
              {detail.formVersion === CAMPAIGN_FORM_VERSION
                ? CAMPAIGN_QUESTIONS.map((question) => (
                    <Answer
                      key={question.key}
                      prompt={question.prompt}
                      value={renderAnswer(detail.answers[question.key])}
                    />
                  ))
                : /* The raw fallback, for `feedback-v1` and for any questionnaire
                     this build does not know. Nothing hidden, nothing relabelled. */
                  Object.entries(detail.answers).map(([question, answer]) => (
                    <Answer
                      key={question}
                      prompt={question.replace(/_/g, ' ')}
                      value={renderAnswer(answer)}
                    />
                  ))}
            </Group>

            <Group title="Identifiers, for support">
              <Row label="Record ID" value={detail.recordId} mono />
              {detail.participantId !== null && (
                <Row label="Participant ID" value={detail.participantId} mono />
              )}
              <Row label="Station" value={detail.stationId} mono />
              <Row label="Revision" value={String(detail.revision)} mono />
              <Row
                label="Last updated"
                value={new Date(detail.updatedAt).toLocaleString()}
              />
              <Row label="Captured on device" value={detail.sourceDeviceId} mono />
              <Row label="Uploaded by device" value={detail.lastUploaderDeviceId} mono />
            </Group>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Group({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <section className="flex flex-col">
      <h3 className="border-b border-line pb-2 font-ui text-label font-semibold uppercase tracking-[0.14em] text-muted">
        {title}
      </h3>
      <div className="flex flex-col">{children}</div>
    </section>
  )
}

/** A free-text answer can be a paragraph, so it wraps rather than truncating. */
function Answer({
  prompt,
  value,
}: {
  readonly prompt: string
  readonly value: string
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0">
      <span className="font-body text-small text-muted">{prompt}</span>
      <span className="font-body text-base break-words whitespace-pre-wrap text-ink">
        {value}
      </span>
    </div>
  )
}

function Row({
  label,
  value,
  mono = false,
}: {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 border-b border-line py-2.5 last:border-b-0">
      <span className="font-body text-small text-muted">{label}</span>
      <span
        className={
          mono
            ? 'break-all select-all font-mono text-small text-ink'
            : 'break-words text-right font-body text-base text-ink'
        }
      >
        {value}
      </span>
    </div>
  )
}
