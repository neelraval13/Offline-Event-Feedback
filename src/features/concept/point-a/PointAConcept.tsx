import { OctagonAlertIcon, TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { AppButton, AppSurface } from '@/components/design-system'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EVENT_CONFIG, stationFor } from '@/config/event'
import { formatEventDay } from '@/config/eventTime'
import { FLYING_FLEA_CAMPAIGN } from '@/features/campaign/flying-flea/config'
import type { FlyingFleaColour } from '@/types'
import { ColourChoice } from './ColourChoice'
import { ConceptStateBar, type ConceptState } from './ConceptStateBar'
import { CorrectionSheet } from './CorrectionSheet'
import {
  CONCEPT_DEVICE_ERROR,
  CONCEPT_PUBLIC_CODE,
  CONCEPT_RECENT,
  CONCEPT_RIDER,
  CONCEPT_SAVE_ERROR,
} from './fixtures'
import { RecentStrip } from './RecentStrip'
import { EMPTY_RIDER, RiderDetails, type RiderDraft } from './RiderDetails'
import { SavedPanel, type ConceptStickerState } from './SavedPanel'
import { StationStep } from './StationStep'
import { VehiclePlates } from './VehiclePlates'

/*
 * Point A, V2: a concept.
 *
 * ## What this is not
 *
 * It is not the registration terminal. `/#/a` still renders
 * `RegistrationScreen` exactly as it did, and nothing in this directory is
 * imported by it. This file calls no registration function, opens no database,
 * mints no identity, prints nothing and syncs nothing. Every value on screen
 * comes from `fixtures.ts` or from campaign configuration that is already
 * read-only data. Opening this route on a machine holding real event records
 * cannot change one of them.
 *
 * ## The real state machine, which this reproduces
 *
 * Read off `useRegistrationTerminal.ts`:
 *
 *     entry ──submit──▶ saving ──throws──▶ save-failed ──▶ (form still filled)
 *                         │
 *                         │  createRegistration resolves   ◀── DURABILITY LINE
 *                         ▼
 *                       saved { record, sticker: rendering }
 *                         │
 *                 ┌───────┴────────┐
 *                 ▼                ▼
 *          sticker: ready    sticker: failed ──retry──▶ rendering
 *          print / reprint   (the record is already safe)
 *          next rider ──▶ entry
 *
 *     recent[] ──reprint──▶ saved { record, sticker: rendering }
 *     deviceError ──▶ blocking, and orthogonal to all of the above
 *
 * Three properties of it drive every layout decision below.
 *
 * **The durability line.** Everything above it can fail and lose the rider;
 * nothing below it can. The design therefore gives the two sides different
 * shapes, not different wording: the saved side always has a green band and a
 * public code in it, and the failed side has neither, so they are told apart
 * from across a desk before a word is read.
 *
 * **Entry and saved never coexist.** The real screen swaps them, and this keeps
 * that: there is no state in which a filled registration form and a saved
 * rider's actions are both on screen, because that is the state in which
 * somebody gets registered twice.
 *
 * **Recovery is always available.** `recent` is rendered in every state
 * including entry, because the reason it exists is a label that failed three
 * riders ago.
 *
 * ## The one thing the terminal does not currently tell the UI
 *
 * Whether a print has been attempted. `print()` calls the browser and returns;
 * the phase is unchanged either side of it. §13's hierarchy genuinely differs
 * across that boundary, so the concept models it as a prop and the review tool
 * toggles it. Implementing it would mean one boolean on the `saved` phase set
 * by `print()`, which is a change to the terminal and therefore out of scope
 * for concept work. It is flagged rather than made.
 */

const STATION = stationFor('registration')

/** Which sticker state each concept state implies. */
const STICKER_FOR: Partial<Record<ConceptState, ConceptStickerState>> = {
  saved: 'ready',
  'sticker-failed': 'failed',
  correction: 'ready',
  recovery: 'rendering',
}

export function PointAConcept() {
  const [state, setState] = useState<ConceptState>('new')
  const [printed, setPrinted] = useState(false)

  /* Live form state, so the concept is operable rather than a picture. */
  const [rider, setRider] = useState<RiderDraft>(EMPTY_RIDER)
  const [vehicle, setVehicle] = useState<string | null>(null)
  const [colour, setColour] = useState<FlyingFleaColour>(
    FLYING_FLEA_CAMPAIGN.colours[0] as FlyingFleaColour,
  )
  const [correcting, setCorrecting] = useState(false)

  /*
   * Moving to a state that shows a filled rider fills the form, so the saved
   * and correction states are reviewable without typing six fields first.
   */
  function goTo(next: ConceptState) {
    const filled = next !== 'new' && next !== 'storage-blocked'

    setState(next)
    setPrinted(false)
    setCorrecting(next === 'correction')
    setRider(filled ? { ...CONCEPT_RIDER } : EMPTY_RIDER)
    setVehicle(filled ? (FLYING_FLEA_CAMPAIGN.vehicles[1] as string) : null)
  }

  const showsForm =
    state === 'new' ||
    state === 'saving' ||
    state === 'save-failed' ||
    state === 'storage-blocked'
  const sticker = STICKER_FOR[state]
  const blocked = state === 'storage-blocked'

  return (
    <AppSurface width="station" className="flex flex-col gap-page">
      <ConceptStateBar
        value={state}
        onChange={goTo}
        printed={printed}
        onPrintedChange={setPrinted}
      />

      {/*
        The heading names which of the screen's two jobs is in hand. Leaving it
        on "New rider" after a save would be the screen telling an operator, at
        the top, that it is ready for the next person while the last person's
        sticker is still on it: exactly the confusion that ends in a duplicate.
      */}
      <StationHeader title={sticker === undefined ? 'New rider' : 'Rider registered'} />

      {/*
        The only condition that stops registration, and the reason it looks
        nothing like the other two failures: no network is normal here and gets
        no banner at all, but a device that cannot write locally cannot take a
        rider safely, and every control below it is disabled while it holds.
      */}
      {blocked && (
        <Alert tone="danger">
          <OctagonAlertIcon aria-hidden="true" />
          <AlertTitle className="font-display text-title tracking-wide">
            Do not register riders on this device
          </AlertTitle>
          <AlertDescription>
            This device cannot reach local storage: {CONCEPT_DEVICE_ERROR}.
            Nothing can be saved, so nothing typed here would survive. Use
            another tablet and tell whoever is running the event.
          </AlertDescription>
        </Alert>
      )}

      {showsForm && (
        <RegistrationBody
          state={state}
          blocked={blocked}
          rider={rider}
          onRiderChange={(patch) =>
            setRider((current) => ({ ...current, ...patch }))
          }
          vehicle={vehicle}
          onVehicleChange={setVehicle}
          colour={colour}
          onColourChange={setColour}
        />
      )}

      {sticker !== undefined && (
        <SavedPanel
          publicCode={CONCEPT_PUBLIC_CODE}
          sticker={sticker}
          printed={printed}
          onPrint={() => setPrinted(true)}
          onRetrySticker={() => goTo('saved')}
          onCorrect={() => setCorrecting(true)}
          onNextRider={() => goTo('new')}
        />
      )}

      <RecentStrip
        records={CONCEPT_RECENT}
        activeCode={sticker === undefined ? null : CONCEPT_PUBLIC_CODE}
        onReprint={() => goTo('recovery')}
      />

      <CorrectionSheet
        open={correcting}
        onOpenChange={setCorrecting}
        publicCode={CONCEPT_PUBLIC_CODE}
        rider={rider}
        onRiderChange={(patch) =>
          setRider((current) => ({ ...current, ...patch }))
        }
        vehicles={FLYING_FLEA_CAMPAIGN.vehicles}
        vehicle={vehicle}
        onVehicleChange={setVehicle}
        colours={FLYING_FLEA_CAMPAIGN.colours}
        colour={colour}
        onColourChange={setColour}
        genders={FLYING_FLEA_CAMPAIGN.genders}
        onSave={() => setCorrecting(false)}
      />
    </AppSurface>
  )
}

/*
 * The terminal's own heading.
 *
 * Two lines and a stated fact, replacing V1's photographic hero. The banner is
 * the campaign's best asset and it is right on the Home and Point B screens,
 * where somebody arrives once; at Point A it is roughly 300px of photograph at
 * the top of a form the operator returns to several hundred times, and after
 * the third rider it is scroll.
 *
 * The venue and the day are stated here rather than asked, exactly as
 * `EventMeta` does today, and for the same reason: they are attached at submit
 * from configuration and the venue clock. A disabled input holding an answer
 * the operator cannot change is still a control they look at and tab past.
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

      <p className="flex flex-col text-right font-ui text-small leading-tight text-muted">
        <span>{FLYING_FLEA_CAMPAIGN.lockedLocation}</span>
        <span className="text-faint">
          {formatEventDay(EVENT_CONFIG.eventDay)} · {STATION.stationId}
        </span>
      </p>
    </header>
  )
}

interface RegistrationBodyProps {
  readonly state: ConceptState
  readonly blocked: boolean
  readonly rider: RiderDraft
  readonly onRiderChange: (patch: Partial<RiderDraft>) => void
  readonly vehicle: string | null
  readonly onVehicleChange: (vehicle: string) => void
  readonly colour: FlyingFleaColour
  readonly onColourChange: (colour: FlyingFleaColour) => void
}

function RegistrationBody({
  state,
  blocked,
  rider,
  onRiderChange,
  vehicle,
  onVehicleChange,
  colour,
  onColourChange,
}: RegistrationBodyProps) {
  const saving = state === 'saving'
  const disabled = saving || blocked

  return (
    <form
      /* A concept. Nothing is submitted, validated, stamped or stored. */
      onSubmit={(event) => event.preventDefault()}
      noValidate
      className="flex flex-col gap-8"
    >
      {/*
        The genuinely dangerous failure, and the only one in the product that
        gets the destructive treatment. It says three things V1 says and one it
        does not: that the entries below survived, which is what stops an
        operator retyping six fields they can still see.
      */}
      {state === 'save-failed' && (
        <Alert tone="danger">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle className="font-display text-title tracking-wide">
            Registration not saved
          </AlertTitle>
          <AlertDescription>
            Nothing was written and no sticker exists: {CONCEPT_SAVE_ERROR}.
            This rider is <strong>not</strong> registered. Everything typed
            below is still here, so check the details and press Register &amp;
            Print again.
          </AlertDescription>
        </Alert>
      )}

      <StationStep step="01" title="Vehicle" note="Read the plate on the bike">
        <VehiclePlates
          vehicles={FLYING_FLEA_CAMPAIGN.vehicles}
          value={vehicle}
          onChange={onVehicleChange}
          disabled={disabled}
        />
      </StationStep>

      <StationStep step="02" title="Interested colour">
        <ColourChoice
          colours={FLYING_FLEA_CAMPAIGN.colours}
          value={colour}
          onChange={onColourChange}
          disabled={disabled}
        />
      </StationStep>

      <StationStep step="03" title="Rider details">
        <RiderDetails
          value={rider}
          onChange={onRiderChange}
          genders={FLYING_FLEA_CAMPAIGN.genders}
          disabled={disabled}
        />
      </StationStep>

      {/*
        One action, on its own rule, at the end of the reading order.

        Not a sticky bar: on a tablet the software keyboard is open for most of
        this form and a bar pinned to the bottom of the viewport sits either
        under the keyboard or on top of the field being typed into. A button at
        the end of the form is where the operator's eye already is when they
        finish the last field, and Enter from that field submits anyway.
      */}
      <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-body text-small text-faint">
          Venue and test-ride time are stamped automatically when this is saved.
        </p>
        <AppButton
          type="submit"
          size="lg"
          busy={saving}
          busyLabel="Saving…"
          disabled={blocked}
          className="sm:min-w-56"
        >
          Register &amp; Print
        </AppButton>
      </div>
    </form>
  )
}
