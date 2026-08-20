import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { reconcile } from './engine.js'
import type {
  ReconciliationFeedback,
  ReconciliationRegistration,
} from './types.js'

/*
 * A full event through the engine.
 *
 * The failure this guards against is a comparison that quietly becomes
 * quadratic: matching every feedback record against every registration, or
 * comparing every registration with every other to find duplicates. At ten
 * records either is instant; at ten thousand it is fifty million comparisons
 * and a reconciliation that never finishes.
 */

const REGISTRATIONS = 10_000
const FEEDBACK = 9_000
/** Riders who identified themselves by contact details rather than a sticker. */
const CONTACT_RESPONSES = 1_000

interface Snapshot {
  registrations: ReconciliationRegistration[]
  feedback: ReconciliationFeedback[]
}

/**
 * Builds a realistic snapshot: mostly one response per participant, some with
 * none, a few with two, a handful of conflicts and orphans, and a scattering of
 * shared contact details.
 */
function buildSnapshot(registrationCount: number, feedbackCount: number): Snapshot {
  const registrations: ReconciliationRegistration[] = Array.from(
    { length: registrationCount },
    (_, index) => ({
      recordId: randomUUID(),
      participantId: randomUUID(),
      publicCode: `A1-B8EFD9-${String(index + 1).padStart(5, '0')}-X`,
      // Every 500th participant shares contact details with the previous one.
      phone:
        index % 500 === 0
          ? '+44 20 7946 0000'
          : `+44 20 7946 ${String(index).padStart(4, '0')}`,
      email:
        index % 500 === 0 ? 'shared@example.com' : `participant${index}@example.com`,
    }),
  )

  const feedback: ReconciliationFeedback[] = []

  for (let index = 0; index < feedbackCount; index += 1) {
    const target = registrations[index % registrationCount] as ReconciliationRegistration

    // Roughly one in fifty is a manual capture, matching field experience.
    const manual = index % 50 === 0
    feedback.push({
      recordId: randomUUID(),
      captureMethod: manual ? 'manual' : 'qr',
      participantId: manual ? null : target.participantId,
      publicCode: target.publicCode,
      respondentPhone: null,
      respondentEmail: null,
    })
  }

  // A few duplicates, a few conflicts, a few orphans.
  for (let index = 0; index < 100; index += 1) {
    const target = registrations[index] as ReconciliationRegistration
    feedback.push({
      recordId: randomUUID(),
      captureMethod: 'manual',
      participantId: null,
      publicCode: target.publicCode,
      respondentPhone: null,
      respondentEmail: null,
    })
  }
  for (let index = 0; index < 20; index += 1) {
    const target = registrations[index] as ReconciliationRegistration
    const other = registrations[index + 1] as ReconciliationRegistration
    feedback.push({
      recordId: randomUUID(),
      captureMethod: 'qr',
      participantId: target.participantId,
      publicCode: other.publicCode,
      respondentPhone: null,
      respondentEmail: null,
    })
  }
  for (let index = 0; index < 30; index += 1) {
    feedback.push({
      recordId: randomUUID(),
      captureMethod: 'manual',
      participantId: null,
      publicCode: `A1-CCCCCC-${String(index + 1).padStart(5, '0')}-X`,
      respondentPhone: null,
      respondentEmail: null,
    })
  }

  /*
   * Contact responses: riders who never registered, and riders who did.
   *
   * The failure this guards against is a matcher that scans every registration
   * for every contact response. At these counts that is 200,000 * 10,000
   * comparisons, which is not slow so much as never-finishing, and it would be
   * invisible at fixture scale.
   *
   * Two thirds match a registration and one third matches nobody, roughly the
   * shape an event with a busy contact desk produces.
   */
  for (let index = 0; index < CONTACT_RESPONSES; index += 1) {
    const registered = index % 3 !== 0
    const target = registrations[index % registrationCount] as ReconciliationRegistration

    feedback.push({
      recordId: randomUUID(),
      captureMethod: 'contact',
      participantId: null,
      publicCode: null,
      respondentPhone: registered ? target.phone : `+44 20 8000 ${String(index).padStart(4, '0')}`,
      respondentEmail: registered ? target.email : `walkup${index}@example.com`,
    })
  }

  return { registrations, feedback }
}

describe(`a full event of ${REGISTRATIONS.toLocaleString()} registrations`, () => {
  it('reconciles in a sensible time and accounts for every record', () => {
    const snapshot = buildSnapshot(REGISTRATIONS, FEEDBACK)

    const started = performance.now()
    const output = reconcile({
      eventId: 'evt-dev-001',
      registrations: snapshot.registrations,
      feedback: snapshot.feedback,
    })
    const elapsed = performance.now() - started

    const { counts } = output

    // Nothing vanishes: every record gets exactly one classification.
    expect(output.registrationResults).toHaveLength(snapshot.registrations.length)
    expect(output.feedbackResults).toHaveLength(snapshot.feedback.length)
    expect(
      counts.matchedRegistrations +
        counts.registrationsWithoutFeedback +
        counts.registrationsWithMultipleFeedback,
    ).toBe(counts.registrationCount)
    expect(
      counts.matchedFeedback +
        counts.feedbackWithoutRegistration +
        counts.standaloneFeedback +
        counts.feedbackIdentityConflicts +
        counts.feedbackInMultipleGroups,
    ).toBe(counts.feedbackCount)

    /*
     * The deliberate cases came through.
     *
     * 21 conflicts, not 20: twenty are the deliberately mismatched QR stickers,
     * and the twenty-first is a contact response whose phone and email pair
     * belongs to more than one registration. The fixture gives every 500th
     * participant the same contact details as the others, so that pair
     * genuinely identifies twenty people, and a response carrying it cannot be
     * attributed to any of them. Reaching that at scale, without being asked
     * for it, is the ambiguity rule working.
     */
    expect(counts.feedbackIdentityConflicts).toBe(21)
    expect(counts.feedbackWithoutRegistration).toBe(30)
    expect(counts.registrationsWithMultipleFeedback).toBeGreaterThan(0)
    expect(counts.duplicateRegistrationCandidateCount).toBeGreaterThan(0)
    // Contact responses came through both ways: matched to a registration, and
    // standalone. Roughly a third of them match nobody, by construction.
    expect(counts.standaloneFeedback).toBeGreaterThan(300)
    expect(counts.standaloneFeedback).toBeLessThan(CONTACT_RESPONSES)

    console.info(
      [
        '',
        `  scale: ${counts.registrationCount.toLocaleString()} registrations + ${counts.feedbackCount.toLocaleString()} feedback`,
        `  reconcile              ${elapsed.toFixed(0)} ms`,
        `  matched registrations  ${counts.matchedRegistrations.toLocaleString()}`,
        `  without feedback       ${counts.registrationsWithoutFeedback.toLocaleString()}`,
        `  multiple feedback      ${counts.registrationsWithMultipleFeedback.toLocaleString()}`,
        `  matched feedback       ${counts.matchedFeedback.toLocaleString()}`,
        `  identity conflicts     ${counts.feedbackIdentityConflicts.toLocaleString()}`,
        `  without registration   ${counts.feedbackWithoutRegistration.toLocaleString()}`,
        `  direct (standalone)    ${counts.standaloneFeedback.toLocaleString()}`,
        `  duplicate candidates   ${counts.duplicateRegistrationCandidateCount.toLocaleString()}`,
        '',
      ].join('\n'),
    )

    // Generous: this detects an accidental quadratic, it is not a budget.
    expect(elapsed).toBeLessThan(20_000)
  })

  it('scales roughly linearly rather than quadratically', () => {
    /*
     * Doubling the input should roughly double the work. A quadratic algorithm
     * would roughly quadruple it: the ratio below would exceed 3 long before
     * it became slow enough for a wall-clock ceiling to notice.
     */
    const once = (registrations: number, feedback: number): number => {
      const snapshot = buildSnapshot(registrations, feedback)
      const started = performance.now()
      reconcile({
        eventId: 'evt-dev-001',
        registrations: snapshot.registrations,
        feedback: snapshot.feedback,
      })
      return performance.now() - started
    }

    /*
     * The fastest of several runs, not the average.
     *
     * Timing noise on a shared machine is one-directional: a garbage collection
     * or another suite's Postgres query can only ever make a run slower, never
     * faster. The minimum is therefore the cleanest estimate of what the
     * algorithm actually costs, and averaging would fold in exactly the
     * interference the estimate is trying to exclude.
     *
     * This suite ran green in isolation at 2.48x and failed at 3.08x when the
     * database suites ran alongside it. A flaky test in a gate is worse than no
     * test: it teaches people to re-run rather than to look.
     */
    const measure = (registrations: number, feedback: number): number =>
      Math.min(...Array.from({ length: 3 }, () => once(registrations, feedback)))

    // Warm up, so the first measurement does not pay for JIT compilation.
    once(1_000, 900)

    const small = measure(5_000, 4_500)
    const large = measure(10_000, 9_000)

    const ratio = large / Math.max(small, 0.5)
    console.info(
      `\n  doubling the input multiplied runtime by ${ratio.toFixed(2)}x ` +
        `(linear ≈ 2x, quadratic ≈ 4x)\n`,
    )

    expect(ratio).toBeLessThan(3)
  })
})
