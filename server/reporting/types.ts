/*
 * Reporting DTOs.
 *
 * Shared in spirit with the client, which keeps its own mirrored types in
 * `src/lib/reporting/types.ts`. These are not part of the sync wire contract —
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
  | 'without_registration'
  | 'identity_conflict'
  | 'multiple_feedback'

export type MatchMethod = 'qr_identity' | 'manual_public_code'

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
    readonly feedbackIdentityConflicts: number
    readonly feedbackInMultipleGroups: number
    readonly duplicateRegistrationCandidateCount: number
  }
}

/**
 * Analytics over **unambiguous matched responses only**.
 *
 * `multiple_feedback` responses are excluded because no one of them is
 * authoritative; `identity_conflict` and `without_registration` are excluded
 * because they are not attributable to a participant at all. Including any of
 * them would let an ambiguity quietly move an average.
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
  /** Responses skipped because a form version this build cannot read. */
  readonly unreadableFormVersions: number
}

/**
 * Coverage is a different question from analytics.
 *
 * Analytics asks "what did unambiguous responses say?"; coverage asks "how many
 * participants gave us anything at all?" — which legitimately includes the
 * ambiguous ones.
 */
export interface ResponseCoverage {
  readonly registrationsWithFeedback: number
  readonly totalRegistrations: number
  readonly percentage: number | null
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
   * Server time at which content was last accepted for this event — an insert or
   * an accepted revision. Never moved by an already-current retry.
   */
  readonly latestContentChangeAt: string | null
}

export interface OverviewResponse {
  readonly eventId: string
  readonly run: RunDescriptor
  /** True when a run older than the latest completed one was requested. */
  readonly isHistoricalRun: boolean
  readonly freshness: FreshnessReport
  readonly analytics: FeedbackAnalytics
  readonly coverage: ResponseCoverage
}

export interface FeedbackSummary {
  readonly overallRating: number | null
  readonly experience: string | null
  readonly recommend: boolean | null
}

export interface RegistrationRow {
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

export interface FeedbackRow {
  readonly recordId: string
  readonly publicCode: string
  readonly participantId: string | null
  readonly captureMethod: 'qr' | 'manual'
  readonly formVersion: string
  readonly createdAt: string
  readonly revision: number
  /** Never null, for the same reason as `RegistrationRow.reconciliationStatus`. */
  readonly reconciliationStatus: FeedbackReconciliationStatus
  readonly matchMethod: MatchMethod | null
  readonly overallRating: number | null
  readonly experience: string | null
  readonly recommend: boolean | null
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
