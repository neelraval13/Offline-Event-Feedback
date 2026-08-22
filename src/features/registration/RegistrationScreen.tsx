import {
  CheckCircle2Icon,
  OctagonAlertIcon,
  PrinterIcon,
  TriangleAlertIcon,
  UserPlusIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AppButton, AppSurface, StatusPill } from '../../components/design-system'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { EVENT_CONFIG, stationFor } from '../../config/event'
import { formatEventDay } from '../../config/eventTime'
import { CampaignRegistrationForm } from '../campaign/flying-flea/components/CampaignRegistrationForm'
import { FLYING_FLEA_CAMPAIGN } from '../campaign/flying-flea/config'
import { stampEventFields } from '../campaign/flying-flea/eventStamp'
import { cn } from '../../lib/ui/cn'
import { CorrectionSheet } from './CorrectionSheet'
import { PrintableSticker } from './PrintableSticker'
import { RecentReprints } from './RecentReprints'
import { Sticker } from './Sticker'
import { useRegistrationTerminal, type StickerState } from './useRegistrationTerminal'
import type { CampaignFieldCorrections, RegistrationRecord } from '../../types'
import type { RegistrationFormValues } from './validation'

/*
 * Point A: the registration terminal, in the V2 design.
 *
 * ## The one invariant this screen exists to make visible
 *
 * A registration becomes durable in IndexedDB *before* a sticker is rendered,
 * and nothing that happens afterwards can invalidate it. The QR renderer can
 * fail, the printer can jam, the label can come out blank, and the browser
 * cannot even confirm that printing happened. None of that is a registration
 * problem, and an operator who thinks it is will register somebody twice.
 *
 * So the two sides of that line are given different *shapes*, not different
 * wording:
 *
 *   saved     a green band, a public code, a sticker area
 *   not saved a red band, and none of those three things
 *
 * They are told apart from across a desk before a word is read. The green band
 * is unconditional inside the saved state: it does not change tone or wording
 * when the sticker fails, because the sticker failing does not change what it
 * says.
 *
 * ## Entry and saved never coexist
 *
 * The screen swaps them, exactly as V1 did. There is no state in which a filled
 * registration form and a saved rider's actions are both on screen, because
 * that is the state in which somebody gets registered twice.
 *
 * ## What this file does not decide
 *
 * Identity, ordering, storage and stamping all live elsewhere and are untouched
 * by the V2 migration. `useRegistrationTerminal` still owns the sequence, and
 * `stampEventFields` is still called on the new-registration path only, so
 * fixing an email address at 16:10 cannot rewrite a ride that happened at
 * 15:42.
 */

const STATION = stationFor('registration')

export function RegistrationScreen() {
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
  // mouse. Preserved from V1 exactly.
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
    <AppSurface width="station" className="flex flex-col gap-page">
      <StationHeader
        title={phase.status === 'saved' ? 'Rider registered' : 'New rider'}
      />

      {/*
        The only condition that stops registration, and the reason it looks
        nothing like the other two failures: no network is normal here and gets
        no banner at all, but a device that cannot write locally cannot take a
        rider safely.
      */}
      {deviceError !== null && (
        <Alert tone="danger">
          <OctagonAlertIcon aria-hidden="true" />
          <AlertTitle className="font-display text-title tracking-wide">
            Do not register riders on this device
          </AlertTitle>
          <AlertDescription>
            This device cannot reach local storage: {deviceError}. Nothing can be
            saved, so nothing typed here would survive. Use another tablet and
            tell whoever is running the event.
          </AlertDescription>
        </Alert>
      )}

      {phase.status !== 'saved' && (
        <>
          {phase.status === 'save-failed' && (
            <Alert tone="danger">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle className="font-display text-title tracking-wide">
                Registration not saved
              </AlertTitle>
              <AlertDescription>
                Nothing was written and no sticker exists: {phase.message}. This
                rider is <strong>not</strong> registered. Everything typed below
                is still here, so check the details and press Register &amp;
                Print again.
              </AlertDescription>
            </Alert>
          )}

          {/*
            The venue and the test-ride time are attached here, on the way to the
            store, and nowhere else. This is the new-registration path: the
            correction path calls `handleCorrection`, which never stamps.
          */}
          <CampaignRegistrationForm
            onSubmit={(values) => void submit(stampEventFields(values))}
            busy={phase.status === 'saving'}
            resetKey={formGeneration}
          />
        </>
      )}

      {phase.status === 'saved' && (
        <SavedRider
          record={phase.record}
          sticker={phase.sticker}
          printAttempted={phase.printAttempted}
          printButtonRef={printButtonRef}
          onPrint={print}
          onRetrySticker={() => void retrySticker()}
          onCorrect={() => setEditing(true)}
          onNextRider={handleNextParticipant}
        />
      )}

      <RecentReprints
        records={recent}
        activeRecordId={saved?.recordId ?? null}
        onReprint={(record) => void reprint(record)}
      />

      {saved !== null && (
        <CorrectionSheet
          open={editing}
          onOpenChange={setEditing}
          record={saved}
          onSubmit={(values) => void handleCorrection(values)}
        />
      )}
    </AppSurface>
  )
}

/*
 * The terminal's own heading.
 *
 * Two lines and a stated fact, replacing V1's photographic hero. The banner is
 * the campaign's best asset and it is right on Home and Point B, where somebody
 * arrives once; at Point A it was roughly 300px of photograph at the top of a
 * form the operator returns to several hundred times, and after the third rider
 * it is scroll.
 *
 * The venue and the day are stated here rather than asked, exactly as
 * `EventMeta` did: they are attached at submit from configuration and the venue
 * clock, and a disabled input holding an answer nobody can change is still a
 * control to look at and tab past.
 *
 * The title names which of the screen's two jobs is in hand. Leaving it on "New
 * rider" after a save would be the screen saying, at the top, that it is ready
 * for the next person while the last person's sticker is still on it.
 */
function StationHeader({ title }: { readonly title: string }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-accent">
          Point A · Registration
        </span>
        <h1 className="font-display text-page leading-none tracking-wide text-ink">
          {title}
        </h1>
      </div>

      {/*
        Each fact in its own element. The venue and the day are two separate
        things an operator checks, and running them into one text node would
        also mean nothing could assert on either alone.
      */}
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

interface SavedRiderProps {
  readonly record: RegistrationRecord
  readonly sticker: StickerState
  readonly printAttempted: boolean
  readonly printButtonRef: React.RefObject<HTMLButtonElement | null>
  readonly onPrint: () => void
  readonly onRetrySticker: () => void
  readonly onCorrect: () => void
  readonly onNextRider: () => void
}

function SavedRider({
  record,
  sticker,
  printAttempted,
  printButtonRef,
  onPrint,
  onRetrySticker,
  onCorrect,
  onNextRider,
}: SavedRiderProps) {
  const ready = sticker.status === 'ready'

  return (
    <section aria-labelledby="saved-heading" className="flex flex-col gap-6">
      <h2 id="saved-heading" className="sr-only">
        Registration saved
      </h2>

      {/*
        Unconditional, in every branch below. This is the sentence the operator
        needs before they have finished reading anything else on the screen, and
        it does not soften or change colour when the sticker goes wrong.
      */}
      <Alert tone="ok">
        <CheckCircle2Icon aria-hidden="true" />
        <AlertTitle className="font-display text-title tracking-wide">
          Registration saved
        </AlertTitle>
        <AlertDescription>
          This rider is in the system on this device. Nothing that happens to the
          label can undo that, so do not register them again.
        </AlertDescription>
      </Alert>

      {/* The identity. Large, monospaced, and read aloud off a desk. */}
      <div className="flex flex-col gap-1">
        <span className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-muted">
          Public code
        </span>
        <p
          data-testid="saved-public-code"
          className="font-mono text-page leading-none tracking-tight text-ink tabular-nums [font-feature-settings:'zero'_1]"
        >
          {record.publicCode}
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
        <StickerArea sticker={sticker} publicCode={record.publicCode} />

        <div className="flex flex-col gap-4">
          {sticker.status === 'failed' && (
            <Alert tone="warn">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>Sticker unavailable</AlertTitle>
              <AlertDescription>
                The registration is saved, so do not register this rider again.
                Only the sticker image failed to render: {sticker.message}. Retry
                the sticker, or move on and reprint it from the recent list.
              </AlertDescription>
            </Alert>
          )}

          {ready && (
            <p className="max-w-measure font-body text-small text-muted">
              Printing cannot be confirmed by the browser. If the label did not
              come out, or came out badly, print it again: it will be the same
              sticker, with the same code.
            </p>
          )}

          <ActionRow
            sticker={sticker}
            printAttempted={printAttempted}
            printButtonRef={printButtonRef}
            onPrint={onPrint}
            onRetrySticker={onRetrySticker}
            onCorrect={onCorrect}
            onNextRider={onNextRider}
          />
        </div>
      </div>
    </section>
  )
}

/**
 * The label, or an explanation of why there is not one.
 *
 * The frame is drawn at the sticker's own footprint in every state, so the
 * panel does not resize under the operator's hand when a sticker arrives or a
 * retry succeeds. Buttons that move as you reach for them is how a print
 * becomes a correction.
 */
function StickerArea({
  sticker,
  publicCode,
}: {
  readonly sticker: StickerState
  readonly publicCode: RegistrationRecord['publicCode']
}) {
  if (sticker.status === 'ready') {
    return (
      <div className="inline-flex flex-col items-center gap-2 rounded-card border border-line bg-surface p-3">
        {/* On-screen proof, at true physical size. Unchanged from V1. */}
        <Sticker qrSvg={sticker.qrSvg} publicCode={publicCode} />
        {/* The copy the printer receives, portalled outside #root so print can
            switch the application off entirely. Unchanged from V1. */}
        <PrintableSticker qrSvg={sticker.qrSvg} publicCode={publicCode} />
        <p className="font-ui text-caption uppercase tracking-[0.16em] text-faint">
          50 x 40 mm
        </p>
      </div>
    )
  }

  const failed = sticker.status === 'failed'

  return (
    <div
      className={cn(
        'flex h-[calc(40mm+3.25rem)] w-[calc(50mm+1.5rem)] flex-col items-center justify-center gap-2',
        'rounded-card border border-dashed p-3',
        failed ? 'border-warn-line bg-warn-soft' : 'border-line',
      )}
    >
      {/*
        Amber, not red, and for the same reason the band beside it is amber: the
        label is missing, not lost. A red pill inside an amber region would be
        the screen contradicting itself about how bad this is.
      */}
      <StatusPill
        status={failed ? 'pending' : 'offline-preparing'}
        label={failed ? 'No sticker' : 'Preparing'}
      />
      <p className="text-center font-body text-small text-muted">
        {failed ? 'The label could not be drawn.' : 'Drawing the label…'}
      </p>
    </div>
  )
}

/*
 * Exactly one primary in every branch, and it is always the operator's next
 * physical act:
 *
 *   sticker failed   -> get a label       Retry sticker
 *   not yet printed  -> print the label   Print sticker
 *   printed          -> take the queue    Next rider
 *
 * Everything else steps down to secondary and then to ghost. "Correct details"
 * is never above tertiary once a label exists, because at that point it is the
 * rarest thing an operator does and the most expensive to hit by accident.
 *
 * `Print sticker` is rendered in every branch, disabled until a sticker exists,
 * rather than appearing when one does. A control that materialises under a
 * finger already moving toward it is how a print becomes a correction, and a
 * disabled button says "there is nothing to print yet" where an absent one says
 * nothing at all.
 */
function ActionRow({
  sticker,
  printAttempted,
  printButtonRef,
  onPrint,
  onRetrySticker,
  onCorrect,
  onNextRider,
}: {
  readonly sticker: StickerState
  readonly printAttempted: boolean
  readonly printButtonRef: React.RefObject<HTMLButtonElement | null>
  readonly onPrint: () => void
  readonly onRetrySticker: () => void
  readonly onCorrect: () => void
  readonly onNextRider: () => void
}) {
  const ready = sticker.status === 'ready'

  const printButton = (
    <AppButton
      ref={printButtonRef}
      size={!printAttempted && ready ? 'lg' : 'default'}
      variant={!printAttempted && ready ? 'default' : 'secondary'}
      disabled={!ready}
      onClick={onPrint}
    >
      <PrinterIcon />
      Print sticker
    </AppButton>
  )

  const reprintButton = (
    <AppButton variant="secondary" disabled={!ready} onClick={onPrint}>
      <PrinterIcon />
      Reprint sticker
    </AppButton>
  )

  const nextButton = (emphasis: 'primary' | 'quiet'): ReactNode => (
    <AppButton
      size={emphasis === 'primary' ? 'lg' : 'default'}
      variant={emphasis === 'primary' ? 'default' : 'ghost'}
      onClick={onNextRider}
    >
      <UserPlusIcon />
      Next rider
    </AppButton>
  )

  const correctButton = (emphasis: 'secondary' | 'quiet'): ReactNode => (
    <AppButton
      variant={emphasis === 'secondary' ? 'secondary' : 'ghost'}
      onClick={onCorrect}
    >
      Correct details
    </AppButton>
  )

  if (sticker.status === 'failed') {
    return (
      <ButtonRow>
        <AppButton size="lg" onClick={onRetrySticker}>
          <PrinterIcon />
          Retry sticker
        </AppButton>
        {printButton}
        {nextButton('quiet')}
        {correctButton('quiet')}
      </ButtonRow>
    )
  }

  if (!printAttempted) {
    return (
      <ButtonRow>
        {printButton}
        {correctButton('secondary')}
        {nextButton('quiet')}
      </ButtonRow>
    )
  }

  return (
    <ButtonRow>
      {nextButton('primary')}
      {reprintButton}
      {correctButton('quiet')}
    </ButtonRow>
  )
}

function ButtonRow({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2.5">{children}</div>
}
