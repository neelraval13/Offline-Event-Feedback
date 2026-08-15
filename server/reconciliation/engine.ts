import { isUsableKey, normalizeEmail, normalizePhone } from './normalize.js'
import {
  RECONCILIATION_ENGINE_VERSION,
  type DuplicateMatchBasis,
  type DuplicateRegistrationCandidate,
  type FeedbackResult,
  type MatchMethod,
  type ReconciliationInput,
  type ReconciliationOutput,
  type ReconciliationRegistration,
  type RegistrationResult,
} from './types.js'

/*
 * The reconciliation engine.
 *
 * A pure function: central snapshot in, classifications out. No database, no
 * clock, no I/O. That is what makes it exhaustively testable and what makes
 * "deterministic" a property rather than an aspiration: the same registrations
 * and feedback produce the same output regardless of the order they arrive in.
 *
 * It classifies. It never resolves. Where the data is ambiguous (two feedback
 * records for one participant, two registrations that might be one person) the
 * engine says so and stops. Picking a winner would be a guess recorded as a
 * fact, and the raw rows would no longer explain how the system reached it.
 */

/** Sorting everything up front makes output independent of input order. */
function byRecordId<T extends { recordId: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) =>
    left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0,
  )
}

interface ResolvedFeedback {
  readonly feedbackRecordId: string
  readonly registrationRecordId: string | null
  readonly matchMethod: MatchMethod | null
  readonly conflict: boolean
}

/**
 * Resolves one feedback record against the registrations in this snapshot.
 *
 * A QR sticker carries two independent identifiers that the contract says
 * belong to the same person. When they disagree, neither is preferred: the
 * disagreement itself is the finding. Silently trusting `participantId` would
 * bury evidence that something upstream produced an inconsistent sticker or an
 * inconsistent record.
 */
function resolveFeedback(
  feedback: ReconciliationInput['feedback'][number],
  byParticipantId: ReadonlyMap<string, ReconciliationRegistration>,
  byPublicCode: ReadonlyMap<string, ReconciliationRegistration>,
): ResolvedFeedback {
  const viaCode = byPublicCode.get(feedback.publicCode) ?? null

  if (feedback.captureMethod === 'manual') {
    /*
     * A manually typed code carries no participant ID and one cannot be
     * invented for it. The code either resolves or it does not.
     */
    return {
      feedbackRecordId: feedback.recordId,
      registrationRecordId: viaCode?.recordId ?? null,
      matchMethod: viaCode === null ? null : 'manual_public_code',
      conflict: false,
    }
  }

  const viaParticipant =
    feedback.participantId === null
      ? null
      : (byParticipantId.get(feedback.participantId) ?? null)

  // Neither identifier is known here: most likely Point A has not synced yet.
  if (viaParticipant === null && viaCode === null) {
    return {
      feedbackRecordId: feedback.recordId,
      registrationRecordId: null,
      matchMethod: null,
      conflict: false,
    }
  }

  // Both resolve, and agree. The only clean QR match.
  if (
    viaParticipant !== null &&
    viaCode !== null &&
    viaParticipant.recordId === viaCode.recordId
  ) {
    return {
      feedbackRecordId: feedback.recordId,
      registrationRecordId: viaParticipant.recordId,
      matchMethod: 'qr_identity',
      conflict: false,
    }
  }

  /*
   * Everything else is a conflict: they resolved to different registrations, or
   * only one of the two resolved at all. A half-resolving QR code is not a
   * partial match; it means the sticker's two identifiers no longer describe
   * the same central record.
   */
  return {
    feedbackRecordId: feedback.recordId,
    registrationRecordId: null,
    matchMethod: null,
    conflict: true,
  }
}

/**
 * Pairs of registrations that may describe the same person.
 *
 * Grouped by normalised contact value rather than compared pairwise: comparing
 * every registration with every other is quadratic, and at 10,000 participants
 * that is 50 million comparisons for a question a hash map answers.
 *
 * When a pair matches on both phone and email, only the stronger basis is
 * emitted: a reviewer should see one candidate, not three.
 */
function findDuplicateCandidates(
  registrations: readonly ReconciliationRegistration[],
): DuplicateRegistrationCandidate[] {
  const byPhone = new Map<string, string[]>()
  const byEmail = new Map<string, string[]>()

  for (const registration of registrations) {
    const phone = normalizePhone(registration.phone)
    const email = normalizeEmail(registration.email)

    if (isUsableKey(phone)) {
      byPhone.set(phone, [...(byPhone.get(phone) ?? []), registration.recordId])
    }
    if (isUsableKey(email)) {
      byEmail.set(email, [...(byEmail.get(email) ?? []), registration.recordId])
    }
  }

  /** Canonical ordering, so A/B and B/A are the same pair. */
  const pairKey = (left: string, right: string): [string, string] =>
    left < right ? [left, right] : [right, left]

  const pairs = new Map<string, DuplicateMatchBasis>()

  const addPairs = (groups: Map<string, string[]>, basis: DuplicateMatchBasis) => {
    for (const members of groups.values()) {
      if (members.length < 2) {
        continue
      }

      const sorted = [...members].sort()
      for (let i = 0; i < sorted.length; i += 1) {
        for (let j = i + 1; j < sorted.length; j += 1) {
          const [left, right] = pairKey(sorted[i] as string, sorted[j] as string)
          // A NUL separator, written as an escape: a literal NUL in the source
          // makes this file binary to grep, ripgrep and every other text
          // tool, which is how six em dashes once hid in it.
          const key = `${left}\u0000${right}`
          const existing = pairs.get(key)

          // Seen on both keys: the strongest basis replaces the weaker one.
          pairs.set(
            key,
            existing !== undefined && existing !== basis ? 'phone_and_email' : basis,
          )
        }
      }
    }
  }

  addPairs(byPhone, 'phone_only')
  addPairs(byEmail, 'email_only')

  return [...pairs.entries()]
    .map(([key, matchBasis]) => {
      const [left = '', right = ''] = key.split('\u0000')
      return {
        leftRegistrationRecordId: left,
        rightRegistrationRecordId: right,
        matchBasis,
      }
    })
    .sort((a, b) =>
      a.leftRegistrationRecordId === b.leftRegistrationRecordId
        ? a.rightRegistrationRecordId.localeCompare(b.rightRegistrationRecordId)
        : a.leftRegistrationRecordId.localeCompare(b.leftRegistrationRecordId),
    )
}

/**
 * Classifies one central snapshot.
 *
 * Every registration gets exactly one result and every feedback record gets
 * exactly one result; nothing is allowed to vanish silently from a run.
 */
export function reconcile(input: ReconciliationInput): ReconciliationOutput {
  const registrations = byRecordId(input.registrations)
  const feedback = byRecordId(input.feedback)

  // Both are unique within an event by the Phase 6 schema.
  const byParticipantId = new Map(
    registrations.map((registration) => [registration.participantId, registration]),
  )
  const byPublicCode = new Map(
    registrations.map((registration) => [registration.publicCode, registration]),
  )

  const resolved = feedback.map((record) =>
    resolveFeedback(record, byParticipantId, byPublicCode),
  )

  /* Valid links, grouped by the registration they resolved to. */
  const validByRegistration = new Map<string, string[]>()
  for (const entry of resolved) {
    if (entry.conflict || entry.registrationRecordId === null) {
      continue
    }
    validByRegistration.set(entry.registrationRecordId, [
      ...(validByRegistration.get(entry.registrationRecordId) ?? []),
      entry.feedbackRecordId,
    ])
  }

  const registrationResults: RegistrationResult[] = registrations.map(
    (registration) => {
      const validFeedbackCount =
        validByRegistration.get(registration.recordId)?.length ?? 0

      return {
        registrationRecordId: registration.recordId,
        status:
          validFeedbackCount === 0
            ? 'without_feedback'
            : validFeedbackCount === 1
              ? 'matched'
              : 'multiple_feedback',
        validFeedbackCount,
      }
    },
  )

  /*
   * Feedback sharing a registration is flagged on both sides. No winner is
   * chosen: device clocks are not aligned across machines, and arrival order
   * reflects when a device found a connection rather than when a participant
   * answered. Neither is authority.
   */
  const ambiguousRegistrations = new Set(
    [...validByRegistration.entries()]
      .filter(([, members]) => members.length > 1)
      .map(([registrationRecordId]) => registrationRecordId),
  )

  const feedbackResults: FeedbackResult[] = resolved.map((entry) => {
    if (entry.conflict) {
      return {
        feedbackRecordId: entry.feedbackRecordId,
        registrationRecordId: null,
        status: 'identity_conflict',
        matchMethod: null,
      }
    }

    if (entry.registrationRecordId === null) {
      return {
        feedbackRecordId: entry.feedbackRecordId,
        registrationRecordId: null,
        status: 'without_registration',
        matchMethod: null,
      }
    }

    return {
      feedbackRecordId: entry.feedbackRecordId,
      registrationRecordId: entry.registrationRecordId,
      status: ambiguousRegistrations.has(entry.registrationRecordId)
        ? 'multiple_feedback'
        : 'matched',
      matchMethod: entry.matchMethod,
    }
  })

  const duplicateCandidates = findDuplicateCandidates(registrations)

  const countRegistrations = (status: RegistrationResult['status']) =>
    registrationResults.filter((result) => result.status === status).length
  const countFeedback = (status: FeedbackResult['status']) =>
    feedbackResults.filter((result) => result.status === status).length

  return {
    engineVersion: RECONCILIATION_ENGINE_VERSION,
    registrationResults,
    feedbackResults,
    duplicateCandidates,
    counts: {
      registrationCount: registrations.length,
      feedbackCount: feedback.length,

      matchedRegistrations: countRegistrations('matched'),
      registrationsWithoutFeedback: countRegistrations('without_feedback'),
      registrationsWithMultipleFeedback: countRegistrations('multiple_feedback'),

      matchedFeedback: countFeedback('matched'),
      feedbackWithoutRegistration: countFeedback('without_registration'),
      feedbackIdentityConflicts: countFeedback('identity_conflict'),
      feedbackInMultipleGroups: countFeedback('multiple_feedback'),

      duplicateRegistrationCandidateCount: duplicateCandidates.length,
    },
  }
}
