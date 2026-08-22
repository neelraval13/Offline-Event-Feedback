import { KeyboardIcon, TriangleAlertIcon, UserIcon } from 'lucide-react'
import { AppButton, AppSurface } from '../../components/design-system'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { EVENT_CONFIG, stationFor } from '../../config/event'
import { formatEventDay } from '../../config/eventTime'
import type { QrScannerFactory } from '../../lib/scanner'
import { CampaignFeedbackForm } from '../campaign/flying-flea/components/CampaignFeedbackForm'
import { FLYING_FLEA_CAMPAIGN } from '../campaign/flying-flea/config'
import { ContactFeedbackForm } from './ContactFeedbackForm'
import {
  AlreadyRecordedOutcome,
  ParticipantCode,
  SuccessOutcome,
} from './FeedbackOutcome'
import { IdentityChoice } from './IdentityChoice'
import { ManualCodeEntry } from './ManualCodeEntry'
import { ScannerFrame } from './ScannerFrame'
import { usePointBTerminal } from './usePointBTerminal'

interface FeedbackScreenProps {
  /** Injected in tests so the suite never needs a camera. */
  readonly createScanner?: QrScannerFactory
}

/*
 * Point B: the scanner and feedback terminal, in the V2 design.
 *
 * ## Three ways in, all equal
 *
 * Scan the sticker, type the printed code, or give contact details because
 * there is no sticker. The third is a first-class path and not a fallback for
 * the other two, so it is offered on the start screen beside them rather than
 * hidden behind a failure, and it stays reachable from the scanner, the camera
 * error and the manual screen.
 *
 * What is true of all three: nothing on this screen reads Point A's
 * registrations and nothing asks the network. On the sticker paths there is no
 * participant name, phone or email in scope at all. On the contact path there
 * is, because the rider typed it and it is the identity of their response; it
 * is displayed back only as they typed it, and never looked up against
 * anything.
 *
 * ## What the V2 migration changed
 *
 * Presentation, and where things sit. `usePointBTerminal` is untouched: the ten
 * states, the decode latch, the duplicate-frame guard, the rejected-payload
 * memory, the camera lifecycle and the two save paths are exactly as they were.
 * This file renders that state machine; it does not own any of it.
 *
 * Two properties of it shape the layout and are easy to break by accident:
 *
 *   - **The `<video>` is mounted at all times.** The scanner attaches a stream
 *     to an element that must already exist, so `ScannerFrame` is always in the
 *     tree and only its wrapper hides. Nothing here unmounts or re-parents it.
 *   - **`contact-entry` carries its own `busy`.** The terminal deliberately
 *     does not move to `saving` for that path, so the contact form is never
 *     unmounted around a save and a failed write keeps the rider's name, email,
 *     phone and all six answers. This screen must not add a status that
 *     unmounts it.
 */
export function FeedbackScreen({ createScanner }: FeedbackScreenProps) {
  const {
    state,
    savedCount,
    videoRef,
    startScanner,
    openManualEntry,
    openContactEntry,
    submitManualCode,
    returnToScanner,
    submitFeedback,
    submitContactFeedback,
  } = usePointBTerminal(createScanner === undefined ? {} : { createScanner })

  const identity =
    state.status === 'feedback' || state.status === 'saving'
      ? state.identity
      : null

  const scanning = state.status === 'scanning'
  const startingCamera = state.status === 'starting-camera'

  return (
    <AppSurface width="station" className="flex flex-col gap-page">
      <StationHeader />

      {/*
        Always mounted, revealed only while the camera is in play. The frame's
        footprint is fixed, so starting becomes scanning without the page
        moving under whatever the operator is reaching for.
      */}
      <ScannerFrame
        videoRef={videoRef}
        phase={
          startingCamera ? 'starting' : scanning ? 'scanning' : 'hidden'
        }
      />

      {state.status === 'idle' && (
        <IdentityChoice
          onScan={() => void startScanner()}
          onManual={openManualEntry}
          onContact={openContactEntry}
        />
      )}

      {(startingCamera || scanning) && (
        <section aria-labelledby="scan-heading" className="flex flex-col gap-5">
          <h2 id="scan-heading" className="sr-only">
            Scan the rider's sticker
          </h2>

          {/* Instruction in text, below the picture, never over it. */}
          <p className="text-center font-body text-lead text-muted">
            {startingCamera
              ? 'Waiting for the camera.'
              : "Hold the sticker's QR inside the frame."}
          </p>

          {/*
            A rejected sticker does not replace the camera. The terminal stays
            in `scanning`, the stream keeps running, and the same bad payload is
            silent after the first notice: both of those are its rules, not this
            screen's, and nothing here interferes with them.
          */}
          {scanning && state.notice !== null && (
            <Alert tone="warn">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>That sticker was not accepted</AlertTitle>
              <AlertDescription>
                {state.notice} The camera is still running: try another sticker,
                or use one of the paths below.
              </AlertDescription>
            </Alert>
          )}

          <AlternatePaths
            onManual={openManualEntry}
            onContact={openContactEntry}
          />
        </section>
      )}

      {state.status === 'camera-error' && (
        <section
          aria-labelledby="camera-error-heading"
          className="flex flex-col gap-5"
        >
          {/*
            Amber, not red: the rider has two other ways through, both one tap
            away, and the most common cause is somebody declining a permission
            prompt. Red here would say the feedback system had failed, which it
            has not, and an operator who sees red for an ordinary permission
            dialog several times a day stops reading red.
          */}
          <Alert tone="warn">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle
              id="camera-error-heading"
              className="font-display text-title tracking-wide"
            >
              Camera unavailable
            </AlertTitle>
            <AlertDescription>
              {state.message} Feedback still works: the two paths below do not
              need a camera.
            </AlertDescription>
          </Alert>

          <div className="flex flex-wrap items-center gap-2.5">
            <AppButton size="lg" onClick={() => void startScanner()}>
              Try camera again
            </AppButton>
          </div>

          <AlternatePaths
            onManual={openManualEntry}
            onContact={openContactEntry}
          />
        </section>
      )}

      {state.status === 'manual-entry' && (
        <section aria-labelledby="manual-heading" className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h2
              id="manual-heading"
              className="font-display text-title tracking-wide text-ink"
            >
              Enter code
            </h2>
            <p className="max-w-measure font-body text-lead text-muted">
              The code printed under the QR on the rider's sticker.
            </p>
          </div>

          <ManualCodeEntry
            error={state.error}
            onSubmit={(typed) => void submitManualCode(typed)}
            onCancel={returnToScanner}
            canCancel
            onContact={openContactEntry}
          />
        </section>
      )}

      {state.status === 'contact-entry' && (
        <section aria-labelledby="contact-heading" className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <h2
              id="contact-heading"
              className="font-display text-title tracking-wide text-ink"
            >
              Your details
            </h2>
            <p className="max-w-measure font-body text-lead text-muted">
              No sticker and no code is fine. Tell us who you are and answer the
              same questions as everybody else.
            </p>
          </div>

          {state.saveError !== null && (
            <SaveFailureAlert message={state.saveError} keepsContact />
          )}

          {/*
            One form, one submit, one save, and never unmounted: the terminal
            keeps `busy` inside this state precisely so a failed write leaves
            the name, email, phone and all six answers where the rider left
            them.
          */}
          <ContactFeedbackForm
            busy={state.busy}
            onSubmit={(contactIdentity, answers) =>
              void submitContactFeedback(contactIdentity, answers)
            }
          />

          <div>
            <AppButton
              type="button"
              variant="ghost"
              onClick={returnToScanner}
              disabled={state.busy}
            >
              Cancel
            </AppButton>
          </div>
        </section>
      )}

      {identity !== null && (
        <section aria-labelledby="ff-feedback-heading" className="flex flex-col gap-6">
          <ParticipantCode publicCode={identity.publicCode} />

          {state.status === 'feedback' && state.saveError !== null && (
            <SaveFailureAlert message={state.saveError} keepsContact={false} />
          )}

          <CampaignFeedbackForm
            busy={state.status === 'saving'}
            onSubmit={(answers) => void submitFeedback(answers)}
          />
        </section>
      )}

      {state.status === 'already-recorded' && (
        <AlreadyRecordedOutcome
          publicCode={state.publicCode}
          onNext={returnToScanner}
        />
      )}

      {state.status === 'success' && (
        <SuccessOutcome savedCount={savedCount} onNext={returnToScanner} />
      )}

      {/*
        The saved count, everywhere except success, which carries its own.
        Quiet, at the bottom, in the smallest type on the screen: operational
        metadata an operator glances at between riders, and turning it into a
        headline figure would make the terminal look like a dashboard.
      */}
      {state.status !== 'success' && (
        <p className="border-t border-line pt-4 font-ui text-small tabular-nums text-faint">
          Responses saved on this device · {savedCount}
        </p>
      )}
    </AppSurface>
  )
}

const STATION = stationFor('feedback')

/*
 * The terminal's own heading.
 *
 * The same two lines and stated fact Point A uses, so the two stations read as
 * one product. V1's photographic hero is not here for the same reason it left
 * Point A: it is 300px of picture above a task the operator returns to several
 * hundred times, and after the third rider it is scroll.
 */
function StationHeader() {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-accent">
          Point B · Feedback
        </span>
        <h1 className="font-display text-page leading-none tracking-wide text-ink">
          Test ride feedback
        </h1>
      </div>

      <p className="flex flex-col text-right font-ui text-small leading-tight text-muted">
        <span>{FLYING_FLEA_CAMPAIGN.lockedLocation}</span>
        <span className="text-faint">
          <span>{formatEventDay(EVENT_CONFIG.eventDay)}</span>
          <span aria-hidden="true"> · </span>
          <span>{STATION.stationId}</span>
        </span>
      </p>
    </header>
  )
}

/**
 * The two paths that never need a camera.
 *
 * Rendered identically wherever they appear, and identically to each other.
 */
function AlternatePaths({
  onManual,
  onContact,
}: {
  readonly onManual: () => void
  readonly onContact: () => void
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:gap-3">
      <AppButton
        variant="secondary"
        className="flex-1 justify-start gap-3"
        onClick={onManual}
      >
        <KeyboardIcon />
        Enter code
      </AppButton>
      <AppButton
        variant="secondary"
        className="flex-1 justify-start gap-3"
        onClick={onContact}
      >
        <UserIcon />
        No QR or code
      </AppButton>
    </div>
  )
}

/**
 * A failed local write, on either path.
 *
 * The genuinely destructive state on this screen, and the only red one: nothing
 * was committed, so the response does not exist. It says that plainly, and it
 * says the second thing that stops a rider walking away from a form they could
 * still submit, which is that everything they typed is still on screen.
 */
function SaveFailureAlert({
  message,
  keepsContact,
}: {
  readonly message: string
  readonly keepsContact: boolean
}) {
  return (
    <Alert tone="danger">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle className="font-display text-title tracking-wide">
        Feedback not saved
      </AlertTitle>
      <AlertDescription>
        Nothing was written to this device: {message}. This response does not
        exist yet.{' '}
        {keepsContact
          ? 'Every answer, and the details below, are still here.'
          : 'Every answer below is still here.'}{' '}
        Press Submit Feedback again.
      </AlertDescription>
    </Alert>
  )
}
