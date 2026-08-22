import { CheckCircle2Icon, PrinterIcon, TriangleAlertIcon, UserPlusIcon } from 'lucide-react'
import { AppButton, StatusPill } from '@/components/design-system'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/ui/cn'
import { CONCEPT_QR_SVG, CONCEPT_STICKER_ERROR } from './fixtures'
import { StickerPreview } from './StickerPreview'

/*
 * The rider is saved. Now we deal with the label.
 *
 * ## The invariant this panel exists to make visible
 *
 * A registration becomes durable in IndexedDB before a sticker is rendered, and
 * nothing that happens afterwards can invalidate it: the QR renderer can fail,
 * the printer can jam, the label can come out blank, the browser cannot even
 * confirm that printing happened. None of that is a registration problem.
 *
 * So the green band at the top of this panel is unconditional. It is the first
 * thing rendered in every branch below, including the failure branch, and it
 * never changes wording or tone when the sticker goes wrong. The sticker's
 * state is reported underneath it, as a second and lesser fact.
 *
 * That is the whole difference between this panel and the save-failure state,
 * which renders no green band, no public code and no sticker area at all,
 * because in that state none of those things exist. An operator glancing at the
 * screen from two feet away tells the two apart by shape before they read a
 * word: saved has a code in it, failed does not.
 *
 * ## Why a sticker failure is amber and not red
 *
 * V1 renders it with the same error treatment as a failed save. Both are
 * `notice--error`, both are red, and the only thing distinguishing "we lost the
 * rider" from "print it again" is the sentence inside. Red is reserved in V2
 * for the state where something was actually lost, which here is exactly one
 * state. A sticker that failed to render is recoverable in one tap, the rider
 * is already safe, and telling an operator otherwise several times a day is how
 * they learn to ignore red.
 *
 * ## The action hierarchy
 *
 * `printed` reflects whether the operator has attempted a print. The current
 * terminal does not track this; see the note in `PointAConcept.tsx`. It is
 * modelled here because the right hierarchy genuinely differs either side of
 * it: before a print the job is to print, and afterwards the job is the next
 * rider. Nothing else about the panel depends on it.
 */

export type ConceptStickerState = 'rendering' | 'ready' | 'failed'

interface SavedPanelProps {
  readonly publicCode: string
  readonly sticker: ConceptStickerState
  /** Whether a print has been attempted. Drives the action hierarchy only. */
  readonly printed: boolean
  readonly onPrint: () => void
  readonly onRetrySticker: () => void
  readonly onCorrect: () => void
  readonly onNextRider: () => void
}

export function SavedPanel({
  publicCode,
  sticker,
  printed,
  onPrint,
  onRetrySticker,
  onCorrect,
  onNextRider,
}: SavedPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      {/*
        Unconditional, in every branch. This is the sentence the operator needs
        before they have finished reading anything else on the screen.
      */}
      <Alert tone="ok">
        <CheckCircle2Icon aria-hidden="true" />
        <AlertTitle className="font-display text-title tracking-wide">
          Registration saved
        </AlertTitle>
        <AlertDescription>
          This rider is in the system on this device. Nothing that happens to
          the label can undo that, so do not register them again.
        </AlertDescription>
      </Alert>

      {/* The identity. Large, monospaced and read aloud off a desk. */}
      <div className="flex flex-col gap-1">
        <span className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-muted">
          Public code
        </span>
        <p
          data-testid="concept-public-code"
          className="font-mono text-page leading-none tracking-tight text-ink tabular-nums [font-feature-settings:'zero'_1]"
        >
          {publicCode}
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
        <StickerArea sticker={sticker} publicCode={publicCode} />

        <div className="flex flex-col gap-4">
          {sticker === 'failed' && (
            <Alert tone="warn">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>Sticker unavailable</AlertTitle>
              <AlertDescription>
                Only the label failed to render: {CONCEPT_STICKER_ERROR}. The
                registration above is untouched. Retry the sticker, or move on
                and reprint it from the recent list later.
              </AlertDescription>
            </Alert>
          )}

          {sticker === 'ready' && (
            <p className="max-w-measure font-body text-small text-muted">
              Printing cannot be confirmed by the browser. If the label did not
              come out, or came out badly, print it again: it will be the same
              sticker, with the same code.
            </p>
          )}

          <ActionRow
            sticker={sticker}
            printed={printed}
            onPrint={onPrint}
            onRetrySticker={onRetrySticker}
            onCorrect={onCorrect}
            onNextRider={onNextRider}
          />
        </div>
      </div>
    </div>
  )
}

function StickerArea({
  sticker,
  publicCode,
}: {
  readonly sticker: ConceptStickerState
  readonly publicCode: string
}) {
  if (sticker === 'ready') {
    return <StickerPreview qrSvg={CONCEPT_QR_SVG} publicCode={publicCode} />
  }

  /*
   * The frame is drawn at the label's own size in every state, so the panel
   * does not resize under the operator's hand when a sticker arrives or a
   * retry succeeds. Buttons that move as you reach for them is how a print
   * becomes a correction.
   */
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-card border border-dashed p-3',
        'w-[calc(50mm+1.5rem)] h-[calc(40mm+1.5rem)]',
        sticker === 'failed' ? 'border-warn-line bg-warn-soft' : 'border-line',
      )}
    >
      {/*
        Amber, not red, and for the same reason the band beside it is amber:
        the label is missing, not lost. A red pill inside an amber region is the
        screen contradicting itself about how bad this is.
      */}
      <StatusPill
        status={sticker === 'failed' ? 'pending' : 'offline-preparing'}
        label={sticker === 'failed' ? 'No sticker' : 'Preparing'}
      />
      <p className="text-center font-body text-small text-muted">
        {sticker === 'failed'
          ? 'The label could not be drawn.'
          : 'Drawing the label…'}
      </p>
    </div>
  )
}

function ActionRow({
  sticker,
  printed,
  onPrint,
  onRetrySticker,
  onCorrect,
  onNextRider,
}: {
  readonly sticker: ConceptStickerState
  readonly printed: boolean
  readonly onPrint: () => void
  readonly onRetrySticker: () => void
  readonly onCorrect: () => void
  readonly onNextRider: () => void
}) {
  /*
   * Exactly one primary in every branch, and it is always the operator's next
   * physical act:
   *
   *   sticker failed  -> get a label      Retry sticker
   *   not yet printed -> print the label  Print sticker
   *   printed         -> take the queue   Next rider
   *
   * Everything else steps down to secondary and then to ghost. "Correct
   * details" is never above tertiary once a label exists, because at that point
   * it is the rarest thing an operator does and the most expensive to hit by
   * accident.
   */
  if (sticker === 'failed') {
    return (
      <ButtonRow>
        <AppButton size="lg" onClick={onRetrySticker}>
          <PrinterIcon />
          Retry sticker
        </AppButton>
        <AppButton variant="secondary" onClick={onNextRider}>
          <UserPlusIcon />
          Next rider
        </AppButton>
        <AppButton variant="ghost" onClick={onCorrect}>
          Correct details
        </AppButton>
      </ButtonRow>
    )
  }

  if (!printed) {
    return (
      <ButtonRow>
        <AppButton
          size="lg"
          onClick={onPrint}
          disabled={sticker !== 'ready'}
          /*
           * The real screen moves focus here the moment the sticker is ready,
           * so Enter prints without a reach for the mouse. Preserved.
           */
          autoFocus={sticker === 'ready'}
        >
          <PrinterIcon />
          Print sticker
        </AppButton>
        <AppButton variant="secondary" onClick={onCorrect}>
          Correct details
        </AppButton>
        <AppButton variant="ghost" onClick={onNextRider}>
          Next rider
        </AppButton>
      </ButtonRow>
    )
  }

  return (
    <ButtonRow>
      <AppButton size="lg" onClick={onNextRider}>
        <UserPlusIcon />
        Next rider
      </AppButton>
      <AppButton variant="secondary" onClick={onPrint}>
        <PrinterIcon />
        Reprint sticker
      </AppButton>
      <AppButton variant="ghost" onClick={onCorrect}>
        Correct details
      </AppButton>
    </ButtonRow>
  )
}

function ButtonRow({ children }: { readonly children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2.5">{children}</div>
}
