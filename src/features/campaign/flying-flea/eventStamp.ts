import { eventTestRideAt } from '../../../config/eventTime'
import type { CampaignFieldCorrections } from '../../../types'
import type { RegistrationFormValues } from '../../registration/validation'

/*
 * The one answer the operator no longer gives.
 *
 * Test-ride time was a field on Point A. It is not a question: the ride happens
 * while the rider is standing at the desk, so asking for it was a control of
 * typing per rider and a chance to record something wrong, for a value that was
 * knowable without asking.
 *
 * It is still stored, under the same key, in the same shape. Nothing about the
 * record, the wire, the export or the backup changed. Only the source did.
 *
 * ## Location used to be stamped here, and deliberately is not any more
 *
 * Until the September event this function also wrote the venue, from a single
 * `lockedLocation` compiled into the build. That was correct while the campaign
 * ran at one address: there was exactly one answer, so asking for it was waste.
 *
 * The September event runs in Bengaluru and Hyderabad on the same day, and a
 * function that overwrote `location` on its way to the store would silently
 * discard the city the operator had just chosen and stamp whichever one the
 * build happened to name. So this function no longer touches `location` at all.
 * The value now arrives from the form, which is the only place that knows it.
 *
 * This is why the removal is a deletion rather than a change of the constant it
 * read: leaving the write in place with a different source would have preserved
 * the shape of the bug.
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
 * carry whatever the record already held. A correction may now legitimately
 * change the location, and because this function is not on that path, changing
 * it cannot drag the test-ride time along with it.
 */

/** Applies the submission time to a validated registration. */
export function stampEventFields(
  values: RegistrationFormValues & CampaignFieldCorrections,
  now: Date = new Date(),
): RegistrationFormValues & CampaignFieldCorrections {
  return {
    ...values,
    testRideAt: eventTestRideAt(now),
  }
}
