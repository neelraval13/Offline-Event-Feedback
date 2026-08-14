import {
  FLYING_FLEA_COLOURS,
  FLYING_FLEA_FORM_VERSION,
  FLYING_FLEA_GENDERS,
  FLYING_FLEA_RATING_QUESTIONS,
  FLYING_FLEA_TEXT_QUESTIONS,
  RATINGS_1_TO_7,
  type CampaignQuestion,
  type FlyingFleaColour,
  type FlyingFleaGender,
  type Rating1To7,
} from '../../../../shared/campaign/flyingFlea'

export type { CampaignQuestion }

/*
 * The Flying Flea campaign, in one place.
 *
 * Every vehicle name, colour, venue and question in this application comes from
 * here. Scattering them would mean a campaign that adds a fifth bike has to be
 * found in four components, and the one that gets missed is the one staff use.
 *
 * The questionnaire itself is NOT here. Its version, answer keys, wording and
 * scale live in `shared/campaign/flyingFlea.ts`, which the server reads too:
 * two copies of a question is one question that will eventually disagree with
 * itself, and the disagreement is invisible until a report quotes a prompt no
 * rider ever saw.
 *
 * What is here is deployment and presentation: which bikes are at this venue,
 * which venues exist, what the hero says. All of it can change without changing
 * the meaning of a single stored answer.
 *
 * No persistence, validation or business logic lives here. This module is data.
 */

export interface FlyingFleaCampaign {
  readonly id: string
  readonly name: string
  readonly formVersion: typeof FLYING_FLEA_FORM_VERSION
  readonly hero: {
    readonly eyebrow: string
    readonly title: string
    readonly subtitle: string
  }
  readonly vehicles: readonly string[]
  readonly colours: readonly FlyingFleaColour[]
  readonly genders: readonly FlyingFleaGender[]
  readonly locations: readonly string[]
  /** The venue this build is deployed to, when a deployment is venue-locked. */
  readonly lockedLocation: string | null
  readonly ratingScale: readonly Rating1To7[]
  readonly ratingQuestions: readonly CampaignQuestion[]
  readonly textQuestions: readonly CampaignQuestion[]
  readonly thanks: string
}

export const FLYING_FLEA_CAMPAIGN: FlyingFleaCampaign = {
  id: 'flying-flea-test-ride',
  name: 'Flying Flea Test Rides',
  formVersion: FLYING_FLEA_FORM_VERSION,

  hero: {
    eyebrow: 'Flying Flea · Test Rides',
    title: 'Test Ride Feedback Form',
    subtitle:
      'Help us improve by providing feedback on your recent experience',
  },

  /*
   * The supplied deployment reads these from a Google Sheet's Settings tab so
   * the campaign team can edit them without a code change. This application has
   * no Sheet and no network at the desk, so they are compiled in: the same
   * defaults the supplied page falls back to when its injection has not run.
   */
  vehicles: ['Vehicle 1', 'Vehicle 2', 'Vehicle 3', 'Vehicle 4'],
  colours: FLYING_FLEA_COLOURS,
  genders: FLYING_FLEA_GENDERS,
  locations: ['Prestige Shantiniketan', 'Prestige Tech Park'],
  lockedLocation: null,

  ratingScale: RATINGS_1_TO_7,

  // Straight from the shared definition: the screens render exactly the
  // questions the exports and the reporting analytics quote.
  ratingQuestions: FLYING_FLEA_RATING_QUESTIONS,
  textQuestions: FLYING_FLEA_TEXT_QUESTIONS,

  thanks: 'Thank you for riding the Flying Flea',
}

/**
 * Which registration fields the campaign insists on.
 *
 * Taken from the supplied form's own submit-time validation: vehicle, name,
 * email, location and phone are refused when blank; gender, test-ride time,
 * licence and pincode are not. Nothing is added to that list: an event desk
 * with a queue is the worst possible place to discover a newly mandatory field.
 *
 * Colour is absent because it cannot be unanswered: the supplied control is a
 * toggle that always holds one of the two colours.
 */
export const REQUIRED_CAMPAIGN_FIELDS = [
  'vehicle',
  'name',
  'email',
  'location',
  'phone',
] as const

/** Colour swatches, for the selector. Presentation, not stored data. */
export const COLOUR_SWATCHES: Readonly<Record<FlyingFleaColour, string>> = {
  'Flea Green': '#2e6e57',
  'Storm Black': '#0c0d10',
}

export { promptForAnswerKey } from '../../../../shared/campaign/flyingFlea'
