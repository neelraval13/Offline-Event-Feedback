import { BrandButton } from '../../components/brand/BrandButton'
import { CampaignHeroHeader } from '../campaign/flying-flea/components/CampaignHeroHeader'
import { EventLocationOptions } from '../../components/EventLocationOptions'
import { stationFor } from '../../config/event'
import { isEventLocation } from '../../config/eventLocations'
import type { QrScannerFactory } from '../../lib/scanner'
import { CampaignFeedbackForm } from '../campaign/flying-flea/components/CampaignFeedbackForm'
import { CampaignSuccessPanel } from '../campaign/flying-flea/components/CampaignSuccessPanel'
import { ContactFeedbackForm } from './ContactFeedbackForm'
import { ManualCodeEntry } from './ManualCodeEntry'
import { usePointBTerminal } from './usePointBTerminal'

interface FeedbackScreenProps {
  /** Injected in tests so the suite never needs a camera. */
  readonly createScanner?: QrScannerFactory
}

/**
 * Point B: the scanner and feedback terminal.
 *
 * Three ways in, all equal: scan the sticker, type the printed code, or give
 * contact details because there is no sticker. The third is a first-class path
 * and not a fallback for the other two, so it is offered on the start screen
 * beside them rather than hidden behind a failure.
 *
 * What is true of all three: nothing on this screen reads Point A's
 * registrations and nothing asks the network. On the sticker paths there is no
 * participant name, phone or email in scope at all. On the contact path there
 * is, because the rider typed it and it is the identity of their response; it
 * is displayed back only as they typed it, and it is never looked up against
 * anything.
 *
 * ## The city is chosen before anything else can start
 *
 * Until this device knows which city it is in, none of the three ways in are
 * offered: the screen shows the selector and nothing else. That is a harder
 * gate than Point A's, on purpose. Point A's operator is typing for a minute
 * and can be told at submit; Point B's rider answers six questions in under a
 * minute and would have to answer them again.
 *
 * It matters most for the contact path. A scanned or typed response could in
 * principle have its city recovered later from the registration its code points
 * at; a direct response points at nothing, so a missing city on one is missing
 * permanently.
 */
export function FeedbackScreen({ createScanner }: FeedbackScreenProps) {
  const station = stationFor('feedback')
  const {
    state,
    savedCount,
    videoRef,
    location,
    setLocation,
    locationReady,
    responseInProgress,
    startScanner,
    openManualEntry,
    openContactEntry,
    submitManualCode,
    returnToScanner,
    submitFeedback,
    submitContactFeedback,
  } = usePointBTerminal(
    createScanner === undefined ? {} : { createScanner },
  )

  const identity =
    state.status === 'feedback' || state.status === 'saving'
      ? state.identity
      : null

  return (
    <article className="screen">
      <CampaignHeroHeader
        lead="Test Ride"
        accent="Feedback"
        subtitle={`${station.label} · ${station.stationId}`}
        location={location}
      />

      {/*
        The selector: always visible, and changeable except while a rider is
        part-way through answering.

        It stays on screen after a city is chosen rather than disappearing into
        a settings panel: a Point B desk can move between halls, and an operator
        who cannot see which city the tablet is recording has no way to notice
        it is wrong. It is a compact row rather than a card so it does not
        compete with the three ways in below it.

        It is disabled while a response is open. The response already carries
        the city it started in, so changing this could not corrupt it; what a
        live control would do is tell the operator they had changed something
        about the rider in front of them when they had not.
      */}
      <div className="field" data-testid="point-b-location-field">
        <label className="field__label" htmlFor="point-b-location">
          Event location
        </label>
        <select
          id="point-b-location"
          className="field__input"
          value={location ?? ''}
          disabled={responseInProgress}
          data-testid="point-b-location"
          onChange={(event) => {
            const next = event.target.value
            if (isEventLocation(next)) {
              setLocation(next)
            }
          }}
        >
          <EventLocationOptions placeholder={locationReady ? false : 'Select location'} />
        </select>
        {responseInProgress && (
          <p className="screen__note" data-testid="point-b-location-locked">
            This response is being recorded in {location}. Finish or cancel it to
            change the location for the next rider.
          </p>
        )}
      </div>

      {!locationReady && (
        /*
          Stated as an instruction, not as an error. Nothing has gone wrong: a
          device that has just been set up has simply not been told where it is,
          and this is the first thing the operator does with it.
        */
        <p className="notice" role="status" data-testid="point-b-location-required">
          Choose the event location before recording feedback. Every response is
          stamped with the city it was captured in, and a response with no city
          cannot be attributed to one afterwards.
        </p>
      )}

      {/* The preview element must exist before the camera starts, so it is
          always mounted and only shown while scanning. */}
      <div
        className={
          state.status === 'scanning' || state.status === 'starting-camera'
            ? 'scanner'
            : 'scanner scanner--hidden'
        }
      >
        <video
          ref={videoRef}
          className="scanner__video"
          muted
          playsInline
          data-testid="scanner-video"
        />
      </div>

      {state.status === 'idle' && locationReady && (
        <section className="point-b__start">
          <p className="screen__lede">
            Scan the QR on the participant’s sticker, or enter the printed code.
            No sticker? Take their details instead.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="button button--primary"
              onClick={() => void startScanner()}
            >
              Start scanner
            </button>
            <button type="button" className="button" onClick={openManualEntry}>
              Enter code manually
            </button>
            {/* Offered here, not only after something goes wrong. A rider who
                never registered has nothing to scan and nothing to type, and
                making an operator break the camera to find their way to this
                button would be absurd. */}
            <button type="button" className="button" onClick={openContactEntry}>
              Continue without QR or code
            </button>
          </div>
        </section>
      )}

      {state.status === 'starting-camera' && (
        <p className="notice" role="status">
          Starting camera…
        </p>
      )}

      {state.status === 'scanning' && (
        <section>
          <p className="screen__lede">Point the camera at the sticker’s QR.</p>
          {state.notice !== null && (
            <p className="notice notice--error" role="alert">
              {state.notice}
            </p>
          )}
          <div className="button-row">
            <button type="button" className="button" onClick={openManualEntry}>
              Enter code manually
            </button>
            <button type="button" className="button" onClick={openContactEntry}>
              Continue without QR or code
            </button>
          </div>
        </section>
      )}

      {state.status === 'camera-error' && (
        <section>
          <h2 className="section-title">Camera unavailable</h2>
          <p className="notice notice--error" role="alert">
            {state.message}
          </p>
          <div className="button-row">
            <button
              type="button"
              className="button button--primary"
              onClick={() => void startScanner()}
            >
              Try camera again
            </button>
            <button type="button" className="button" onClick={openManualEntry}>
              Enter code manually
            </button>
            <button type="button" className="button" onClick={openContactEntry}>
              Continue without QR or code
            </button>
          </div>
        </section>
      )}

      {state.status === 'manual-entry' && (
        <section aria-labelledby="manual-heading">
          <h2 id="manual-heading" className="section-title">
            Enter code manually
          </h2>
          <ManualCodeEntry
            error={state.error}
            onSubmit={(typed) => void submitManualCode(typed)}
            onCancel={returnToScanner}
            canCancel
          />
          <div className="button-row">
            <button type="button" className="button" onClick={openContactEntry}>
              No code either? Take their details
            </button>
          </div>
        </section>
      )}

      {state.status === 'contact-entry' && (
        <section aria-labelledby="contact-heading">
          <h2 id="contact-heading" className="section-title">
            Continue without QR or code
          </h2>
          <p className="screen__lede">
            No sticker and no code? Enter the rider’s contact details instead,
            then the usual questions.
          </p>

          {state.saveError !== null && (
            <p className="notice notice--error" role="alert">
              Feedback was <strong>not</strong> saved: {state.saveError}. Please
              try submitting again. Everything below is still here.
            </p>
          )}

          <ContactFeedbackForm
            busy={state.busy}
            onSubmit={(identity, answers) =>
              void submitContactFeedback(identity, answers)
            }
          />

          <div className="button-row">
            <button
              type="button"
              className="button button--small"
              onClick={returnToScanner}
              disabled={state.busy}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {identity !== null && (
        <section aria-labelledby="feedback-heading">
          <h2 id="feedback-heading" className="section-title">
            Feedback
          </h2>
          <p className="participant-code">
            <span className="participant-code__label">Participant</span>
            <span data-testid="participant-code">{identity.publicCode}</span>
          </p>

          {state.status === 'feedback' && state.saveError !== null && (
            <p className="notice notice--error" role="alert">
              Feedback was <strong>not</strong> saved: {state.saveError}. Please
              try submitting again. The answers below are still here.
            </p>
          )}

          <CampaignFeedbackForm
            busy={state.status === 'saving'}
            onSubmit={(answers) => void submitFeedback(answers)}
          />
        </section>
      )}

      {state.status === 'already-recorded' && (
        <section aria-labelledby="already-heading">
          <h2 id="already-heading" className="section-title">
            Feedback already recorded on this device
          </h2>
          <p className="notice" role="status">
            This participant’s feedback is already saved here. It has not been
            changed.
          </p>
          <p className="participant-code">
            <span data-testid="participant-code">{state.publicCode}</span>
          </p>
          <div className="button-row">
            <button
              type="button"
              className="button button--primary"
              onClick={returnToScanner}
            >
              Scan next participant
            </button>
          </div>
        </section>
      )}

      {state.status === 'success' && (
        <section aria-labelledby="success-heading">
          <h2 id="success-heading" className="visually-hidden">
            Feedback submitted
          </h2>
          <CampaignSuccessPanel detail="Saved on this device. Nothing further is needed from the rider." />
          <div className="button-row">
            <BrandButton type="button" onClick={returnToScanner}>
              Next rider
            </BrandButton>
          </div>
        </section>
      )}

      {/*
        Scoped to this event, and the wording says so. A device re-used from a
        previous event without being wiped still holds that event's responses,
        and a bare "saved on this device" would open the shift reading forty.
      */}
      <p className="screen__note">
        Responses saved on this device for this event: {savedCount}
      </p>
    </article>
  )
}
