import { useEffect, useRef, useState } from 'react'
import { BrandButton } from '../../components/brand/BrandButton'
import { CampaignHeroHeader } from '../campaign/flying-flea/components/CampaignHeroHeader'
import { stationFor } from '../../config/event'
import { CampaignRegistrationForm } from '../campaign/flying-flea/components/CampaignRegistrationForm'
import { needsLegacyCorrection } from '../campaign/flying-flea/campaignRecord'
import { stampEventFields } from '../campaign/flying-flea/eventStamp'
import { RegistrationForm } from './RegistrationForm'
import type { CampaignRegistrationDraft } from '../campaign/flying-flea/registrationForm'
import { emptyCampaignDraft } from '../campaign/flying-flea/registrationForm'
import type {
  CampaignFieldCorrections,
  FlyingFleaColour,
  FlyingFleaGender,
  RegistrationRecord,
} from '../../types'
import { PrintableSticker } from './PrintableSticker'
import { Sticker } from './Sticker'
import { useRegistrationTerminal } from './useRegistrationTerminal'
import type { RegistrationFormValues } from './validation'

/**
 * Re-opens a saved registration for correction.
 *
 * Every campaign answer is carried back into the form, so a correction to one
 * field cannot silently blank the rest, `undefined` on a record means "not
 * captured", and a form that started empty would write that back as an erasure.
 */
function draftFrom(record: RegistrationRecord): CampaignRegistrationDraft {
  const empty = emptyCampaignDraft()

  return {
    name: record.name,
    phone: record.phone,
    email: record.email,
    vehicle: record.vehicle ?? null,
    interestedColour:
      (record.interestedColour as FlyingFleaColour | undefined) ??
      empty.interestedColour,
    location: record.location ?? empty.location,
    gender: (record.gender as FlyingFleaGender | undefined) ?? '',
    testRideAt: record.testRideAt ?? '',
    drivingLicence: record.drivingLicence ?? '',
    pincode: record.pincode ?? '',
  }
}

/**
 * Point A: the registration terminal.
 *
 * Two states share the screen: taking a participant's details, and dealing with
 * the sticker for the one just saved. They are kept visually distinct because
 * confusing them is how a participant ends up registered twice.
 */
export function RegistrationScreen() {
  const station = stationFor('registration')
  const {
    phase,
    recent,
    deviceError,
    submit,
    retrySticker,
    reprint,
    print,
    nextParticipant,
    correctContactDetails,
  } = useRegistrationTerminal()

  const [formGeneration, setFormGeneration] = useState(0)
  const [editing, setEditing] = useState(false)
  const printButtonRef = useRef<HTMLButtonElement>(null)

  const saved = phase.status === 'saved' ? phase.record : null

  // Once the sticker is ready, put the keyboard on the print button: the next
  // thing staff does is print, and Enter should do it without a reach for the
  // mouse.
  useEffect(() => {
    if (phase.status === 'saved' && phase.sticker.status === 'ready') {
      printButtonRef.current?.focus()
    }
  }, [phase])

  function handleNextParticipant() {
    setEditing(false)
    nextParticipant()
    setFormGeneration((generation) => generation + 1)
  }

  async function handleCorrection(
    values: RegistrationFormValues & CampaignFieldCorrections,
  ) {
    if (saved === null) {
      return
    }
    await correctContactDetails(saved.recordId, values)
    setEditing(false)
  }

  return (
    <article className="screen">
      <CampaignHeroHeader
        lead="Test Ride"
        accent="Registration"
        subtitle={`${station.label} · ${station.stationId}`}
      />

      {deviceError !== null && (
        <p className="notice notice--error" role="alert">
          This device cannot reach local storage: {deviceError}. Do not register
          participants until this is resolved. Nothing can be saved.
        </p>
      )}

      {phase.status !== 'saved' && (
        <section aria-labelledby="registration-heading">
          <h2 id="registration-heading" className="section-title">
            Participant details
          </h2>

          {phase.status === 'save-failed' && (
            <p className="notice notice--error" role="alert">
              Could not save this registration: {phase.message}. Nothing was
              written and no sticker was produced. Check the details and try
              again.
            </p>
          )}

          {/*
            The venue and the test-ride time are attached here, on the way to
            the store, and nowhere else. This is the new-registration path: the
            correction path below calls `handleCorrection`, which never stamps,
            so fixing an email address at 16:10 cannot rewrite a ride that
            happened at 15:42.
          */}
          <CampaignRegistrationForm
            onSubmit={(values) => void submit(stampEventFields(values))}
            busy={phase.status === 'saving'}
            resetKey={formGeneration}
          />
        </section>
      )}

      {phase.status === 'saved' && (
        <section aria-labelledby="saved-heading">
          <h2 id="saved-heading" className="section-title">
            Registration saved
          </h2>

          <p className="notice notice--success" role="status">
            Saved to this device. The participant’s identity is safe even if
            printing fails.
          </p>

          <p className="public-code" data-testid="saved-public-code">
            {phase.record.publicCode}
          </p>

          {phase.sticker.status === 'rendering' && (
            <p className="notice">Preparing sticker…</p>
          )}

          {phase.sticker.status === 'failed' && (
            <div className="notice notice--error" role="alert">
              <p>
                The registration is saved, so do <strong>not</strong> register
                this participant again. Only the sticker image failed to
                render: {phase.sticker.message}
              </p>
              <button
                type="button"
                className="button"
                onClick={() => void retrySticker()}
              >
                Retry sticker
              </button>
            </div>
          )}

          {phase.sticker.status === 'ready' && (
            <>
              {/* On-screen proof, at true physical size. */}
              <Sticker
                qrSvg={phase.sticker.qrSvg}
                publicCode={phase.record.publicCode}
              />
              {/* The copy the printer receives, portalled outside #root so
                  print can switch the application off entirely. */}
              <PrintableSticker
                qrSvg={phase.sticker.qrSvg}
                publicCode={phase.record.publicCode}
              />
              <p className="screen__note">
                Printing cannot be confirmed by the browser. If the label did
                not come out, or came out badly, print it again; it will be
                the same sticker.
              </p>
            </>
          )}

          <div className="button-row">
            <button
              type="button"
              ref={printButtonRef}
              className="button button--primary"
              onClick={print}
              disabled={phase.sticker.status !== 'ready'}
            >
              Print sticker
            </button>
            <button
              type="button"
              className="button"
              onClick={print}
              disabled={phase.sticker.status !== 'ready'}
            >
              Reprint sticker
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setEditing((current) => !current)}
            >
              {editing ? 'Cancel correction' : 'Correct details'}
            </button>
            <BrandButton type="button" onClick={handleNextParticipant}>
              Next rider
            </BrandButton>
          </div>

          {editing && (
            <section className="correction" aria-labelledby="correction-heading">
              <h3 id="correction-heading" className="section-title">
                Correct rider details
              </h3>
              <p className="screen__note">
                The sticker does not need reprinting: it carries no name, phone,
                email, licence or campaign answer. Identity stays as issued.
              </p>
              {/*
                A registration captured before this campaign has no vehicle, no
                colour and no venue, because nobody was asked. Correcting it
                through the campaign form would demand all three and default the
                colour, so an operator fixing a typo in an email address would
                save a bike, a colour and a venue that this rider never chose.
                Legacy records therefore keep the generic contact-details form.
              */}
              {needsLegacyCorrection(phase.record) ? (
                <RegistrationForm
                  onSubmit={(values) => void handleCorrection(values)}
                  busy={false}
                  resetKey={-phase.record.revision}
                  submitLabel="Save correction"
                  initialValues={{
                    name: phase.record.name,
                    phone: phase.record.phone,
                    email: phase.record.email,
                  }}
                />
              ) : (
                <CampaignRegistrationForm
                  onSubmit={(values) => void handleCorrection(values)}
                  busy={false}
                  resetKey={-phase.record.revision}
                  submitLabel="Save correction"
                  initialDraft={draftFrom(phase.record)}
                />
              )}
            </section>
          )}
        </section>
      )}

      <RecentRegistrations
        records={recent}
        activeRecordId={saved?.recordId ?? null}
        onReprint={(record) => void reprint(record)}
      />
    </article>
  )
}

interface RecentRegistrationsProps {
  readonly records: readonly RegistrationRecord[]
  readonly activeRecordId: string | null
  readonly onReprint: (record: RegistrationRecord) => void
}

/**
 * Recent local registrations, newest first.
 *
 * This is the recovery path, not a dashboard: after a refresh, or after
 * noticing three participants later that a label never came out, staff needs
 * to reach an earlier sticker and print it again. It shows public codes and
 * times only. No names, because a list of participant names on a desk-facing
 * screen is a privacy leak that buys nothing here.
 */
function RecentRegistrations({
  records,
  activeRecordId,
  onReprint,
}: RecentRegistrationsProps) {
  if (records.length === 0) {
    return null
  }

  return (
    <section className="recent" aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="section-title">
        Recent registrations on this device
      </h2>
      <ul className="recent__list">
        {records.map((record) => (
          <li key={record.recordId} className="recent__item">
            <span className="recent__code">{record.publicCode}</span>
            <span className="recent__time">
              {new Date(record.createdAt).toLocaleTimeString()}
            </span>
            <button
              type="button"
              className="button button--small"
              onClick={() => onReprint(record)}
              disabled={record.recordId === activeRecordId}
            >
              {record.recordId === activeRecordId ? 'Showing' : 'Reprint'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
