/*
 * Reconciliation domain types.
 *
 * Reconciliation is **derived data**. It reads the canonical registrations and
 * feedback tables, classifies the relationships between them, and writes its
 * conclusions somewhere else. It never edits, merges or deletes a raw record:
 * those rows are the evidence, and an engine that rewrote them would destroy
 * the only account of what the devices actually captured.
 */

/** The reconciliation rules that produced a run. Persisted with every run. */
export const RECONCILIATION_ENGINE_VERSION = 'reconciliation-v1'

/* ------------------------------------------------------------------ *
 * Input — the central snapshot
 * ------------------------------------------------------------------ */

/**
 * A registration as reconciliation sees it.
 *
 * `phone` and `email` are present only to group duplicate candidates. They are
 * never written to a reconciliation table.
 */
export interface ReconciliationRegistration {
  readonly recordId: string
  readonly participantId: string
  readonly publicCode: string
  readonly phone: string
  readonly email: string
}

export interface ReconciliationFeedback {
  readonly recordId: string
  readonly captureMethod: 'qr' | 'manual'
  /** Present for a QR capture; absent for a manually typed code. */
  readonly participantId: string | null
  readonly publicCode: string
}

export interface ReconciliationInput {
  readonly eventId: string
  readonly registrations: readonly ReconciliationRegistration[]
  readonly feedback: readonly ReconciliationFeedback[]
}

/* ------------------------------------------------------------------ *
 * Output — classifications
 * ------------------------------------------------------------------ */

export type RegistrationStatus =
  /** Exactly one valid feedback record resolves here. */
  | 'matched'
  /** No valid feedback resolves here — not necessarily an error. */
  | 'without_feedback'
  /** Two or more valid feedback records resolve here. */
  | 'multiple_feedback'

export type FeedbackStatus =
  | 'matched'
  /** No registration resolves — the Point A device may simply not have synced. */
  | 'without_registration'
  /** The QR's two identifiers disagree. Evidence of an inconsistency. */
  | 'identity_conflict'
  /** Validly resolved, but sharing its registration with other feedback. */
  | 'multiple_feedback'

export type MatchMethod =
  /** Both QR identifiers agreed on one registration. */
  | 'qr_identity'
  /** A manually typed public code resolved to one registration. */
  | 'manual_public_code'

/**
 * How two registrations came to be suspected of describing one person.
 *
 * A candidate means *may be the same person*, never *is*. Families share phone
 * numbers and couples share email accounts.
 */
export type DuplicateMatchBasis = 'phone_and_email' | 'phone_only' | 'email_only'

export interface RegistrationResult {
  readonly registrationRecordId: string
  readonly status: RegistrationStatus
  /** Excludes identity-conflict feedback, which is not a valid link. */
  readonly validFeedbackCount: number
}

export interface FeedbackResult {
  readonly feedbackRecordId: string
  /** The registration it resolved to, or null when it resolved to none. */
  readonly registrationRecordId: string | null
  readonly status: FeedbackStatus
  readonly matchMethod: MatchMethod | null
}

export interface DuplicateRegistrationCandidate {
  /** Canonically the lexicographically smaller ID, so a pair appears once. */
  readonly leftRegistrationRecordId: string
  readonly rightRegistrationRecordId: string
  readonly matchBasis: DuplicateMatchBasis
}

export interface ReconciliationCounts {
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

export interface ReconciliationOutput {
  readonly engineVersion: typeof RECONCILIATION_ENGINE_VERSION
  readonly registrationResults: readonly RegistrationResult[]
  readonly feedbackResults: readonly FeedbackResult[]
  readonly duplicateCandidates: readonly DuplicateRegistrationCandidate[]
  readonly counts: ReconciliationCounts
}
