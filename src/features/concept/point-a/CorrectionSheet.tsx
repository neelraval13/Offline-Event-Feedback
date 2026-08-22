import { AppButton } from '@/components/design-system'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { InfoIcon } from 'lucide-react'
import type { FlyingFleaColour } from '@/types'
import { ColourChoice } from './ColourChoice'
import { RiderDetails, type RiderDraft } from './RiderDetails'
import { StationStep } from './StationStep'
import { VehiclePlates } from './VehiclePlates'

/*
 * Correcting a rider who is already registered.
 *
 * ## Why a sheet, and not the inline form V1 uses
 *
 * V1 toggles the entire three-step registration form open underneath the saved
 * panel, the buttons and the recent list. The result is a page roughly three
 * times as tall as anything else at Point A, with a second copy of the same
 * form on it, and the operator's own registration form is the thing it most
 * resembles. That is the exact confusion §3 says must never be possible: a
 * screen where re-entering somebody's details looks like registering somebody.
 *
 * A sheet fixes it structurally rather than with wording:
 *
 *   - The saved panel stays on screen behind it, so the rider being edited is
 *     visible, with their public code, the whole time.
 *   - It is modal, so there is no second submit button on the page competing
 *     with "Register & Print". While it is open there is exactly one form.
 *   - It costs no page height at all, which is what lets the terminal below it
 *     stay one screen per rider.
 *   - Escape and the overlay both close it, so backing out of a correction is
 *     never an accidental save.
 *
 * A dialog was the alternative and is worse here: this is a six-field form with
 * two visual selectors, which is a wide, tall thing to centre, and a centred
 * modal covers the code the operator is checking against.
 *
 * ## What the copy has to carry
 *
 * Two facts, both from V1 and both preserved because they stop a reprint that
 * is not needed and a re-registration that would be a duplicate:
 *
 *   - the identity does not change
 *   - the sticker does not need reprinting, because it carries no contact
 *     details to be wrong
 *
 * Nothing is submitted. This is a concept.
 */

interface CorrectionSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly publicCode: string
  readonly rider: RiderDraft
  readonly onRiderChange: (patch: Partial<RiderDraft>) => void
  readonly vehicles: readonly string[]
  readonly vehicle: string | null
  readonly onVehicleChange: (vehicle: string) => void
  readonly colours: readonly FlyingFleaColour[]
  readonly colour: FlyingFleaColour
  readonly onColourChange: (colour: FlyingFleaColour) => void
  readonly genders: readonly string[]
  readonly onSave: () => void
}

export function CorrectionSheet({
  open,
  onOpenChange,
  publicCode,
  rider,
  onRiderChange,
  vehicles,
  vehicle,
  onVehicleChange,
  colours,
  colour,
  onColourChange,
  genders,
  onSave,
}: CorrectionSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Correct rider details</SheetTitle>
          <SheetDescription>
            You are editing a rider who is already registered. This does not
            create a second registration.
          </SheetDescription>
          {/*
            The code, in the header, at a size that can be checked against the
            sticker in the operator's hand without closing the sheet.
          */}
          <p className="pt-1 font-mono text-lead text-ink tabular-nums">
            {publicCode}
          </p>
        </SheetHeader>

        <Alert tone="info">
          <InfoIcon aria-hidden="true" />
          <AlertDescription>
            The sticker does not need reprinting. It carries no name, phone,
            email, licence or campaign answer, so the label already in the
            rider's hand stays correct. Identity stays exactly as issued.
          </AlertDescription>
        </Alert>

        <div className="flex flex-col gap-7">
          <StationStep step="01" title="Vehicle">
            <VehiclePlates
              vehicles={vehicles}
              value={vehicle}
              onChange={onVehicleChange}
            />
          </StationStep>

          <StationStep step="02" title="Interested colour">
            <ColourChoice
              colours={colours}
              value={colour}
              onChange={onColourChange}
            />
          </StationStep>

          <StationStep step="03" title="Rider details">
            <RiderDetails
              value={rider}
              onChange={onRiderChange}
              genders={genders}
            />
          </StationStep>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-4">
          <AppButton onClick={onSave}>Save correction</AppButton>
          <AppButton variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </AppButton>
          <p className="w-full font-body text-small text-faint">
            The test-ride time is not re-stamped. Correcting a typo at 16:10
            does not move a ride that happened at 15:42.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
