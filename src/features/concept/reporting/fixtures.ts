/*
 * Static fixtures for the Central Reporting V2 concept.
 *
 * Every number, name, code and address below is invented. Nothing here is read
 * from the central database, from IndexedDB, or from any network call: this
 * module is a plain object graph, and the concept route renders it directly.
 *
 * ## The fixtures are arithmetically consistent
 *
 * A design review is worth very little if the numbers on screen cannot be
 * added up, because the first thing a reader does with a coverage fraction is
 * check it against the counts beside it. So these figures reconcile the way a
 * real run's would:
 *
 *   matched registrations        1,053
 *   + several responses              4   = 1,057 registrations with feedback
 *   + no response                  227   = 1,284 registrations
 *
 *   matched responses            1,053
 *   + in multiple-response groups   15
 *   + direct feedback               37
 *   + code matched no registration   3
 *   + identity conflict              1   = 1,109 responses
 *
 *   analysis base = matched + direct = 1,090
 *     flying-flea-feedback-v1    1,058
 *     feedback-v1                   27
 *     unreadable questionnaire       5   = 1,090
 *
 * The analysis base is `matched` plus `standalone` because that is what
 * `buildOverview` selects: `WHERE r.status IN ('matched', 'standalone')`.
 *
 * ## PII
 *
 * Reporting is the one surface that shows participants' contact details, so a
 * concept for it has to show some. All of it is synthetic: `@example.test` is
 * reserved by RFC 6761 and can never belong to a real person, and the phone
 * numbers are in a fictional block. No value here was copied from a real
 * event.
 */

/* ------------------------------------------------------------------ *
 * Concept state axes
 * ------------------------------------------------------------------ */

/** Where the operator is in the credential flow. */
export type SessionState = 'logged-out' | 'rejected' | 'signed-in'

/**
 * Which reconciliation run the screen is reporting on.
 *
 * `latest-stale` is the latest run with records that arrived after it; it is a
 * warning about currency, not about correctness. `historical` is an older run,
 * which is legitimate evidence rather than an error.
 */
export type RunState = 'latest' | 'latest-stale' | 'historical'

export type Section =
  | 'overview'
  | 'participants'
  | 'responses'
  | 'review'
  | 'duplicates'
  | 'export'

export type DataState = 'healthy' | 'empty' | 'loading' | 'error' | 'mixed'

export const SECTIONS: readonly { readonly key: Section; readonly label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'participants', label: 'Participants' },
  { key: 'responses', label: 'Responses' },
  { key: 'review', label: 'Needs review' },
  { key: 'duplicates', label: 'Duplicates' },
  { key: 'export', label: 'Export' },
]

/* ------------------------------------------------------------------ *
 * The event
 * ------------------------------------------------------------------ */

export const EVENT = {
  id: 'ff-rc-2026-08-23',
  name: 'Flying Flea Test Ride - Richardson & Cruddas',
  day: '23 August 2026',
} as const

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

export interface ConceptRun {
  readonly runId: string
  readonly completedAt: string
  readonly engineVersion: string
  readonly registrations: number
  readonly responses: number
}

/** Newest first, as the run list is presented. */
export const RUNS: readonly ConceptRun[] = [
  {
    runId: 'run_01JQ8F3M2C7B4K',
    completedAt: '23 Aug 2026, 5:26 PM',
    engineVersion: 'reconciliation-v2',
    registrations: 1284,
    responses: 1109,
  },
  {
    runId: 'run_01JQ7Y0T5H9D2M',
    completedAt: '23 Aug 2026, 2:05 PM',
    engineVersion: 'reconciliation-v2',
    registrations: 968,
    responses: 742,
  },
  {
    runId: 'run_01JQ7C4W8N1P6R',
    completedAt: '23 Aug 2026, 11:40 AM',
    engineVersion: 'reconciliation-v2',
    registrations: 431,
    responses: 268,
  },
]

/**
 * The latest run, as a value rather than an index.
 *
 * `RUNS[0]` is `ConceptRun | undefined` under `noUncheckedIndexedAccess`, and
 * defending against an empty fixture list at every call site would be noise
 * about a condition this file controls.
 */
export const LATEST_RUN: ConceptRun = {
  runId: 'run_01JQ8F3M2C7B4K',
  completedAt: '23 Aug 2026, 5:26 PM',
  engineVersion: 'reconciliation-v2',
  registrations: 1284,
  responses: 1109,
}

/* ------------------------------------------------------------------ *
 * Run counts
 * ------------------------------------------------------------------ */

export interface ConceptCounts {
  readonly registrationCount: number
  readonly feedbackCount: number
  readonly matchedRegistrations: number
  readonly registrationsWithoutFeedback: number
  readonly registrationsWithMultipleFeedback: number
  readonly matchedFeedback: number
  readonly feedbackWithoutRegistration: number
  /** Valid direct responses. Never part of a needs-review total. */
  readonly standaloneFeedback: number
  readonly feedbackIdentityConflicts: number
  readonly feedbackInMultipleGroups: number
  readonly duplicateRegistrationCandidateCount: number
}

export const COUNTS: ConceptCounts = {
  registrationCount: 1284,
  feedbackCount: 1109,
  matchedRegistrations: 1053,
  registrationsWithoutFeedback: 227,
  registrationsWithMultipleFeedback: 4,
  matchedFeedback: 1053,
  feedbackWithoutRegistration: 3,
  standaloneFeedback: 37,
  feedbackIdentityConflicts: 1,
  feedbackInMultipleGroups: 15,
  duplicateRegistrationCandidateCount: 6,
}

/** The counts on the older run, so a historical snapshot reads differently. */
export const HISTORICAL_COUNTS: ConceptCounts = {
  registrationCount: 968,
  feedbackCount: 742,
  matchedRegistrations: 701,
  registrationsWithoutFeedback: 264,
  registrationsWithMultipleFeedback: 3,
  matchedFeedback: 701,
  feedbackWithoutRegistration: 5,
  standaloneFeedback: 24,
  feedbackInMultipleGroups: 11,
  feedbackIdentityConflicts: 1,
  duplicateRegistrationCandidateCount: 4,
}

/* ------------------------------------------------------------------ *
 * Coverage
 * ------------------------------------------------------------------ */

/**
 * How many *registered* participants responded.
 *
 * Direct responses move neither half of this fraction: a rider with no
 * registration is not on the registration list, so counting them in the
 * numerator would let coverage exceed 100% at an event where the contact path
 * was popular, and counting them in the denominator would invent registrations.
 * They are carried beside it instead.
 */
export interface ConceptCoverage {
  readonly withFeedback: number
  readonly totalRegistrations: number
  readonly percentage: number
  readonly noResponse: number
  readonly directResponses: number
}

export const COVERAGE: ConceptCoverage = {
  withFeedback: 1057,
  totalRegistrations: 1284,
  percentage: 82.3,
  noResponse: 227,
  directResponses: 37,
}

export const HISTORICAL_COVERAGE: ConceptCoverage = {
  withFeedback: 704,
  totalRegistrations: 968,
  percentage: 72.7,
  noResponse: 264,
  directResponses: 24,
}

/* ------------------------------------------------------------------ *
 * Analysis base
 * ------------------------------------------------------------------ */

/**
 * The responses the run could attribute to exactly one person.
 *
 * Mirrors the server's rule exactly: statuses `matched` and `standalone`. A
 * response in a multiple-response group, an identity conflict, or a sticker
 * code that resolved to nobody cannot be attributed to a rider, so none of them
 * is part of what riders said.
 */
export interface ConceptAnalysisBase {
  readonly total: number
  readonly matched: number
  readonly direct: number
  readonly excluded: readonly { readonly label: string; readonly count: number }[]
}

export const ANALYSIS_BASE: ConceptAnalysisBase = {
  total: 1090,
  matched: 1053,
  direct: 37,
  excluded: [
    { label: 'In a multiple-response group', count: 15 },
    { label: 'Code matched no registration', count: 3 },
    { label: 'Identity conflict', count: 1 },
  ],
}

/* ------------------------------------------------------------------ *
 * Questionnaires
 * ------------------------------------------------------------------ */

export interface ConceptQuestionnaire {
  readonly formVersion: string
  readonly label: string
  readonly scale: string
  readonly responses: number
  readonly readable: boolean
}

/** Counted over the analysis base, which is what the server tallies. */
export const QUESTIONNAIRES: readonly ConceptQuestionnaire[] = [
  {
    formVersion: 'flying-flea-feedback-v1',
    label: 'Flying Flea test ride',
    scale: 'Four questions, 1 to 7',
    responses: 1058,
    readable: true,
  },
  {
    formVersion: 'feedback-v1',
    label: 'Legacy feedback',
    scale: 'Rating 1 to 5, experience, recommend',
    responses: 27,
    readable: true,
  },
  {
    formVersion: 'feedback-v2-draft',
    label: 'Unrecognised questionnaire',
    scale: 'Unknown to this build',
    responses: 5,
    readable: false,
  },
]

export const UNREADABLE_RESPONSES = 5

/* ------------------------------------------------------------------ *
 * Flying Flea ratings
 * ------------------------------------------------------------------ */

export interface ConceptRating {
  readonly key: string
  /** Verbatim campaign wording, as `shared/campaign/flyingFlea.ts` holds it. */
  readonly prompt: string
  readonly average: number
  readonly answered: number
  /** Counts for 1 through 7, in order. */
  readonly distribution: readonly [number, number, number, number, number, number, number]
}

export const RATINGS: readonly ConceptRating[] = [
  {
    key: 'testRideExperience',
    prompt: 'How was your test ride experience of Flying Flea motorcycle?',
    average: 6.12,
    answered: 1058,
    distribution: [4, 7, 18, 46, 148, 371, 464],
  },
  {
    key: 'rotaryKnobUsage',
    prompt: 'How do you rate usage of the rotary knob for changing modes?',
    average: 5.3,
    answered: 1041,
    distribution: [12, 26, 61, 137, 292, 331, 182],
  },
  {
    key: 'rideModesExperience',
    prompt: 'How do you rate the ride experience in different ride modes?',
    average: 5.8,
    answered: 1047,
    distribution: [6, 11, 29, 79, 214, 388, 320],
  },
  {
    key: 'overallExperienceRating',
    prompt: 'How would you rate your overall experience?',
    average: 6.23,
    answered: 1055,
    distribution: [3, 5, 14, 38, 121, 359, 515],
  },
]

export const TEXT_ANSWERS = {
  topThreeFeatures: 612,
  overallExperienceComments: 488,
} as const

/* ------------------------------------------------------------------ *
 * Legacy questionnaire analytics
 * ------------------------------------------------------------------ */

/** Kept entirely apart from the 1-7 figures. The two share no scale. */
export const LEGACY_ANALYTICS = {
  formVersion: 'feedback-v1',
  analysed: 27,
  averageOverallRating: 4.07,
  ratingCounts: [1, 2, 4, 9, 11] as const,
  experienceCounts: [
    { label: 'Excellent', count: 10 },
    { label: 'Good', count: 9 },
    { label: 'Okay', count: 5 },
    { label: 'Poor', count: 2 },
    { label: 'Very poor', count: 1 },
  ],
  recommendYes: 24,
  recommendNo: 3,
  recommendPercentage: 88.9,
} as const

/* ------------------------------------------------------------------ *
 * Needs review
 * ------------------------------------------------------------------ */

export type ReviewCategory =
  | 'without_registration'
  | 'identity_conflict'
  | 'multiple_feedback'
  | 'without_feedback'

export interface ConceptReviewCategory {
  readonly key: ReviewCategory
  readonly label: string
  readonly count: number
  readonly explanation: string
  /** Which browser the category filters. */
  readonly browses: 'responses' | 'participants'
}

/**
 * The four categories the real screen has.
 *
 * Direct feedback is deliberately not among them. A rider who identified
 * themselves by contact details and matched no registration did not go through
 * Point A, which is what that path is for; listing them here would bury the
 * three mistyped codes that genuinely need somebody.
 */
export const REVIEW_CATEGORIES: readonly ConceptReviewCategory[] = [
  {
    key: 'without_registration',
    label: 'Codes that matched no registration',
    count: 3,
    browses: 'responses',
    explanation:
      'The code on the response matches no registration in this event. Usually a mistyped code at Point B, or a Point A device that has not synced yet. The response is kept in full. Direct feedback from riders who never registered is not listed here: nothing went wrong for them, and they appear under Responses.',
  },
  {
    key: 'identity_conflict',
    label: 'Identity conflicts',
    count: 1,
    browses: 'responses',
    explanation:
      'Identifiers that should describe one person do not. For a scanned sticker, the participant ID and the printed code point at different registrations. For contact details, the phone and email pair belongs to more than one registration, so there is no single rider the response could be from.',
  },
  {
    key: 'multiple_feedback',
    label: 'Several responses',
    count: 4,
    browses: 'participants',
    explanation:
      'More than one valid response is attached to one participant. Every response is kept and none is treated as the answer, on this screen or in the exports.',
  },
  {
    key: 'without_feedback',
    label: 'No response',
    count: 227,
    browses: 'participants',
    explanation:
      'The participant registered but no response was matched to them. This is coverage that is incomplete, not data that is wrong: most of these riders simply did not stop at Point B.',
  },
]

/* ------------------------------------------------------------------ *
 * Participants
 * ------------------------------------------------------------------ */

export type ParticipantStatus = 'matched' | 'without_feedback' | 'multiple_feedback'

export interface ConceptParticipant {
  readonly recordId: string
  readonly participantId: string
  readonly publicCode: string
  readonly name: string
  readonly phone: string
  readonly email: string
  readonly status: ParticipantStatus
  readonly responses: number
  readonly potentialDuplicate: boolean
  readonly vehicle: string | null
  readonly interestedColour: string | null
  readonly location: string | null
  readonly gender: string | null
  readonly testRideAt: string | null
  readonly pincode: string | null
  readonly drivingLicence: string | null
  readonly registeredAt: string
  readonly updatedAt: string
  readonly revision: number
  readonly stationId: string
  readonly sourceDeviceId: string
  readonly lastUploaderDeviceId: string
}

/*
 * Deliberately awkward rows among the ordinary ones: a very long name, a very
 * long email, a duplicate flag, a participant with several responses and one
 * with none. A table that only ever renders tidy data has not been reviewed.
 */
export const PARTICIPANTS: readonly ConceptParticipant[] = [
  {
    recordId: '9f2c1a70-4d51-4a8e-9b2f-1c7d3e5a8b40',
    participantId: 'a1b2c3d4-0001-4f00-9a00-000000000001',
    publicCode: 'A1-27CBAF-00104-6',
    name: 'Ananya Raghunathan',
    phone: '90000 10104',
    email: 'ananya.raghunathan@example.test',
    status: 'matched',
    responses: 1,
    potentialDuplicate: false,
    vehicle: 'Vehicle 2',
    interestedColour: 'Flea Green',
    location: 'Richardson & Cruddas',
    gender: 'Female',
    testRideAt: '2026-08-23T11:20',
    pincode: '400001',
    drivingLicence: 'MH0120260001042',
    registeredAt: '23 Aug 2026, 11:18 AM',
    updatedAt: '23 Aug 2026, 11:18 AM',
    revision: 1,
    stationId: 'A1',
    sourceDeviceId: '73f2a3c3-a70c-402b-a894-22400f5efe35',
    lastUploaderDeviceId: '73f2a3c3-a70c-402b-a894-22400f5efe35',
  },
  {
    recordId: '2b7e5d10-8c93-4f21-a6d4-9e0f1a2b3c44',
    participantId: 'a1b2c3d4-0002-4f00-9a00-000000000002',
    publicCode: 'A1-27CBAF-00105-2',
    name: 'Krishnamurthy Venkataraghavan',
    phone: '90000 10105',
    email: 'k.venkataraghavan.testride@example.test',
    status: 'multiple_feedback',
    responses: 3,
    potentialDuplicate: false,
    vehicle: 'Vehicle 1',
    interestedColour: 'Storm Black',
    location: 'Richardson & Cruddas',
    gender: 'Male',
    testRideAt: '2026-08-23T11:35',
    pincode: '400012',
    drivingLicence: 'MH0120260001051',
    registeredAt: '23 Aug 2026, 11:31 AM',
    updatedAt: '23 Aug 2026, 3:02 PM',
    revision: 2,
    stationId: 'A1',
    sourceDeviceId: '73f2a3c3-a70c-402b-a894-22400f5efe35',
    lastUploaderDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
  },
  {
    recordId: '6d4a9c22-3e77-4b18-8f05-2a1b3c4d5e66',
    participantId: 'a1b2c3d4-0003-4f00-9a00-000000000003',
    publicCode: 'A1-27CBAF-00106-9',
    name: 'Devika Nair',
    phone: '90000 10106',
    email: 'devika.nair@example.test',
    status: 'without_feedback',
    responses: 0,
    potentialDuplicate: true,
    vehicle: 'Vehicle 3',
    interestedColour: 'Flea Green',
    location: 'Richardson & Cruddas',
    gender: 'Female',
    testRideAt: '2026-08-23T12:05',
    pincode: '400020',
    drivingLicence: null,
    registeredAt: '23 Aug 2026, 12:01 PM',
    updatedAt: '23 Aug 2026, 12:01 PM',
    revision: 1,
    stationId: 'A1',
    sourceDeviceId: '73f2a3c3-a70c-402b-a894-22400f5efe35',
    lastUploaderDeviceId: '73f2a3c3-a70c-402b-a894-22400f5efe35',
  },
  {
    recordId: '8e1f2a33-9b44-4c55-a666-7d8e9f0a1b22',
    participantId: 'a1b2c3d4-0004-4f00-9a00-000000000004',
    publicCode: 'A1-27CBAF-00107-4',
    name: 'Rohan Mehta',
    phone: '90000 10107',
    email: 'rohan.mehta@example.test',
    status: 'matched',
    responses: 1,
    potentialDuplicate: false,
    vehicle: 'Vehicle 4',
    interestedColour: 'Storm Black',
    location: 'Richardson & Cruddas',
    gender: 'Male',
    testRideAt: '2026-08-23T12:40',
    pincode: '400034',
    drivingLicence: 'MH0120260001074',
    registeredAt: '23 Aug 2026, 12:36 PM',
    updatedAt: '23 Aug 2026, 12:36 PM',
    revision: 1,
    stationId: 'A1',
    sourceDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    lastUploaderDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
  },
  {
    recordId: '1c3d5e77-2a88-4b99-8c00-1d2e3f405162',
    participantId: 'a1b2c3d4-0005-4f00-9a00-000000000005',
    publicCode: 'A1-27CBAF-00108-1',
    name: 'Priya Balasubramanian',
    phone: '90000 10108',
    email: 'priya.b@example.test',
    status: 'matched',
    responses: 1,
    potentialDuplicate: true,
    vehicle: 'Vehicle 2',
    interestedColour: 'Flea Green',
    location: 'Richardson & Cruddas',
    gender: 'Female',
    testRideAt: '2026-08-23T1:15',
    pincode: '400008',
    drivingLicence: 'MH0120260001081',
    registeredAt: '23 Aug 2026, 1:09 PM',
    updatedAt: '23 Aug 2026, 1:09 PM',
    revision: 1,
    stationId: 'A1',
    sourceDeviceId: '73f2a3c3-a70c-402b-a894-22400f5efe35',
    lastUploaderDeviceId: '73f2a3c3-a70c-402b-a894-22400f5efe35',
  },
  {
    recordId: '4f6a8b99-5c00-4d11-9e22-3f405162738a',
    participantId: 'a1b2c3d4-0006-4f00-9a00-000000000006',
    publicCode: 'A1-27CBAF-00109-8',
    name: 'Imtiaz Ali',
    phone: '90000 10109',
    email: 'imtiaz.ali@example.test',
    status: 'without_feedback',
    responses: 0,
    potentialDuplicate: false,
    vehicle: 'Vehicle 1',
    interestedColour: 'Storm Black',
    location: 'Richardson & Cruddas',
    gender: 'Male',
    testRideAt: null,
    pincode: '400019',
    drivingLicence: null,
    registeredAt: '23 Aug 2026, 1:44 PM',
    updatedAt: '23 Aug 2026, 1:44 PM',
    revision: 1,
    stationId: 'A1',
    sourceDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    lastUploaderDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
  },
  {
    recordId: '7a9c0d11-6e22-4f33-8a44-5b6c7d8e9f00',
    participantId: 'a1b2c3d4-0007-4f00-9a00-000000000007',
    publicCode: 'A1-27CBAF-00110-3',
    name: 'Sneha Iyer',
    phone: '90000 10110',
    email: 'sneha.iyer@example.test',
    status: 'matched',
    responses: 1,
    potentialDuplicate: false,
    vehicle: 'Vehicle 3',
    interestedColour: 'Flea Green',
    location: 'Richardson & Cruddas',
    gender: 'Female',
    testRideAt: '2026-08-23T14:10',
    pincode: '400026',
    drivingLicence: 'MH0120260001103',
    registeredAt: '23 Aug 2026, 2:06 PM',
    updatedAt: '23 Aug 2026, 2:06 PM',
    revision: 1,
    stationId: 'A1',
    sourceDeviceId: '73f2a3c3-a70c-402b-a894-22400f5efe35',
    lastUploaderDeviceId: '73f2a3c3-a70c-402b-a894-22400f5efe35',
  },
  {
    recordId: '0b2d4f66-7a88-4b00-9c11-2d3e4f506172',
    participantId: 'a1b2c3d4-0008-4f00-9a00-000000000008',
    publicCode: 'A1-27CBAF-00111-7',
    name: 'Vikram Chandrasekaran',
    phone: '90000 10111',
    email: 'vikram.c@example.test',
    status: 'matched',
    responses: 1,
    potentialDuplicate: false,
    vehicle: 'Vehicle 4',
    interestedColour: 'Storm Black',
    location: 'Richardson & Cruddas',
    gender: 'Male',
    testRideAt: '2026-08-23T14:45',
    pincode: '400050',
    drivingLicence: 'MH0120260001117',
    registeredAt: '23 Aug 2026, 2:41 PM',
    updatedAt: '23 Aug 2026, 2:41 PM',
    revision: 1,
    stationId: 'A1',
    sourceDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    lastUploaderDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
  },
]

/* ------------------------------------------------------------------ *
 * Responses
 * ------------------------------------------------------------------ */

export type ResponseStatus =
  | 'matched'
  | 'without_registration'
  | 'standalone'
  | 'identity_conflict'
  | 'multiple_feedback'

export type CaptureMethod = 'qr' | 'manual' | 'contact'

export interface ConceptResponse {
  readonly recordId: string
  /** Null on a contact capture: that response never had a sticker. */
  readonly publicCode: string | null
  readonly participantId: string | null
  readonly captureMethod: CaptureMethod
  readonly formVersion: string
  readonly status: ResponseStatus
  readonly matchMethod: 'qr_identity' | 'manual_public_code' | 'contact_identity' | null
  readonly participantName: string | null
  readonly respondentName: string | null
  readonly respondentPhone: string | null
  readonly respondentEmail: string | null
  readonly linkedCode: string | null
  /** Rendered per questionnaire; the two this build reads share no scale. */
  readonly rating: string
  readonly answeredAt: string
  readonly updatedAt: string
  readonly revision: number
  readonly stationId: string
  readonly sourceDeviceId: string
  readonly lastUploaderDeviceId: string
  readonly answers: readonly { readonly prompt: string; readonly value: string }[]
  /** Only present on an identity conflict. */
  readonly diagnostics: {
    readonly participantIdResolvesTo: string | null
    readonly publicCodeResolvesTo: string | null
  } | null
}

const FLYING_FLEA_ANSWERS = (
  testRide: number,
  knob: number,
  modes: number,
  overall: number,
  features: string,
  comments: string,
): readonly { readonly prompt: string; readonly value: string }[] => [
  { prompt: 'How was your test ride experience of Flying Flea motorcycle?', value: `${testRide} / 7` },
  { prompt: 'How do you rate usage of the rotary knob for changing modes?', value: `${knob} / 7` },
  { prompt: 'How do you rate the ride experience in different ride modes?', value: `${modes} / 7` },
  { prompt: 'How would you rate your overall experience?', value: `${overall} / 7` },
  { prompt: 'Which top 3 features did you like in the motorcycle?', value: features },
  { prompt: 'How was your overall experience of the Flying Flea motorcycle?', value: comments },
]

export const RESPONSES: readonly ConceptResponse[] = [
  {
    recordId: 'f10c2a30-1b41-4c52-8d63-9e74a85b96c0',
    publicCode: 'A1-27CBAF-00104-6',
    participantId: 'a1b2c3d4-0001-4f00-9a00-000000000001',
    captureMethod: 'qr',
    formVersion: 'flying-flea-feedback-v1',
    status: 'matched',
    matchMethod: 'qr_identity',
    participantName: 'Ananya Raghunathan',
    respondentName: null,
    respondentPhone: null,
    respondentEmail: null,
    linkedCode: 'A1-27CBAF-00104-6',
    rating: '7 / 7',
    answeredAt: '23 Aug 2026, 11:52 AM',
    updatedAt: '23 Aug 2026, 11:52 AM',
    revision: 1,
    stationId: 'B1',
    sourceDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    lastUploaderDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    answers: FLYING_FLEA_ANSWERS(
      7,
      6,
      7,
      7,
      'The low seat height, the throttle response and how light it feels at walking pace.',
      'Genuinely surprised by the torque. I would ride this to work every day.',
    ),
    diagnostics: null,
  },
  {
    recordId: 'a21d3b41-2c52-4d63-9e74-af85b96c07d1',
    publicCode: null,
    participantId: null,
    captureMethod: 'contact',
    formVersion: 'flying-flea-feedback-v1',
    status: 'standalone',
    matchMethod: null,
    participantName: null,
    respondentName: 'Meera Subramanian',
    respondentPhone: '90000 20031',
    respondentEmail: 'meera.subramanian@example.test',
    linkedCode: null,
    rating: '6 / 7',
    answeredAt: '23 Aug 2026, 12:14 PM',
    updatedAt: '23 Aug 2026, 12:14 PM',
    revision: 1,
    stationId: 'B1',
    sourceDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    lastUploaderDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    answers: FLYING_FLEA_ANSWERS(
      6,
      5,
      6,
      6,
      'Looks, the seat, the sound it does not make.',
      'Walked past the stand and asked for a go. Glad I did.',
    ),
    diagnostics: null,
  },
  {
    recordId: 'b32e4c52-3d63-4e74-af85-b96c07d18e21',
    publicCode: 'A1-27CBAF-00105-2',
    participantId: 'a1b2c3d4-0002-4f00-9a00-000000000002',
    captureMethod: 'qr',
    formVersion: 'flying-flea-feedback-v1',
    status: 'multiple_feedback',
    matchMethod: 'qr_identity',
    participantName: 'Krishnamurthy Venkataraghavan',
    respondentName: null,
    respondentPhone: null,
    respondentEmail: null,
    linkedCode: 'A1-27CBAF-00105-2',
    rating: '5 / 7',
    answeredAt: '23 Aug 2026, 12:31 PM',
    updatedAt: '23 Aug 2026, 12:31 PM',
    revision: 1,
    stationId: 'B1',
    sourceDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    lastUploaderDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    answers: FLYING_FLEA_ANSWERS(5, 4, 5, 5, 'Handling.', 'Good fun on the short loop.'),
    diagnostics: null,
  },
  {
    /*
     * The second and third of Krishnamurthy's three responses. All of them are
     * listed wherever his record appears, and none is treated as the answer:
     * choosing between them is a decision about what the event's record says.
     */
    recordId: 'b32e4c52-3d63-4e74-af85-b96c07d18e22',
    publicCode: 'A1-27CBAF-00105-2',
    participantId: 'a1b2c3d4-0002-4f00-9a00-000000000002',
    captureMethod: 'manual',
    formVersion: 'flying-flea-feedback-v1',
    status: 'multiple_feedback',
    matchMethod: 'manual_public_code',
    participantName: 'Krishnamurthy Venkataraghavan',
    respondentName: null,
    respondentPhone: null,
    respondentEmail: null,
    linkedCode: 'A1-27CBAF-00105-2',
    rating: '7 / 7',
    answeredAt: '23 Aug 2026, 2:48 PM',
    updatedAt: '23 Aug 2026, 2:48 PM',
    revision: 1,
    stationId: 'B1',
    sourceDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    lastUploaderDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    answers: FLYING_FLEA_ANSWERS(
      7,
      6,
      7,
      7,
      'Second go on the longer loop. The brakes.',
      'Better than the first ride, once I knew the modes.',
    ),
    diagnostics: null,
  },
  {
    recordId: 'b32e4c52-3d63-4e74-af85-b96c07d18e23',
    publicCode: 'A1-27CBAF-00105-2',
    participantId: 'a1b2c3d4-0002-4f00-9a00-000000000002',
    captureMethod: 'qr',
    formVersion: 'flying-flea-feedback-v1',
    status: 'multiple_feedback',
    matchMethod: 'qr_identity',
    participantName: 'Krishnamurthy Venkataraghavan',
    respondentName: null,
    respondentPhone: null,
    respondentEmail: null,
    linkedCode: 'A1-27CBAF-00105-2',
    rating: '3 / 7',
    answeredAt: '23 Aug 2026, 3:02 PM',
    updatedAt: '23 Aug 2026, 3:02 PM',
    revision: 1,
    stationId: 'B1',
    sourceDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    lastUploaderDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    answers: FLYING_FLEA_ANSWERS(
      3,
      2,
      3,
      3,
      'Nothing in particular.',
      'Queued too long the second time.',
    ),
    diagnostics: null,
  },
  {
    recordId: 'c43f5d63-4e74-4f85-b96c-07d18e21af32',
    publicCode: 'A1-27CBAF-00190-5',
    participantId: null,
    captureMethod: 'manual',
    formVersion: 'flying-flea-feedback-v1',
    status: 'without_registration',
    matchMethod: null,
    participantName: null,
    respondentName: null,
    respondentPhone: null,
    respondentEmail: null,
    linkedCode: null,
    rating: '6 / 7',
    answeredAt: '23 Aug 2026, 1:02 PM',
    updatedAt: '23 Aug 2026, 1:02 PM',
    revision: 1,
    stationId: 'B1',
    sourceDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    lastUploaderDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    answers: FLYING_FLEA_ANSWERS(
      6,
      6,
      6,
      6,
      'Brakes, weight, the way it turns in.',
      'Would buy one in green.',
    ),
    diagnostics: null,
  },
  {
    recordId: 'd54a6e74-5f85-4a96-8c07-d18e21af3243',
    publicCode: null,
    participantId: null,
    captureMethod: 'contact',
    formVersion: 'flying-flea-feedback-v1',
    status: 'identity_conflict',
    matchMethod: null,
    participantName: null,
    respondentName: 'Arjun Pillai',
    respondentPhone: '90000 10120',
    respondentEmail: 'arjun.pillai@example.test',
    linkedCode: null,
    rating: '4 / 7',
    answeredAt: '23 Aug 2026, 2:22 PM',
    updatedAt: '23 Aug 2026, 2:22 PM',
    revision: 1,
    stationId: 'B1',
    sourceDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    lastUploaderDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    answers: FLYING_FLEA_ANSWERS(4, 4, 4, 4, 'Colour.', 'Fine.'),
    diagnostics: {
      participantIdResolvesTo: 'Arjun Pillai (A1-27CBAF-00120-1)',
      publicCodeResolvesTo: 'Arjun R Pillai (A1-27CBAF-00131-9)',
    },
  },
  {
    recordId: 'e65b7f85-6a96-4b07-9d18-e21af3243554',
    publicCode: 'A1-27CBAF-00107-4',
    participantId: 'a1b2c3d4-0004-4f00-9a00-000000000004',
    captureMethod: 'manual',
    formVersion: 'flying-flea-feedback-v1',
    status: 'matched',
    matchMethod: 'manual_public_code',
    participantName: 'Rohan Mehta',
    respondentName: null,
    respondentPhone: null,
    respondentEmail: null,
    linkedCode: 'A1-27CBAF-00107-4',
    rating: '7 / 7',
    answeredAt: '23 Aug 2026, 2:58 PM',
    updatedAt: '23 Aug 2026, 2:58 PM',
    revision: 1,
    stationId: 'B1',
    sourceDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    lastUploaderDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    answers: FLYING_FLEA_ANSWERS(
      7,
      7,
      7,
      7,
      'Everything. Mostly the noise it does not make.',
      'Best thing at the show.',
    ),
    diagnostics: null,
  },
  {
    recordId: 'f76c8a96-7b07-4c18-8e21-af3243554665',
    publicCode: null,
    participantId: null,
    captureMethod: 'contact',
    formVersion: 'flying-flea-feedback-v1',
    status: 'standalone',
    matchMethod: null,
    participantName: null,
    respondentName: 'Lakshmi Narayanaswamy',
    respondentPhone: '90000 20044',
    respondentEmail: 'lakshmi.narayanaswamy.testride@example.test',
    linkedCode: null,
    rating: '5 / 7',
    answeredAt: '23 Aug 2026, 3:19 PM',
    updatedAt: '23 Aug 2026, 3:19 PM',
    revision: 1,
    stationId: 'B1',
    sourceDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    lastUploaderDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    answers: FLYING_FLEA_ANSWERS(
      5,
      5,
      5,
      5,
      'The size. It fits me, which most bikes do not.',
      'Comfortable. I did not expect that.',
    ),
    diagnostics: null,
  },
  {
    recordId: '087d9ba6-8c18-4d21-af32-435546657768',
    publicCode: 'A1-27CBAF-00088-2',
    participantId: 'a1b2c3d4-0088-4f00-9a00-000000000088',
    captureMethod: 'qr',
    formVersion: 'feedback-v1',
    status: 'matched',
    matchMethod: 'qr_identity',
    participantName: 'Farhan Qureshi',
    respondentName: null,
    respondentPhone: null,
    respondentEmail: null,
    linkedCode: 'A1-27CBAF-00088-2',
    rating: '4',
    answeredAt: '23 Aug 2026, 10:41 AM',
    updatedAt: '23 Aug 2026, 10:41 AM',
    revision: 1,
    stationId: 'B1',
    sourceDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    lastUploaderDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    answers: [
      { prompt: 'overall rating', value: '4' },
      { prompt: 'experience', value: 'good' },
      { prompt: 'recommend', value: 'Yes' },
    ],
    diagnostics: null,
  },
  {
    recordId: '198eacb7-9d21-4e32-8435-546657768879',
    publicCode: 'A1-27CBAF-00091-8',
    participantId: 'a1b2c3d4-0091-4f00-9a00-000000000091',
    captureMethod: 'qr',
    formVersion: 'feedback-v2-draft',
    status: 'matched',
    matchMethod: 'qr_identity',
    participantName: 'Nandita Bose',
    respondentName: null,
    respondentPhone: null,
    respondentEmail: null,
    linkedCode: 'A1-27CBAF-00091-8',
    rating: 'Not available',
    answeredAt: '23 Aug 2026, 10:58 AM',
    updatedAt: '23 Aug 2026, 10:58 AM',
    revision: 1,
    stationId: 'B1',
    sourceDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    lastUploaderDeviceId: '5c8d9e10-1f22-4a33-b444-556677889900',
    answers: [
      { prompt: 'satisfaction', value: '8' },
      { prompt: 'nps', value: '9' },
      { prompt: 'notes', value: 'Captured under a questionnaire this build does not know.' },
    ],
    diagnostics: null,
  },
]

/* ------------------------------------------------------------------ *
 * Duplicate candidates
 * ------------------------------------------------------------------ */

export interface ConceptDuplicateSide {
  readonly recordId: string
  readonly publicCode: string
  readonly name: string
  readonly phone: string
  readonly email: string
}

export interface ConceptDuplicate {
  /** Never a name: two people at one event share a phone often enough. */
  readonly matchBasis: 'phone_and_email' | 'phone_only' | 'email_only'
  readonly left: ConceptDuplicateSide
  readonly right: ConceptDuplicateSide
}

export const DUPLICATES: readonly ConceptDuplicate[] = [
  {
    matchBasis: 'phone_and_email',
    left: {
      recordId: '6d4a9c22-3e77-4b18-8f05-2a1b3c4d5e66',
      publicCode: 'A1-27CBAF-00106-9',
      name: 'Devika Nair',
      phone: '90000 10106',
      email: 'devika.nair@example.test',
    },
    right: {
      recordId: 'aa11bb22-cc33-4d44-9e55-6f7788990011',
      publicCode: 'A1-27CBAF-00142-3',
      name: 'Devika S Nair',
      phone: '90000 10106',
      email: 'devika.nair@example.test',
    },
  },
  {
    matchBasis: 'phone_only',
    left: {
      recordId: '1c3d5e77-2a88-4b99-8c00-1d2e3f405162',
      publicCode: 'A1-27CBAF-00108-1',
      name: 'Priya Balasubramanian',
      phone: '90000 10108',
      email: 'priya.b@example.test',
    },
    right: {
      recordId: 'bb22cc33-dd44-4e55-8f66-778899001122',
      publicCode: 'A1-27CBAF-00155-7',
      name: 'Ganesh Balasubramanian',
      phone: '90000 10108',
      email: 'ganesh.b@example.test',
    },
  },
  {
    matchBasis: 'email_only',
    left: {
      recordId: 'cc33dd44-ee55-4f66-9a77-889900112233',
      publicCode: 'A1-27CBAF-00120-1',
      name: 'Arjun Pillai',
      phone: '90000 10120',
      email: 'arjun.pillai@example.test',
    },
    right: {
      recordId: 'dd44ee55-ff66-4a77-8b88-990011223344',
      publicCode: 'A1-27CBAF-00131-9',
      name: 'Arjun R Pillai',
      phone: '90000 10131',
      email: 'arjun.pillai@example.test',
    },
  },
]

/* ------------------------------------------------------------------ *
 * Staleness
 * ------------------------------------------------------------------ */

export const STALE = {
  registrationsAdded: 12,
  responsesAdded: 9,
  latestContentChangeAt: '23 Aug 2026, 6:04 PM',
  currentRegistrations: 1296,
  currentResponses: 1118,
} as const

/* ------------------------------------------------------------------ *
 * Exports
 * ------------------------------------------------------------------ */

export interface ConceptExport {
  readonly kind: string
  readonly label: string
  readonly description: string
}

/**
 * The workbook's sheets, read from `server/reporting/exportXlsx.ts`.
 *
 * Six, not five: `Participant Feedback` sits second and is the sheet most
 * readers actually want. The production panel's description omits it, which is
 * the kind of drift that happens when copy is written once and the code moves.
 */
export const WORKBOOK_SHEETS: readonly { readonly name: string; readonly purpose: string }[] = [
  { name: 'Summary', purpose: 'Run identity, every count, and the coverage figures with their rules spelled out.' },
  { name: 'Participant Feedback', purpose: 'One readable row per rider and what they said, including riders with no registration. A view over the audit sheets, never a source of truth.' },
  { name: 'Registrations', purpose: 'One row per registration exactly as the run classified it.' },
  { name: 'Feedback', purpose: 'One row per response, including responses that matched no registration.' },
  { name: 'Duplicate Candidates', purpose: 'Registration pairs sharing a normalised phone number or email.' },
  { name: 'Metadata', purpose: 'Which run produced the file and which rule produced each figure.' },
]

export const CSV_EXPORTS: readonly ConceptExport[] = [
  {
    kind: 'registrations.csv',
    label: 'Participants (CSV)',
    description:
      'One row per registration with its reconciliation status. Answer columns are filled only where exactly one response was matched; a participant with several responses has them blank.',
  },
  {
    kind: 'feedback.csv',
    label: 'Responses (CSV)',
    description:
      'One row per response, including responses that matched no registration. Both halves of an ambiguous pair appear.',
  },
  {
    kind: 'duplicate-candidates.csv',
    label: 'Possible duplicates (CSV)',
    description: 'Registration pairs sharing a normalised phone number or email. Never truncated.',
  },
]
