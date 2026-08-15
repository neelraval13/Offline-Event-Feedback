import { eventTestRideAt } from '../../../config/eventTime'
import type { CampaignFieldCorrections } from '../../../types'
import type { RegistrationFormValues } from '../../registration/validation'
import { FLYING_FLEA_CAMPAIGN } from './config'

/*
 * The two answers the operator no longer gives.
 *
 * Venue and test-ride time were fields on Point A. They are not questions any
 * more: this build is deployed to one venue on one day, and the ride happens
 * when the rider is standing at the desk. Asking for either was two controls of
 * typing per rider and two chances to record something wrong, and the value was
 * knowable without asking.
 *
 * They are still stored, under the same keys, in the same shapes. Nothing about
 * the record, the wire, the export or the backup changed. Only the source did.
 *
 * ## Why this is applied at submit, and only to new registrations
 *
 * Time: a form opened at 14:10 and submitted at 14:13 must record 14:13. So the
 * clock is read here, in the submit path, rather than when the draft is created,
 * when the component mounts, or when "Next rider" clears the desk.
 *
 * Corrections: a correction is not a new ride. If an operator fixes a misspelt
 * email at 16:10, the rider's test ride was still at 15:42, and re-stamping
 * would quietly rewrite a fact about the event to the time somebody noticed a
 * typo. This function is therefore called on the registration path only; the
 * correction path sends the form's own values through untouched, and those
 * carry whatever the record already held.
 */

/** Applies the venue and the submission time to a validated registration. */
export function stampEventFields(
  values: RegistrationFormValues & CampaignFieldCorrections,
  now: Date = new Date(),
): RegistrationFormValues & CampaignFieldCorrections {
  return {
    ...values,
    location: FLYING_FLEA_CAMPAIGN.lockedLocation,
    testRideAt: eventTestRideAt(now),
  }
}
