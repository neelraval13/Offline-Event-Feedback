/*
 * Campaign types, re-exported for the campaign module's own consumers.
 *
 * The definitions live in `src/types/campaign.ts` with the rest of the persisted
 * domain model, because a stored answer outlives the screen that captured it:
 * the central server, an export and a restore all read these shapes without
 * ever importing a component. This module exists so campaign code can say where
 * it thinks its types come from without the domain layer having to depend on a
 * feature folder.
 */
export {
  FLYING_FLEA_FORM_VERSION,
  MAX_CAMPAIGN_TEXT_LENGTH,
  RATINGS_1_TO_7,
  isRating1To7,
  type FlyingFleaColour,
  type FlyingFleaFeedbackV1Answers,
  type FlyingFleaGender,
  type FlyingFleaRegistrationFields,
  type Rating1To7,
} from '../../../types/campaign'
