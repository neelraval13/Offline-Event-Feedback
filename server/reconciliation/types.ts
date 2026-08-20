/*
 * Reconciliation domain types.
 *
 * Reconciliation is **derived data**. It reads the canonical registrations and
 * feedback tables, classifies the relationships between them, and writes its
 * conclusions somewhere else. It never edits, merges or deletes a raw record:
 * those rows are the evidence, and an engine that rewrote them would destroy
 * the only account of what the devices actually captured.
 */

/**
 * The reconciliation rules that produced a run. Persisted with every run.
 *
 * v2 added the third feedback identity path: a response whose identity is the
 * rider's own contact details, matched to a registration on normalised phone
 * AND email, or classified `standalone` when it matches none.
 *
 * Bumped rather than edited because the rules changed, and a run is only
 * interpretable against the rules that produced it. A v1 run and a v2 run over
 * the same data can legitimately disagree, and this is what lets a reader see
 * why instead of concluding one of them is wrong. Historical runs keep their
 * own version and are never re-classified.
 */
export const RECONCILIATION_ENGINE_VERSION = 'reconciliation-v2'

/* ------------------------------------------------------------------ *
 * Input: the central snapshot
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

/**
 * A response as reconciliation sees it.
 *
 * Every identity field is nullable because each capture method has only some of
 * them, and which ones is decided by `captureMethod`. The engine branches on
 * that first and never reads a field the method cannot have.
 *
 * `respondentPhone` and `respondentEmail` are here for the same reason a
 * registration's `phone` and `email` are: to match on, in memory, and never to
 * be written to a reconciliation table. `respondentName` is deliberately absent
 * from this shape. Nothing matches on a name, so nothing needs to read one.
 */
export interface ReconciliationFeedback {
  readonly recordId: string
  readonly captureMethod: 'qr' | 'manual' | 'contact'
  /** Present for a QR capture only. */
  readonly participantId: string | null
  /** Present for a sticker capture; absent for contact details. */
  readonly publicCode: string | null
  /** Present for a contact capture only. */
  readonly respondentPhone: string | null
  readonly respondentEmail: string | null
}

export interface ReconciliationInput {
  readonly eventId: string
  readonly registrations: readonly ReconciliationRegistration[]
  readonly feedback: readonly ReconciliationFeedback[]
}

/* ------------------------------------------------------------------ *
 * Output: classifications
 * ------------------------------------------------------------------ */

export type RegistrationStatus =
  /** Exactly one valid feedback record resolves here. */
  | 'matched'
  /** No valid feedback resolves here, not necessarily an error. */
  | 'without_feedback'
  /** Two or more valid feedback records resolve here. */
  | 'multiple_feedback'

export type FeedbackStatus =
  | 'matched'
  /**
   * A sticker resolved to no registration: the code was mistyped at Point B,
   * or the Point A device has not synced yet. Worth a human's attention.
   */
  | 'without_registration'
  /**
   * A complete response from a rider with no Point A registration.
   *
   * Emphatically **not** a failure. It is the expected outcome of the contact
   * path for somebody who never registered, and it is kept apart from
   * `without_registration` so that a pile of perfectly good direct responses
   * cannot bury the handful of mistyped codes that genuinely need looking at.
   * Standalone responses count towards analytics; see the reporting layer.
   */
  | 'standalone'
  /**
   * Identifiers that should describe one person do not.
   *
   * For a sticker: the QR's participant ID and printed code resolve to
   * different registrations. For contact details: the phone and email pair
   * matches more than one registration, so there is no single rider it could
   * belong to. Evidence of an inconsistency either way, and never resolved by
   * guessing.
   */
  | 'identity_conflict'
  /** Validly resolved, but sharing its registration with other feedback. */
  | 'multiple_feedback'

export type MatchMethod =
  /** Both QR identifiers agreed on one registration. */
  | 'qr_identity'
  /** A manually typed public code resolved to one registration. */
  | 'manual_public_code'
  /**
   * Normalised phone AND email both matched exactly one registration.
   *
   * Both, never either alone. A phone number is shared by a family and an email
   * account by a couple, so one of them matching is a coincidence worth nothing;
   * requiring the pair is what makes this a deterministic match rather than a
   * guess. A name is not consulted at all, at any point.
   */
  | 'contact_identity'

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
  /**
   * Valid direct responses from riders with no Point A registration.
   *
   * Reported separately from every other count so that nothing has to infer it,
   * and so that it never lands in a "needs review" total. Zero on any run
   * produced before engine v2, correctly: that engine could not classify one.
   */
  readonly standaloneFeedback: number
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
