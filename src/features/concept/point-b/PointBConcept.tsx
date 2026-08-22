import { KeyboardIcon, TriangleAlertIcon, UserIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { AppButton, AppSurface } from '@/components/design-system'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EVENT_CONFIG, stationFor } from '@/config/event'
import { formatEventDay } from '@/config/eventTime'
import { FLYING_FLEA_CAMPAIGN } from '@/features/campaign/flying-flea/config'
import {
  EMPTY_CAMPAIGN_DRAFT,
  type CampaignFeedbackErrors,
  type FlyingFleaFeedbackDraft,
} from '@/features/campaign/flying-flea/feedbackForm'
import { ConceptStateBar, type ConceptState } from './ConceptStateBar'
import { ContactFields, EMPTY_CONTACT, type ContactDraftFixture } from './ContactFields'
import {
  CONCEPT_CAMERA_ERROR,
  CONCEPT_CODE_REJECTION,
  CONCEPT_PUBLIC_CODE,
  CONCEPT_QR_REJECTION,
  CONCEPT_RIDER,
  CONCEPT_SAVED_COUNT,
  CONCEPT_SAVE_ERROR,
  CONCEPT_TYPED_CODE,
} from './fixtures'
import { IdentityChoice } from './IdentityChoice'
import { ManualCodePanel } from './ManualCodePanel'
import { AlreadyRecordedOutcome, SuccessOutcome } from './Outcome'
import { QuestionnaireFields } from './QuestionnaireFields'
import { ScannerStage } from './ScannerStage'

/*
 * Point B, V2: a concept.
 *
 * ## What this is not
 *
 * It is not the feedback terminal. `/#/b` still renders `FeedbackScreen`
 * exactly as it did, and nothing in this directory is imported by it. This file
 * opens no camera, calls no scanner, opens no database, creates no feedback
 * record, captures no identity and asks no network. Every value on screen comes
 * from `fixtures.ts` or from campaign configuration that is already read-only
 * data.
 *
 * ## The real state machine, which this reproduces
 *
 * Read off `usePointBTerminal.ts`:
 *
 *                                ┌──────────────────────────────────┐
 *                                ▼                                  │
 *   idle ──▶ starting-camera ──▶ scanning ──accept──▶ feedback ──▶ saving ──▶ success
 *     │            │               │  │                  ▲            │          │
 *     │            │ throws or     │  │ already          │ save fails │          │
 *     │            │ onFatalError  │  │ recorded         └────────────┘          │
 *     │            ▼               │  └────▶ already-recorded                    │
 *     │       camera-error ◀───────┘                                             │
 *     │            │                                                             │
 *     ├──▶ manual-entry {error} ──valid──▶ (acceptIdentity)                       │
 *     │                                                                          │
 *     ├──▶ contact-entry {busy, saveError} ──save ok───────────────────────────────┤
 *     │            ▲ save fails: stays put, form still mounted                    │
 *     └◀────────── returnToScanner ◀─────────────────────────────────────────────┘
 *
 * Five properties of it drive the design below.
 *
 * **Three first-class ways in.** `idle` offers scanning, manual entry and
 * contact details side by side, and `openContactEntry` is reachable from the
 * scanner, the camera error and the manual screen too. The direct-contact path
 * is not a fallback: a rider who never registered has nothing to scan and
 * nothing to type. The start screen says so in words.
 *
 * **The contact path is one form and one submit.** `contact-entry` carries its
 * own `busy` and `saveError` inside the state rather than moving to a separate
 * `saving` status, precisely so the form is never unmounted around a save. A
 * failed write leaves the name, phone, email and all six answers exactly where
 * the rider left them. That is protected behaviour and this concept reproduces
 * it: contact details and questionnaire are one surface, never two screens.
 *
 * **The duplicate guard is a question about a public code.** It exists on the
 * sticker paths only, because a contact capture has none. No equivalent is
 * invented here.
 *
 * **A rejected QR keeps the camera running.** `scanning` carries a transient
 * `notice`; it does not become an error state, and the same bad payload is
 * silent after the first time.
 *
 * **Point B never looks anything up.** There is no name, phone or email in
 * scope on the sticker paths at all, and no lookup on the contact path either.
 * The public code is the whole of what this screen knows about a scanned rider,
 * and it is enough.
 */

const STATION = stationFor('feedback')

/** A questionnaire with the required half answered and the optional half not. */
const PARTIAL_ANSWERS: FlyingFleaFeedbackDraft = {
  ...EMPTY_CAMPAIGN_DRAFT,
  testRideExperience: 6,
  rotaryKnobUsage: 5,
  rideModesExperience: 6,
  overallExperienceRating: 7,
}

/** What the campaign's validator produces when a rating is left blank. */
const MISSING_RATING = 'Answer this question.'

const CONTACT_ERRORS = {
  name: 'Enter your name.',
  phone: 'Enter a valid 10-digit mobile number.',
  email: 'Enter a valid email address.',
} as const

export function PointBConcept() {
  const [state, setState] = useState<ConceptState>('start')
  const [answers, setAnswers] = useState<FlyingFleaFeedbackDraft>(
    EMPTY_CAMPAIGN_DRAFT,
  )
  const [contact, setContact] = useState<ContactDraftFixture>(EMPTY_CONTACT)
  const [typedCode, setTypedCode] = useState('')

  /** Seeds the fixtures each state needs, so nothing has to be typed first. */
  function goTo(next: ConceptState) {
    setState(next)

    const partial =
      next === 'feedback-partial' ||
      next === 'feedback-failed' ||
      next === 'saving' ||
      next === 'contact-partial' ||
      next === 'contact-failed'
    setAnswers(partial ? PARTIAL_ANSWERS : EMPTY_CAMPAIGN_DRAFT)

    const filled =
      next === 'contact-partial' || next === 'contact-failed'
    setContact(filled ? { ...CONCEPT_RIDER } : EMPTY_CONTACT)

    setTypedCode(next === 'manual-error' ? CONCEPT_TYPED_CODE : '')
  }

  return (
    <AppSurface width="station" className="flex flex-col gap-page">
      <ConceptStateBar value={state} onChange={goTo} />

      <StationHeader />

      <Body
        state={state}
        answers={answers}
        onAnswers={(patch) => setAnswers((current) => ({ ...current, ...patch }))}
        contact={contact}
        onContact={(patch) => setContact((current) => ({ ...current, ...patch }))}
        typedCode={typedCode}
        onTypedCode={setTypedCode}
        goTo={goTo}
      />

      {/*
        The saved count, everywhere except the success state, which carries its
        own. Quiet, at the bottom, in the smallest type on the screen: it is
        operational metadata an operator glances at between riders, and turning
        it into a headline figure would make the terminal look like a dashboard.
      */}
      {state !== 'success' && (
        <p className="border-t border-line pt-4 font-ui text-small tabular-nums text-faint">
          Responses saved on this device · {CONCEPT_SAVED_COUNT}
        </p>
      )}
    </AppSurface>
  )
}

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

interface BodyProps {
  readonly state: ConceptState
  readonly answers: FlyingFleaFeedbackDraft
  readonly onAnswers: (patch: Partial<FlyingFleaFeedbackDraft>) => void
  readonly contact: ContactDraftFixture
  readonly onContact: (patch: Partial<ContactDraftFixture>) => void
  readonly typedCode: string
  readonly onTypedCode: (value: string) => void
  readonly goTo: (state: ConceptState) => void
}

function Body({
  state,
  answers,
  onAnswers,
  contact,
  onContact,
  typedCode,
  onTypedCode,
  goTo,
}: BodyProps) {
  switch (state) {
    case 'start':
      return (
        <IdentityChoice
          onScan={() => goTo('scanning')}
          onManual={() => goTo('manual')}
          onContact={() => goTo('contact')}
        />
      )

    case 'starting':
    case 'scanning':
    case 'bad-qr':
      return (
        <ScannerPanel
          phase={state === 'starting' ? 'starting' : 'scanning'}
          notice={state === 'bad-qr' ? CONCEPT_QR_REJECTION : null}
          goTo={goTo}
        />
      )

    case 'camera-error':
      return <CameraErrorPanel goTo={goTo} />

    case 'manual':
    case 'manual-error':
      return (
        <ManualCodePanel
          value={typedCode}
          onChange={onTypedCode}
          error={state === 'manual-error' ? CONCEPT_CODE_REJECTION : null}
          onSubmit={() => goTo('feedback')}
          onBack={() => goTo('scanning')}
          onContact={() => goTo('contact')}
        />
      )

    case 'already-recorded':
      return (
        <AlreadyRecordedOutcome
          publicCode={CONCEPT_PUBLIC_CODE}
          onNext={() => goTo('start')}
        />
      )

    case 'success':
      return (
        <SuccessOutcome
          savedCount={CONCEPT_SAVED_COUNT}
          onNext={() => goTo('start')}
        />
      )

    case 'contact':
    case 'contact-partial':
    case 'contact-error':
    case 'contact-failed':
      return (
        <ContactPanel
          state={state}
          answers={answers}
          onAnswers={onAnswers}
          contact={contact}
          onContact={onContact}
          goTo={goTo}
        />
      )

    default:
      return (
        <StickerFeedbackPanel state={state} answers={answers} onAnswers={onAnswers} goTo={goTo} />
      )
  }
}

/*
 * The scanner: one task, one frame, and everything else underneath it.
 *
 * The two alternate paths stay on screen while the camera runs. An operator who
 * discovers mid-scan that the sticker is missing or unreadable should not have
 * to back out to a menu to say so, and V1 was right to put them here; what
 * changes is that they are no longer three near-identical buttons in a row.
 */
function ScannerPanel({
  phase,
  notice,
  goTo,
}: {
  readonly phase: 'starting' | 'scanning'
  readonly notice: string | null
  readonly goTo: (state: ConceptState) => void
}) {
  return (
    <section aria-labelledby="scan-heading" className="flex flex-col gap-5">
      <h2 id="scan-heading" className="sr-only">
        Scan the rider's sticker
      </h2>

      <ScannerStage phase={phase} />

      {/* Instruction in text, below the picture, never over it. */}
      <p className="text-center font-body text-lead text-muted">
        {phase === 'starting'
          ? 'Waiting for the camera.'
          : "Hold the sticker's QR inside the frame."}
      </p>

      {notice !== null && (
        <Alert tone="warn">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>That sticker was not accepted</AlertTitle>
          <AlertDescription>
            {notice} The camera is still running: try another sticker, or use one
            of the paths below.
          </AlertDescription>
        </Alert>
      )}

      <AlternatePaths goTo={goTo} />
    </section>
  )
}

/*
 * A camera that will not start is an inconvenience, not a fault in the product.
 *
 * Amber, not red: the rider has two other ways through, both one tap away, and
 * the most common cause is somebody declining a permission prompt. Red here
 * would say the feedback system had failed, which it has not, and an operator
 * who sees red for an ordinary permission dialog several times a day stops
 * reading red.
 */
function CameraErrorPanel({
  goTo,
}: {
  readonly goTo: (state: ConceptState) => void
}) {
  return (
    <section aria-labelledby="camera-error-heading" className="flex flex-col gap-5">
      <Alert tone="warn">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle
          id="camera-error-heading"
          className="font-display text-title tracking-wide"
        >
          Camera unavailable
        </AlertTitle>
        <AlertDescription>
          {CONCEPT_CAMERA_ERROR} Feedback still works: the two paths below do not
          need a camera.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center gap-2.5">
        <AppButton size="lg" onClick={() => goTo('scanning')}>
          Try camera again
        </AppButton>
      </div>

      <AlternatePaths goTo={goTo} />
    </section>
  )
}

/**
 * The two paths that never need a camera.
 *
 * Rendered identically wherever they appear, and identically to each other.
 */
function AlternatePaths({ goTo }: { readonly goTo: (state: ConceptState) => void }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:gap-3">
      <AppButton
        variant="secondary"
        className="flex-1 justify-start gap-3"
        onClick={() => goTo('manual')}
      >
        <KeyboardIcon />
        Enter code
      </AppButton>
      <AppButton
        variant="secondary"
        className="flex-1 justify-start gap-3"
        onClick={() => goTo('contact')}
      >
        <UserIcon />
        No QR or code
      </AppButton>
    </div>
  )
}

/** The band that says which rider this is. A public code, and nothing else. */
function IdentityBand({ publicCode }: { readonly publicCode: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-muted">
        Participant
      </span>
      {/*
        No name, phone or email: this device does not know them, and looking
        them up would make the flow depend on a connection a venue tablet does
        not have. The code is the whole identity here, and it is enough.
      */}
      <p
        data-testid="concept-participant-code"
        className="font-mono text-page leading-none tracking-tight text-ink tabular-nums [font-feature-settings:'zero'_1]"
      >
        {publicCode}
      </p>
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
function SaveFailureAlert({ keepsContact }: { readonly keepsContact: boolean }) {
  return (
    <Alert tone="danger">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle className="font-display text-title tracking-wide">
        Feedback not saved
      </AlertTitle>
      <AlertDescription>
        Nothing was written to this device: {CONCEPT_SAVE_ERROR}. This response
        does not exist yet.{' '}
        {keepsContact
          ? 'Every answer, and the details above, are still here.'
          : 'Every answer below is still here.'}{' '}
        Press Submit Feedback again.
      </AlertDescription>
    </Alert>
  )
}

function StickerFeedbackPanel({
  state,
  answers,
  onAnswers,
  goTo,
}: {
  readonly state: ConceptState
  readonly answers: FlyingFleaFeedbackDraft
  readonly onAnswers: (patch: Partial<FlyingFleaFeedbackDraft>) => void
  readonly goTo: (state: ConceptState) => void
}) {
  const saving = state === 'saving'
  const failed = state === 'feedback-failed'

  return (
    <section aria-labelledby="feedback-heading" className="flex flex-col gap-6">
      <IdentityBand publicCode={CONCEPT_PUBLIC_CODE} />

      {failed && <SaveFailureAlert keepsContact={false} />}

      <FeedbackForm
        heading="Feedback"
        headingId="feedback-heading"
        answers={answers}
        onAnswers={onAnswers}
        errors={{}}
        disabled={saving}
        busy={saving}
        onSubmit={() => goTo('success')}
      />
    </section>
  )
}

function ContactPanel({
  state,
  answers,
  onAnswers,
  contact,
  onContact,
  goTo,
}: {
  readonly state: ConceptState
  readonly answers: FlyingFleaFeedbackDraft
  readonly onAnswers: (patch: Partial<FlyingFleaFeedbackDraft>) => void
  readonly contact: ContactDraftFixture
  readonly onContact: (patch: Partial<ContactDraftFixture>) => void
  readonly goTo: (state: ConceptState) => void
}) {
  const invalid = state === 'contact-error'
  const failed = state === 'contact-failed'

  /*
   * Both halves are reported together. A rider who left a rating blank and
   * mistyped their email sees both at once; validating the contact details
   * first and returning would show them one problem, then the other after they
   * fixed it. That is `ContactFeedbackForm`'s existing rule and it is right.
   */
  const answerErrors: CampaignFeedbackErrors = invalid
    ? {
        testRideExperience: MISSING_RATING,
        rotaryKnobUsage: MISSING_RATING,
        rideModesExperience: MISSING_RATING,
        overallExperienceRating: MISSING_RATING,
      }
    : {}

  return (
    <section aria-labelledby="contact-heading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2
          id="contact-heading"
          className="font-display text-title tracking-wide text-ink"
        >
          Your details
        </h2>
        <p className="max-w-measure font-body text-lead text-muted">
          No sticker and no code is fine. Tell us who you are and answer the same
          questions as everybody else.
        </p>
      </div>

      {failed && <SaveFailureAlert keepsContact />}

      {/*
        One form, one submit, one save.

        Deliberately not a two-step wizard that collects contact details and
        then hands the rider to the questionnaire: this is somebody who has just
        got off a motorcycle, and a second screen is a second chance to walk
        away. It is also what keeps a failed write cheap, because the name, the
        email, the phone number and all six answers are in one mounted form.
      */}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          goTo('success')
        }}
        noValidate
        className="flex flex-col gap-8"
      >
        <div className="flex flex-col gap-4">
          <SectionHeading title="Rider details" />
          <ContactFields
            value={contact}
            onChange={onContact}
            errors={invalid ? CONTACT_ERRORS : {}}
          />
        </div>

        <div className="flex flex-col gap-1">
          <SectionHeading title="Feedback" />
          <QuestionnaireFields
            draft={answers}
            errors={answerErrors}
            disabled={false}
            onChange={onAnswers}
          />
        </div>

        <SubmitRow busy={false} />
      </form>
    </section>
  )
}

interface FeedbackFormProps {
  readonly heading: string
  readonly headingId: string
  readonly answers: FlyingFleaFeedbackDraft
  readonly onAnswers: (patch: Partial<FlyingFleaFeedbackDraft>) => void
  readonly errors: CampaignFeedbackErrors
  readonly disabled: boolean
  readonly busy: boolean
  readonly onSubmit: () => void
}

function FeedbackForm({
  heading,
  headingId,
  answers,
  onAnswers,
  errors,
  disabled,
  busy,
  onSubmit,
}: FeedbackFormProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      noValidate
      className="flex flex-col gap-1"
    >
      <h2
        id={headingId}
        className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-ink"
      >
        {heading}
      </h2>

      <QuestionnaireFields
        draft={answers}
        errors={errors}
        disabled={disabled}
        onChange={onAnswers}
      />

      <SubmitRow busy={busy} />
    </form>
  )
}

/*
 * A section of the contact form. Deliberately unnumbered.
 *
 * The first attempt numbered these "01 Rider details" and "02 Feedback", which
 * put an "01" directly above the questionnaire's own "01", in the same lime, on
 * the same screen, meaning two different things. One numbering system per page:
 * the numerals belong to the six questions, because those are what a rider
 * counts down and what §18 asks to be numbered. The sections above them are
 * labels.
 */
function SectionHeading({ title }: { readonly title: string }) {
  return (
    <h3 className="border-b border-line pb-2 font-ui text-label font-semibold uppercase tracking-[0.16em] text-ink">
      {title}
    </h3>
  )
}

function SubmitRow({ busy }: { readonly busy: boolean }): ReactNode {
  return (
    <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-body text-small text-faint">
        Saved on this device. A network is not needed.
      </p>
      {/*
        `busy` disables, always: `AppButton` makes the two inseparable, so a
        double tap while a save is in flight cannot produce two records.
      */}
      <AppButton
        type="submit"
        size="lg"
        busy={busy}
        busyLabel="Saving…"
        className="sm:min-w-56"
      >
        Submit Feedback
      </AppButton>
    </div>
  )
}
