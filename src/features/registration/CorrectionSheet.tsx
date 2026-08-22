import { InfoIcon } from 'lucide-react'
import { Alert, AlertDescription } from '../../components/ui/alert'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet'
import { CampaignRegistrationForm } from '../campaign/flying-flea/components/CampaignRegistrationForm'
import { needsLegacyCorrection } from '../campaign/flying-flea/campaignRecord'
import type { CampaignRegistrationDraft } from '../campaign/flying-flea/registrationForm'
import { emptyCampaignDraft } from '../campaign/flying-flea/registrationForm'
import { RegistrationForm } from './RegistrationForm'
import type {
  CampaignFieldCorrections,
  FlyingFleaColour,
  FlyingFleaGender,
  RegistrationRecord,
} from '../../types'
import type { RegistrationFormValues } from './validation'

/*
 * Correcting a rider who is already registered.
 *
 * ## Why a sheet, and not the inline region V1 used
 *
 * V1 toggled the entire three-step registration form open underneath the saved
 * panel, the buttons and the recent list. The result was a page roughly three
 * times as tall as anything else at Point A, carrying a second copy of the form
 * the operator uses to register people, directly below the one they had just
 * used. That is the confusion this screen exists to prevent: a surface where
 * re-entering somebody's details looks like registering somebody.
 *
 * A sheet fixes it structurally rather than with wording:
 *
 *   - The saved panel stays on screen behind it, so the rider being edited is
 *     visible, with their public code, the whole time.
 *   - It is modal, so there is no second submit button on the page competing
 *     with "Register & Print". While it is open there is exactly one form.
 *   - It costs no page height, which is what lets the terminal below it stay
 *     one screen per rider.
 *   - Escape and the overlay both close it, so backing out of a correction is
 *     never an accidental save.
 *
 * ## Two forms, one surface
 *
 * A registration captured before this campaign has no vehicle, no colour and no
 * venue, because nobody was asked. Correcting it through the campaign form would
 * demand all three and default the colour, so an operator fixing a typo in an
 * email address would save a bike, a colour and a venue that rider never chose.
 * Legacy records therefore keep the generic contact-details form, which is now
 * built from the same V2 fields so the two look like one product rather than
 * two eras. `needsLegacyCorrection` is unchanged and still the only thing that
 * decides which is shown.
 *
 * Neither path re-stamps the ride time. See `eventStamp.ts`: a correction is not
 * a new ride, and fixing a misspelt email at 16:10 must not rewrite a ride that
 * happened at 15:42.
 */

/**
 * Re-opens a saved registration for correction.
 *
 * Every campaign answer is carried back into the form, so a correction to one
 * field cannot silently blank the rest: `undefined` on a record means "not
 * captured", and a form that started empty would write that back as an erasure.
 */
export function draftFrom(record: RegistrationRecord): CampaignRegistrationDraft {
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

interface CorrectionSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly record: RegistrationRecord
  readonly onSubmit: (
    values: RegistrationFormValues & CampaignFieldCorrections,
  ) => void
}

export function CorrectionSheet({
  open,
  onOpenChange,
  record,
  onSubmit,
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
            {record.publicCode}
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

        {needsLegacyCorrection(record) ? (
          <RegistrationForm
            onSubmit={onSubmit}
            busy={false}
            /*
             * Keyed on the record's revision, so a saved correction re-seeds
             * the form from what was actually stored rather than leaving the
             * operator looking at what they typed.
             */
            resetKey={-record.revision}
            submitLabel="Save correction"
            initialValues={{
              name: record.name,
              phone: record.phone,
              email: record.email,
            }}
          />
        ) : (
          <CampaignRegistrationForm
            onSubmit={onSubmit}
            busy={false}
            resetKey={-record.revision}
            submitLabel="Save correction"
            initialDraft={draftFrom(record)}
            /* A correction does not re-stamp, so it must not promise to. */
            stamps={false}
          />
        )}

        <p className="font-body text-small text-faint">
          The test-ride time is not re-stamped. Correcting a typo at 16:10 does
          not move a ride that happened at 15:42.
        </p>
      </SheetContent>
    </Sheet>
  )
}
