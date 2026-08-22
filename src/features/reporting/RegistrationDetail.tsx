import { InfoIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { ErrorState, LoadingState } from '../../components/design-system'
import { Alert, AlertDescription } from '../../components/ui/alert'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet'
import {
  describeFailure,
  fetchRegistrationDetail,
} from '../../lib/reporting/reportingClient'
import type {
  RegistrationDetail as Detail,
  RegistrationReconciliationStatus,
} from '../../lib/reporting/types'
import { ResponseSummary } from './ResponseSummary'
import { captureLabel } from './responseIdentity'
import { RegistrationStatusPill } from './statusPills'
import { useReportingSession } from './session'

/*
 * One participant, with every response reconciliation associated with them.
 *
 * Where there are several responses they are all shown, in full, one after the
 * other. The screen does not pick one and does not offer a way to pick one:
 * choosing between two responses is a decision about what the event's record
 * says, and this product does not make it.
 *
 * The identifiers are shown, not just the human-readable fields. When an
 * operator has to reconcile this screen against a device's Admin page, a
 * support log or a row in an export, the record and participant IDs are what
 * they match on, and a screen that shows only a name and a code cannot answer
 * "is this the same row?".
 *
 * ## Read-only, and visibly so
 *
 * No edit, no merge, no delete, no reassign, no correct. The reconciliation
 * status is displayed as a conclusion with its reasoning, never as a control.
 *
 * ## It lives inside the session
 *
 * A Sheet portals its content to the document body, but the component stays in
 * this subtree, so when the session ends the Sheet unmounts with everything
 * else and its contact details go with it. Nothing here outlives the credential.
 */

const STATUS_EXPLANATION: Record<RegistrationReconciliationStatus, string> = {
  matched: 'Exactly one valid response resolved to this participant.',
  without_feedback: 'No response was matched to this participant in this run.',
  multiple_feedback:
    'More than one valid response resolved to this participant. The run chose no winner, and neither does this screen or the exports.',
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
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="sm:max-w-2xl" aria-label="Participant detail">
        <SheetHeader>
          <SheetTitle>{detail?.name ?? 'Participant'}</SheetTitle>
          <SheetDescription>
            {detail === null ? (
              'Loading this participant.'
            ) : (
              <>
                <span className="font-mono">{detail.publicCode}</span> · Read only.
                Nothing on this panel edits, merges or deletes a record.
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        {error !== null && (
          <ErrorState title="This participant could not be read">{error}</ErrorState>
        )}

        {detail === null && error === null && (
          <LoadingState label="Reading this participant…" rows={4} />
        )}

        {detail !== null && (
          <>
            <div className="flex flex-col gap-1.5">
              <RegistrationStatusPill status={detail.reconciliationStatus} />
              <p className="font-body text-small text-muted">
                {STATUS_EXPLANATION[detail.reconciliationStatus]}
              </p>
            </div>

            {detail.potentialDuplicate && (
              <Alert tone="warn">
                <InfoIcon aria-hidden="true" />
                <AlertDescription>
                  Another registration shares this phone number or email address.
                  A candidate to check, not a confirmed duplicate: families share
                  numbers and couples share inboxes. See Duplicates.
                </AlertDescription>
              </Alert>
            )}

            <Group title="Contact">
              <Row label="Phone" value={detail.phone} />
              <Row label="Email" value={detail.email} />
              <Row
                label="Driving licence"
                value={detail.drivingLicence ?? 'Not provided'}
                sensitive
              />
            </Group>

            <Group title="Registration">
              <Row label="Vehicle" value={detail.vehicle ?? 'Not provided'} />
              <Row
                label="Interested colour"
                value={detail.interestedColour ?? 'Not provided'}
              />
              <Row label="Location" value={detail.location ?? 'Not provided'} />
              <Row label="Gender" value={detail.gender ?? 'Not provided'} />
              <Row
                label="Test ride"
                value={
                  detail.testRideAt === null
                    ? 'Not provided'
                    : /* A wall-clock slot at the venue: shown as captured, never
                         shifted into the reader's timezone. */
                      detail.testRideAt.replace('T', ' ')
                }
              />
              <Row label="Pincode" value={detail.pincode ?? 'Not provided'} />
              <Row
                label="Registered"
                value={new Date(detail.createdAt).toLocaleString()}
              />
              <Row
                label="Last updated"
                value={new Date(detail.updatedAt).toLocaleString()}
              />
            </Group>

            <Group title={`Responses (${detail.feedback.length})`}>
              {detail.reconciliationStatus === 'multiple_feedback' && (
                <Alert tone="warn" className="mb-3">
                  <InfoIcon aria-hidden="true" />
                  <AlertDescription>
                    This participant has more than one valid response. All are
                    shown in full and none is treated as the answer. The
                    reconciliation run chose no winner and neither does this
                    screen or the exports.
                  </AlertDescription>
                </Alert>
              )}

              {detail.feedback.length === 0 && (
                <p className="py-3 font-body text-small text-muted">
                  No response was matched to this participant.
                </p>
              )}

              {detail.feedback.map((response) => (
                <div
                  key={response.recordId}
                  className="flex flex-col gap-1 border-t border-line py-3 first:border-t-0"
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                    {/*
                      One shared labelling with the response list, so the two
                      screens cannot describe the same record differently.
                    */}
                    <span className="font-ui text-small text-muted">
                      {captureLabel(response)}
                    </span>
                    <span className="font-ui text-small tabular-nums text-faint">
                      {new Date(response.createdAt).toLocaleString()}
                    </span>
                  </span>
                  {/* Each response summarised on its own questionnaire's terms. */}
                  <span className="font-body text-base break-words text-ink">
                    <ResponseSummary response={response} />
                  </span>
                </div>
              ))}
            </Group>

            <Group title="Identifiers, for support">
              <Row label="Record ID" value={detail.recordId} mono />
              <Row label="Participant ID" value={detail.participantId} mono />
              <Row label="Station" value={detail.stationId} mono />
              <Row label="Revision" value={String(detail.revision)} mono />
              <Row label="Captured on device" value={detail.sourceDeviceId} mono />
              <Row
                label="Uploaded by device"
                value={detail.lastUploaderDeviceId}
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
  sensitive = false,
}: {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
  readonly sensitive?: boolean
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 border-b border-line py-2.5 last:border-b-0">
      <span className="font-body text-small text-muted">
        {label}
        {sensitive && (
          <span className="pl-1.5 font-ui text-caption uppercase tracking-[0.08em] text-warn">
            Sensitive
          </span>
        )}
      </span>
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
