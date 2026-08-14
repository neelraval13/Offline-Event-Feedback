/*
 * Reporting DTOs, mirrored from `server/reporting/types.ts`.
 *
 * A deliberate copy rather than a shared module: `shared/` is the versioned
 * sync wire contract, honoured by devices that may be several builds behind.
 * Reporting is a browser talking to the server that served it, so the two
 * always deploy together and a version negotiation would be theatre.
 *
 * Nothing described here may be written to IndexedDB, localStorage,
 * sessionStorage or a cache. These types exist only in React state, for as long
 * as the screen is open.
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

export interface FeedbackAnalytics {
  readonly analysedResponses: number
  readonly averageOverallRating: number | null
  readonly ratingCounts: Readonly<Record<'1' | '2' | '3' | '4' | '5', number>>
  readonly experienceCounts: Readonly<
    Record<'very_poor' | 'poor' | 'okay' | 'good' | 'excellent', number>
  >
  readonly recommendYes: number
  readonly recommendNo: number
  readonly recommendPercentage: number | null
  readonly unreadableFormVersions: number
}

export interface ResponseCoverage {
  readonly registrationsWithFeedback: number
  readonly totalRegistrations: number
  readonly percentage: number | null
}

export interface FreshnessReport {
  /**
   * Records arrived, or existing content was revised, after the run completed.
   * A device re-sending records it had already delivered is not a change.
   */
  readonly dataChangedSinceRun: boolean
  readonly currentRegistrationCount: number
  readonly currentFeedbackCount: number
  readonly registrationsAddedSinceRun: number
  readonly feedbackAddedSinceRun: number
  readonly latestContentChangeAt: string | null
}

export interface OverviewResponse {
  readonly eventId: string
  readonly run: RunDescriptor
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
   * Never null: a run contains exactly the records it classified, so the browser
   * has no "not in this run" row state to render.
   */
  readonly reconciliationStatus: RegistrationReconciliationStatus
  readonly validFeedbackCount: number
  readonly potentialDuplicate: boolean
  /** Null whenever the run identified more than one valid response. */
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
  readonly nextCursor: string | null
  readonly pageSize: number
}

export interface DuplicateSide {
  readonly recordId: string
  readonly publicCode: string
  readonly name: string
  readonly phone: string
  readonly email: string
}

export interface DuplicateCandidateRow {
  readonly matchBasis: 'phone_and_email' | 'phone_only' | 'email_only'
  readonly left: DuplicateSide
  readonly right: DuplicateSide
}

export interface RegistrationDetail extends RegistrationRow {
  readonly eventId: string
  readonly eventDay: string
  readonly stationId: string
  readonly sourceDeviceId: string
  readonly lastUploaderDeviceId: string
  readonly updatedAt: string
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
  readonly diagnostics: {
    readonly participantIdResolvesTo: DuplicateSide | null
    readonly publicCodeResolvesTo: DuplicateSide | null
  } | null
}

export interface RegistrationQueryBody {
  readonly eventId: string
  readonly runId?: string
  readonly status?: RegistrationReconciliationStatus | 'all'
  readonly search?: string
  readonly duplicateCandidateOnly?: boolean
  readonly limit?: number
  readonly cursor?: string
}

export interface FeedbackQueryBody {
  readonly eventId: string
  readonly runId?: string
  readonly status?: FeedbackReconciliationStatus | 'all'
  readonly search?: string
  readonly limit?: number
  readonly cursor?: string
}

export interface ReconcileResult {
  readonly runId: string
  readonly completedAt: string | null
  readonly counts: RunDescriptor['counts']
}

export const EXPORT_KINDS = [
  'registrations.csv',
  'feedback.csv',
  'duplicate-candidates.csv',
  'report.xlsx',
] as const

export type ExportKind = (typeof EXPORT_KINDS)[number]
