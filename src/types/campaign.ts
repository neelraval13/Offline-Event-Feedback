/*
 * The Flying Flea campaign's data model.
 *
 * These are persisted values, not UI state. Everything here is what a reader of
 * a record — the central server, an export, a build of this app three months
 * from now — needs in order to know what was captured, without consulting the
 * screen that captured it.
 *
 * Wording lives in `config.ts`; meaning lives here. That separation is what
 * lets the campaign rephrase a question without changing what any stored answer
 * means.
 */

/*
 * The questionnaire's own semantics live in `shared/campaign/flyingFlea.ts`,
 * where the server reads them too. Re-exported here so client code has one
 * import for "the campaign's data model" without the domain layer owning a
 * second copy of anything.
 */
import type {
  FlyingFleaColour,
  FlyingFleaGender,
} from '../../shared/campaign/flyingFlea'

export {
  FLYING_FLEA_COLOURS,
  FLYING_FLEA_FORM_VERSION,
  FLYING_FLEA_GENDERS,
  FLYING_FLEA_QUESTIONS,
  FLYING_FLEA_RATING_KEYS,
  FLYING_FLEA_TEXT_KEYS,
  MAX_CAMPAIGN_TEXT_LENGTH,
  MAX_LICENCE_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_VEHICLE_LENGTH,
  RATINGS_1_TO_7,
  isCampaignPincode,
  isFlyingFleaColour,
  isFlyingFleaGender,
  isLocalDateTime,
  isRating1To7,
  type FlyingFleaColour,
  type FlyingFleaFeedbackV1Answers,
  type FlyingFleaGender,
  type Rating1To7,
} from '../../shared/campaign/flyingFlea'

/**
 * Campaign fields captured alongside a registration.
 *
 * Every one is optional at the persistence boundary, and deliberately so: the
 * device holds registrations captured before this campaign existed, and a
 * reader that demanded these fields would reject its own history. The campaign
 * UI enforces its own required-ness on top (see `config.ts`), which is a rule
 * about today's event rather than a rule about the shape of a record.
 */
export interface FlyingFleaRegistrationFields {
  /** Test-ride vehicle, e.g. `Vehicle 1`. From the campaign's vehicle list. */
  readonly vehicle?: string
  /** Single choice in the supplied form; the toggle cannot express two. */
  readonly interestedColour?: FlyingFleaColour
  /** Venue, from the campaign's location list. */
  readonly location?: string
  readonly gender?: FlyingFleaGender
  /**
   * When the rider is scheduled to ride, as the local `YYYY-MM-DDTHH:mm` the
   * supplied `datetime-local` control produces. Deliberately not converted to
   * UTC: it is a wall-clock slot at a venue, and shifting it by a timezone
   * would move a 10:00 booking to 04:30 in an export read by the venue team.
   */
  readonly testRideAt?: string
  /** Licence number as written on the document. Sensitive; see reporting. */
  readonly drivingLicence?: string
  readonly pincode?: string
}


/**
 * A campaign field as a *correction* expresses it.
 *
 * Three states, and the middle one is the whole point:
 *
 *   absent  — not part of this correction; leave whatever is stored
 *   null    — the operator cleared it; the record must stop carrying a value
 *   value   — set it to this
 *
 * Without the null, "unchanged" and "deleted" are the same input, and a rider
 * who asked for their pincode to be removed keeps it: the form sends nothing,
 * the patch skips the field, and the old value survives a correction that
 * appeared to succeed. `undefined` cannot mean both.
 *
 * Cleared fields are removed from the record rather than stored as empty
 * strings — an empty string is a value someone typed, and this is the absence
 * of one.
 */
export type CampaignFieldCorrections = {
  readonly [Field in keyof FlyingFleaRegistrationFields]?:
    | FlyingFleaRegistrationFields[Field]
    | null
}
