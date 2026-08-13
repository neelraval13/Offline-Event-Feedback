import { StationBadge } from '../../components/StationBadge'
import { stationFor } from '../../config/event'
import type { QrScannerFactory } from '../../lib/scanner'
import { FeedbackForm } from './FeedbackForm'
import { ManualCodeEntry } from './ManualCodeEntry'
import { usePointBTerminal } from './usePointBTerminal'

interface FeedbackScreenProps {
  /** Injected in tests so the suite never needs a camera. */
  readonly createScanner?: QrScannerFactory
}

/**
 * Point B — the scanner and feedback terminal.
 *
 * Everything on this screen comes from the sticker in front of the operator.
 * It never reads Point A's registrations, never asks the network, and never
 * has a participant's name, phone or email in scope to display.
 */
export function FeedbackScreen({ createScanner }: FeedbackScreenProps) {
  const station = stationFor('feedback')
  const {
    state,
    draft,
    errors,
    savedCount,
    videoRef,
    startScanner,
    openManualEntry,
    submitManualCode,
    returnToScanner,
    updateDraft,
    submitFeedback,
  } = usePointBTerminal(
    createScanner === undefined ? {} : { createScanner },
  )

  const identity =
    state.status === 'feedback' || state.status === 'saving'
      ? state.identity
      : null

  return (
    <article className="screen">
      <h1>Point B — Feedback</h1>
      <StationBadge station={station} />

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

      {state.status === 'idle' && (
        <section className="point-b__start">
          <p className="screen__lede">
            Scan the QR on the participant’s sticker, or enter the printed code.
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
              try submitting again — the answers below are still here.
            </p>
          )}

          <FeedbackForm
            draft={draft}
            errors={errors}
            busy={state.status === 'saving'}
            onChange={updateDraft}
            onSubmit={() => void submitFeedback()}
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
          <h2 id="success-heading" className="section-title">
            Thank you
          </h2>
          <p className="notice notice--success" role="status">
            Feedback recorded.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="button button--primary"
              onClick={returnToScanner}
            >
              Next participant
            </button>
          </div>
        </section>
      )}

      <p className="screen__note">
        Responses saved on this device: {savedCount}
      </p>
    </article>
  )
}
