import { useEffect, useRef, useState } from 'react'
import { StationBadge } from '../../components/StationBadge'
import { stationFor } from '../../config/event'
import type { RegistrationRecord } from '../../types'
import { RegistrationForm } from './RegistrationForm'
import { Sticker } from './Sticker'
import { useRegistrationTerminal } from './useRegistrationTerminal'
import type { RegistrationFormValues } from './validation'

/**
 * Point A — the registration terminal.
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

  async function handleCorrection(values: RegistrationFormValues) {
    if (saved === null) {
      return
    }
    await correctContactDetails(saved.recordId, values)
    setEditing(false)
  }

  return (
    <article className="screen">
      <h1>Point A — Registration</h1>
      <StationBadge station={station} />

      {deviceError !== null && (
        <p className="notice notice--error" role="alert">
          This device cannot reach local storage: {deviceError}. Do not register
          participants until this is resolved — nothing can be saved.
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
              written and no sticker was produced — check the details and try
              again.
            </p>
          )}

          <RegistrationForm
            onSubmit={(values) => void submit(values)}
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
                The registration is saved — do <strong>not</strong> register
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
              <Sticker
                qrSvg={phase.sticker.qrSvg}
                publicCode={phase.record.publicCode}
              />
              <p className="screen__note">
                Printing cannot be confirmed by the browser. If the label did
                not come out, or came out badly, print it again — it will be
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
            <button
              type="button"
              className="button button--secondary"
              onClick={handleNextParticipant}
            >
              Next participant
            </button>
          </div>

          {editing && (
            <section className="correction" aria-labelledby="correction-heading">
              <h3 id="correction-heading" className="section-title">
                Correct contact details
              </h3>
              <p className="screen__note">
                The sticker does not need reprinting: it carries no name, phone
                or email. Identity stays as issued.
              </p>
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
 * This is the recovery path, not a dashboard: after a refresh — or after
 * noticing three participants later that a label never came out — staff needs
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
