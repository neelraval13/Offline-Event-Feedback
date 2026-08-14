import type { RegistrationRecord } from '../../../types'

/*
 * Is this registration a campaign registration?
 *
 * One predicate, in one place, because the answer decides which correction
 * screen an operator gets, and a presence check scattered across a screen is a
 * presence check that will eventually disagree with itself.
 *
 * The question is not "does this record have a vehicle?" but "was this record
 * captured by the campaign form?". They are the same thing today, and writing it
 * as a named predicate is what keeps them the same thing tomorrow.
 */

/**
 * The fields the campaign form always writes.
 *
 * Vehicle, colour and location are required by the campaign (colour cannot even
 * be left unanswered: the control always holds one). So a record captured by
 * that form has all three, and a record captured before the campaign has none of
 * them. The optional fields (gender, licence, pincode, test-ride time) say
 * nothing either way, which is why they are not consulted.
 */
const CAMPAIGN_MARKERS = ['vehicle', 'interestedColour', 'location'] as const

export function isCampaignRegistration(record: RegistrationRecord): boolean {
  return CAMPAIGN_MARKERS.some((field) => record[field] !== undefined)
}

/**
 * The inverse, named for what it is used for.
 *
 * A pre-campaign record must be corrected through the generic contact-details
 * form. Opening the campaign form on one would present a rider who was never
 * asked about a vehicle with a required vehicle field, and saving would write a
 * bike, a colour and a venue that nobody ever chose: fabricated data, produced
 * by someone fixing a typo in an email address.
 */
export function needsLegacyCorrection(record: RegistrationRecord): boolean {
  return !isCampaignRegistration(record)
}
