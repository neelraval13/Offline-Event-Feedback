import { InfoIcon } from 'lucide-react'
import { Alert, AlertDescription } from '../../../components/ui/alert'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../../components/ui/sheet'
import { ParticipantStatusPill } from './statusPills'
import { RESPONSES, type ConceptParticipant } from './fixtures'

/*
 * One participant, read-only, in a right-side Sheet.
 *
 * A Sheet rather than a panel expanded under the table. Opening a participant
 * in a list of 1,284 should not move the rows around them: the operator's next
 * action is almost always to close it and open the next one, and a layout that
 * shifts by several hundred pixels each time makes that a hunt.
 *
 * ## Nothing here writes
 *
 * No edit, no merge, no delete, no "attach this response". The reconciliation
 * status is displayed as a conclusion with its reasoning, not as a dropdown.
 * Where a participant has several responses, all of them are shown and none is
 * marked as the answer, because choosing between them is a decision about what
 * the event's record says and this product does not make it.
 *
 * The identifiers are here on purpose. When somebody is reconciling this screen
 * against a device's Admin page or a row in an export, the record and
 * participant IDs are what they match on.
 */

const STATUS_EXPLANATION: Readonly<Record<ConceptParticipant['status'], string>> = {
  matched: 'Exactly one valid response resolved to this participant.',
  without_feedback: 'No response was matched to this participant in this run.',
  multiple_feedback:
    'More than one valid response resolved to this participant. The run chose no winner, and neither does this screen or the exports.',
}

interface ParticipantSheetProps {
  readonly participant: ConceptParticipant | null
  readonly onClose: () => void
}

export function ParticipantSheet({ participant, onClose }: ParticipantSheetProps) {
  const responses =
    participant === null
      ? []
      : RESPONSES.filter((response) => response.linkedCode === participant.publicCode)

  return (
    <Sheet open={participant !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="sm:max-w-2xl">
        {participant !== null && (
          <>
            <SheetHeader>
              <SheetTitle>{participant.name}</SheetTitle>
              <SheetDescription>
                <span className="font-mono">{participant.publicCode}</span> · Read
                only. Nothing on this panel edits, merges or deletes a record.
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-1.5">
              <ParticipantStatusPill status={participant.status} />
              <p className="font-body text-small text-muted">
                {STATUS_EXPLANATION[participant.status]}
              </p>
            </div>

            {participant.potentialDuplicate && (
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
              <Row label="Phone" value={participant.phone} />
              <Row label="Email" value={participant.email} />
              <Row
                label="Driving licence"
                value={participant.drivingLicence ?? 'Not provided'}
                sensitive
              />
            </Group>

            <Group title="Registration">
              <Row label="Vehicle" value={participant.vehicle ?? 'Not provided'} />
              <Row
                label="Interested colour"
                value={participant.interestedColour ?? 'Not provided'}
              />
              <Row label="Location" value={participant.location ?? 'Not provided'} />
              <Row label="Gender" value={participant.gender ?? 'Not provided'} />
              {/* A wall-clock slot at the venue: shown as captured, never
                  shifted into the reader's timezone. */}
              <Row
                label="Test ride"
                value={participant.testRideAt?.replace('T', ' ') ?? 'Not provided'}
              />
              <Row label="Pincode" value={participant.pincode ?? 'Not provided'} />
              <Row label="Registered" value={participant.registeredAt} />
              <Row label="Last updated" value={participant.updatedAt} />
            </Group>

            <Group title={`Responses (${responses.length})`}>
              {responses.length === 0 && (
                <p className="py-3 font-body text-small text-muted">
                  No response was matched to this participant.
                </p>
              )}
              {responses.map((response) => (
                <div
                  key={response.recordId}
                  className="flex flex-col gap-1 border-t border-line py-3 first:border-t-0"
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="font-ui text-small text-muted">
                      {response.answeredAt}
                    </span>
                    <span className="font-ui text-base font-semibold tabular-nums text-ink">
                      Overall {response.rating}
                    </span>
                  </span>
                  <span className="font-body text-small text-faint">
                    {response.formVersion}
                  </span>
                </div>
              ))}
            </Group>

            <Group title="Identifiers, for support">
              <Row label="Record ID" value={participant.recordId} mono />
              <Row label="Participant ID" value={participant.participantId} mono />
              <Row label="Station" value={participant.stationId} mono />
              <Row label="Revision" value={String(participant.revision)} mono />
              <Row label="Captured on device" value={participant.sourceDeviceId} mono />
              <Row
                label="Uploaded by device"
                value={participant.lastUploaderDeviceId}
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
  readonly children: React.ReactNode
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
