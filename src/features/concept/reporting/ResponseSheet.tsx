import { InfoIcon, OctagonAlertIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../../components/ui/sheet'
import { CAPTURE_LABELS, ResponseStatusPill } from './statusPills'
import type { ConceptResponse } from './fixtures'

/*
 * One response, with its answers exactly as captured.
 *
 * Read-only, in a right-side Sheet, for the same reason the participant detail
 * is: opening a row should not move the thousand rows around it.
 *
 * ## The answers are rendered from what was stored
 *
 * Not from four known fields of one questionnaire. A response captured under a
 * questionnaire this build has never seen is still fully visible, with its
 * version named and a plain statement that no figures were computed from it.
 * Guessing at a familiar-looking key on an unknown scale would produce a number
 * that looks right and means nothing.
 *
 * ## Diagnostics are not a decision
 *
 * On an identity conflict the panel shows what each identifier resolves to now.
 * That is there to help somebody work out what happened at the desk. Nothing
 * here resolves the conflict, reassigns the response or picks a side.
 */

const STATUS_EXPLANATION: Readonly<Record<ConceptResponse['status'], string>> = {
  matched: 'Matched to exactly one participant.',
  standalone:
    'No registration in this event has both this phone number and this email address, so this rider did not go through Point A. That is the expected outcome for the contact path, not a problem to resolve. Their answers count towards the event figures.',
  without_registration:
    'The code on this response matches no registration in this event. Usually a mistyped code at Point B, or a Point A device that has not synced. The response is kept in full.',
  identity_conflict:
    'Identifiers that should describe one person do not. Nothing on this screen picks one.',
  multiple_feedback:
    'One of several valid responses for one participant. None of them is treated as the answer.',
}

interface ResponseSheetProps {
  readonly response: ConceptResponse | null
  readonly onClose: () => void
}

export function ResponseSheet({ response, onClose }: ResponseSheetProps) {
  const readable =
    response !== null &&
    (response.formVersion === 'flying-flea-feedback-v1' ||
      response.formVersion === 'feedback-v1')

  return (
    <Sheet open={response !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="sm:max-w-2xl">
        {response !== null && (
          <>
            <SheetHeader>
              <SheetTitle>
                {response.publicCode ?? response.respondentName ?? 'Response'}
              </SheetTitle>
              <SheetDescription>
                {response.answeredAt} · Read only. Nothing on this panel edits,
                reassigns or deletes a response.
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-1.5">
              <ResponseStatusPill status={response.status} />
              <p className="font-body text-small text-muted">
                {STATUS_EXPLANATION[response.status]}
              </p>
            </div>

            <Group title="Identity resolution">
              <Row label="Public code" value={response.publicCode ?? 'No code'} />
              <Row
                label="Captured"
                value={CAPTURE_LABELS[response.captureMethod] ?? response.captureMethod}
              />
              <Row
                label="Matched by"
                value={
                  response.matchMethod === null
                    ? 'Not matched'
                    : response.matchMethod === 'qr_identity'
                      ? 'Participant ID'
                      : response.matchMethod === 'manual_public_code'
                        ? 'Public code'
                        : 'Phone and email (both matched one registration)'
                }
              />
              <Row
                label="Linked registration"
                value={
                  response.participantName === null
                    ? 'None'
                    : `${response.participantName} (${response.linkedCode})`
                }
              />
              <Row
                label="Questionnaire"
                value={
                  readable
                    ? response.formVersion
                    : `${response.formVersion} (not readable by this build)`
                }
                mono
              />
            </Group>

            {response.captureMethod === 'contact' && (
              <Group title="Details given by the rider">
                <p className="pb-2 font-body text-small text-faint">
                  Entered at Point B by the rider themselves. Nothing was looked
                  up: these details are the identity of this response.
                </p>
                <Row label="Name" value={response.respondentName ?? 'None'} />
                <Row label="Phone" value={response.respondentPhone ?? 'None'} />
                <Row label="Email" value={response.respondentEmail ?? 'None'} />
              </Group>
            )}

            {response.status === 'identity_conflict' && response.diagnostics !== null && (
              <Alert tone="danger">
                <OctagonAlertIcon aria-hidden="true" />
                <AlertTitle>Identifiers disagree</AlertTitle>
                <AlertDescription>
                  <span className="block pb-1">
                    Participant ID resolves to{' '}
                    {response.diagnostics.participantIdResolvesTo ?? 'no registration'}.
                  </span>
                  <span className="block pb-1">
                    Printed code resolves to{' '}
                    {response.diagnostics.publicCodeResolvesTo ?? 'no registration'}.
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
                    <span className="font-mono">{response.formVersion}</span>, which
                    this build does not know. The answers are shown exactly as
                    stored and are excluded from every average. A later
                    questionnaire may reuse a field name for a different question.
                  </AlertDescription>
                </Alert>
              )}
              {response.answers.map((answer) => (
                <div
                  key={answer.prompt}
                  className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0"
                >
                  <span className="font-body text-small text-muted">
                    {answer.prompt}
                  </span>
                  <span className="font-body text-base text-ink">{answer.value}</span>
                </div>
              ))}
            </Group>

            <Group title="Identifiers, for support">
              <Row label="Record ID" value={response.recordId} mono />
              {response.participantId !== null && (
                <Row label="Participant ID" value={response.participantId} mono />
              )}
              <Row label="Station" value={response.stationId} mono />
              <Row label="Revision" value={String(response.revision)} mono />
              <Row label="Last updated" value={response.updatedAt} />
              <Row label="Captured on device" value={response.sourceDeviceId} mono />
              <Row
                label="Uploaded by device"
                value={response.lastUploaderDeviceId}
                mono
              />
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
