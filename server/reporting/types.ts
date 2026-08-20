/*
 * Reporting DTOs.
 *
 * Shared in spirit with the client, which keeps its own mirrored types in
 * `src/lib/reporting/types.ts`. These are not part of the sync wire contract;
 * that one is versioned because devices in the field may lag a deployment.
 * Reporting is a browser talking to the server it was served from, so the two
 * always move together.
 */

export type RegistrationReconciliationStatus =
  | 'matched'
  | 'without_feedback'
  | 'multiple_feedback'

export type FeedbackReconciliationStatus =
  | 'matched'
  /** A sticker resolved to nothing. A problem worth looking at. */
  | 'without_registration'
  /** A valid response from a rider with no Point A registration. Not a problem. */
  | 'standalone'
  | 'identity_conflict'
  | 'multiple_feedback'

export type MatchMethod =
  | 'qr_identity'
  | 'manual_public_code'
  | 'contact_identity'

/** How Point B identified a response. */
export type CaptureMethod = 'qr' | 'manual' | 'contact'

export interface RunDescriptor {
  readonly runId: string
  readonly eventId: string
  readonly engineVersion: string
  readonly startedAt: string
  readonly completedAt: string
  readonly counts: {
    readonly registrationCount: number
    readonly feedbackCount: number
    readonly matchedRegistrations: number
    readonly registrationsWithoutFeedback: number
    readonly registrationsWithMultipleFeedback: number
    readonly matchedFeedback: number
    readonly feedbackWithoutRegistration: number
    /** Valid direct responses. Never part of a "needs review" total. */
    readonly standaloneFeedback: number
    readonly feedbackIdentityConflicts: number
    readonly feedbackInMultipleGroups: number
    readonly duplicateRegistrationCandidateCount: number
  }
}

/**
 * Analytics over **unambiguous responses only**: `matched` and `standalone`.
 *
 * `standalone` is included because it is unambiguous. A rider who gave their
 * own contact details and answered every question said exactly one thing, and
 * the only fact reconciliation could not establish about them is whether they
 * also registered at Point A. That is a question about the event's paperwork,
 * not about their opinion of the motorcycle, and excluding their answers would
 * make the averages describe registered riders rather than riders.
 *
 * Still excluded, and for reasons that have not changed: `multiple_feedback`,
 * because no one of several responses is authoritative; `identity_conflict`,
 * because the response cannot be attributed to a person at all;
 * `without_registration`, because a sticker that resolves to nothing means the
 * identity on the response is wrong, so its answers cannot be trusted to belong
 * to whoever the code names. Including any of them would let an ambiguity
 * quietly move an average.
 */
export interface FeedbackAnalytics {
  /** How many responses the figures below are computed from. */
  readonly analysedResponses: number
  readonly averageOverallRating: number | null
  readonly ratingCounts: Readonly<Record<'1' | '2' | '3' | '4' | '5', number>>
  readonly experienceCounts: Readonly<
    Record<'very_poor' | 'poor' | 'okay' | 'good' | 'excellent', number>
  >
  readonly recommendYes: number
  readonly recommendNo: number
  readonly recommendPercentage: number | null
  /**
   * Responses handed to this analyser that were not its questionnaire.
   *
   * Zero in an overview, where each analyser is given only its own responses.
   * The event-wide figure is `OverviewResponse.unreadableResponses`.
   */
  readonly unreadableFormVersions: number
}

/**
 * Coverage is a different question from analytics.
 *
 * Analytics asks "what did unambiguous responses say?"; coverage asks "how many
 * **registered participants** gave us anything at all?", which legitimately
 * includes the ambiguous ones.
 *
 * Both numbers below count registrations, and a standalone direct response has
 * none. It therefore moves neither the numerator nor the denominator, which is
 * the only honest arithmetic: adding it to the top would report more responses
 * than registrations and could push coverage past 100%, and adding it to the
 * bottom would invent a registration to divide by. It is reported separately as
 * {@link directResponses}, beside coverage rather than inside it.
 */
export interface ResponseCoverage {
  readonly registrationsWithFeedback: number
  readonly totalRegistrations: number
  readonly percentage: number | null
  /**
   * Valid responses from riders with no Point A registration.
   *
   * Deliberately outside the fraction above. It answers a question coverage
   * cannot: how much feedback this event collected that its registration list
   * knows nothing about.
   */
  readonly directResponses: number
}

export interface FreshnessReport {
  /**
   * True when records arrived, or existing content was revised, after the run
   * completed. An idempotent re-delivery of unchanged records is not a change.
   */
  readonly dataChangedSinceRun: boolean
  readonly currentRegistrationCount: number
  readonly currentFeedbackCount: number
  /** Present now, absent from this run's results: therefore newer than it. */
  readonly registrationsAddedSinceRun: number
  readonly feedbackAddedSinceRun: number
  /**
   * Server time at which content was last accepted for this event: an insert or
   * an accepted revision. Never moved by an already-current retry.
   */
  readonly latestContentChangeAt: string | null
}

/** One campaign rating question's figures. */
export interface CampaignRatingSummary {
  readonly key: string
  /** The canonical question wording, so a report never shows a machine key. */
  readonly prompt: string
  readonly average: number | null
  /** How many responses carried a usable 1-7 answer to this question. */
  readonly responses: number
  readonly distribution: Readonly<
    Record<1 | 2 | 3 | 4 | 5 | 6 | 7, number>
  >
}

/**
 * Figures for the campaign questionnaire.
 *
 * Separate from {@link FeedbackAnalytics} rather than merged into it. The two
 * questionnaires measure different things on different scales, and a single
 * shape would force one of them to report meaningless nulls, which reads as a
 * result rather than as an absence.
 */
export interface CampaignAnalytics {
  readonly formVersion: string
  readonly analysedResponses: number
  readonly unreadableFormVersions: number
  readonly ratings: readonly CampaignRatingSummary[]
  /** How many riders wrote anything at all, per free-text question. */
  readonly textAnswers: {
    readonly topThreeFeatures: number
    readonly overallExperienceComments: number
  }
}

export interface OverviewResponse {
  readonly eventId: string
  readonly run: RunDescriptor
  /** True when a run older than the latest completed one was requested. */
  readonly isHistoricalRun: boolean
  readonly freshness: FreshnessReport
  /**
   * `feedback-v1` figures. Present whether or not the event holds any such
   * responses, because an event that mixes questionnaires needs both.
   */
  readonly analytics: FeedbackAnalytics
  /** Campaign figures, computed from `flying-flea-feedback-v1` responses only. */
  readonly campaignAnalytics: CampaignAnalytics
  /**
   * How many matched responses each questionnaire contributed, so a reader can
   * see at a glance which set of figures describes their event. Includes
   * versions this build cannot read, which is how an unknown one becomes
   * visible rather than silently absent.
   */
  readonly responsesByFormVersion: Readonly<Record<string, number>>
  /** Matched responses whose questionnaire this build has no figures for. */
  readonly unreadableResponses: number
  readonly coverage: ResponseCoverage
}

export interface FeedbackSummary {
  readonly overallRating: number | null
  readonly experience: string | null
  readonly recommend: boolean | null
}

/**
 * Campaign fields on a central registration.
 *
 * All optional: a registration captured before the campaign has none of them,
 * and reporting shows blank rather than inventing a value.
 */
export interface CampaignRegistrationFields {
  readonly vehicle: string | null
  readonly interestedColour: string | null
  readonly location: string | null
  readonly gender: string | null
  readonly testRideAt: string | null
  readonly pincode: string | null
}

export interface RegistrationRow extends CampaignRegistrationFields {
  readonly recordId: string
  readonly participantId: string
  readonly publicCode: string
  readonly name: string
  readonly phone: string
  readonly email: string
  readonly createdAt: string
  readonly revision: number
  /**
   * Never null. A row is in a run only if that run classified it, so there is
   * no "present but unclassified" state to represent.
   */
  readonly reconciliationStatus: RegistrationReconciliationStatus
  readonly validFeedbackCount: number
  readonly potentialDuplicate: boolean
  /**
   * Present **only** for `matched`, where exactly one valid response exists.
   * Never populated for `multiple_feedback`: picking one would imply a winner.
   */
  readonly feedbackSummary: FeedbackSummary | null
}

/**
 * The campaign ratings, for a compact summary.
 *
 * Present only on a `flying-flea-feedback-v1` response, and null on every other
 * questionnaire, including a future one, whose identically-named key would mean
 * something else. A row that is summarised at all is summarised on its own
 * scale.
 */
export interface CampaignFeedbackSummary {
  readonly testRideExperience: number | null
  readonly rotaryKnobUsage: number | null
  readonly rideModesExperience: number | null
  readonly overallExperienceRating: number | null
}

/**
 * The rider's own details, on a contact capture.
 *
 * Null on every other capture method, because those responses genuinely have
 * none: the sticker paths never asked. This is privileged PII, exactly like a
 * registration's name, phone and email, and it appears only behind the
 * reporting credential.
 */
export interface RespondentContact {
  readonly respondentName: string | null
  readonly respondentPhone: string | null
  readonly respondentEmail: string | null
}

export interface FeedbackRow extends RespondentContact {
  readonly recordId: string
  /** Null for a contact capture: that response never had a sticker. */
  readonly publicCode: string | null
  readonly participantId: string | null
  readonly captureMethod: CaptureMethod
  readonly formVersion: string
  readonly createdAt: string
  readonly revision: number
  /** Never null, for the same reason as `RegistrationRow.reconciliationStatus`. */
  readonly reconciliationStatus: FeedbackReconciliationStatus
  readonly matchMethod: MatchMethod | null
  /** `feedback-v1` answers. Null under any other questionnaire. */
  readonly overallRating: number | null
  readonly experience: string | null
  readonly recommend: boolean | null
  /** `flying-flea-feedback-v1` answers. Null under any other questionnaire. */
  readonly campaignSummary: CampaignFeedbackSummary | null
  readonly linkedRegistration: {
    readonly recordId: string
    readonly publicCode: string
    readonly name: string
  } | null
}

export interface Page<T> {
  readonly rows: readonly T[]
  /** Opaque to the client. Absent when there is no further page. */
  readonly nextCursor: string | null
  readonly pageSize: number
}

export interface DuplicateCandidateRow {
  readonly matchBasis: 'phone_and_email' | 'phone_only' | 'email_only'
  readonly left: DuplicateSide
  readonly right: DuplicateSide
}

export interface DuplicateSide {
  readonly recordId: string
  readonly publicCode: string
  readonly name: string
  readonly phone: string
  readonly email: string
}

export interface RegistrationDetail extends RegistrationRow {
  /**
   * Deliberately absent from {@link RegistrationRow}, and therefore from the
   * participant list. A licence number is the most sensitive field the campaign
   * captures and it answers no question a list is asked; reporting is
   * privileged, so the detail view may show it, labelled for what it is.
   */
  readonly drivingLicence: string | null
  readonly eventId: string
  readonly eventDay: string
  readonly stationId: string
  readonly sourceDeviceId: string
  readonly lastUploaderDeviceId: string
  readonly updatedAt: string
  /** Every valid response, never reduced to one. */
  readonly feedback: readonly FeedbackRow[]
}

export interface FeedbackDetail extends FeedbackRow {
  readonly eventId: string
  readonly eventDay: string
  readonly stationId: string
  readonly sourceDeviceId: string
  readonly lastUploaderDeviceId: string
  readonly updatedAt: string
  readonly answers: Readonly<Record<string, unknown>>
  /**
   * For an identity conflict: what each identifier resolves to *right now*.
   * Diagnostics, explicitly not a reconciliation decision.
   */
  readonly diagnostics: {
    readonly participantIdResolvesTo: DuplicateSide | null
    readonly publicCodeResolvesTo: DuplicateSide | null
  } | null
}

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100
