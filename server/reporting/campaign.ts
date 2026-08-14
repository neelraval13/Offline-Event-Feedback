/*
 * The campaign questionnaire, as reporting sees it.
 *
 * A thin re-export of `shared/campaign/flyingFlea.ts`. The wording used to be
 * written out again here, which meant a report could quote a prompt that no
 * longer matched the one on the tablet, invisibly, because nothing compares
 * them at runtime. There is now exactly one definition and both sides import it.
 *
 * Reporting-specific helpers that are genuinely not part of the questionnaire's
 * meaning stay below.
 */

export {
  FLYING_FLEA_FORM_VERSION,
  FLYING_FLEA_QUESTIONS,
  FLYING_FLEA_RATING_KEYS,
  FLYING_FLEA_TEXT_KEYS,
  RATINGS_1_TO_7 as CAMPAIGN_RATING_VALUES,
  isRating1To7 as isCampaignRating,
  type CampaignQuestion,
  type Rating1To7 as CampaignRatingValue,
} from '../../shared/campaign/flyingFlea'
