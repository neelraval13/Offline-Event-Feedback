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
    })
  }
  for (let index = 0; index < 30; index += 1) {
    feedback.push({
      recordId: randomUUID(),
      captureMethod: 'manual',
      participantId: null,
      publicCode: `A1-CCCCCC-${String(index + 1).padStart(5, '0')}-X`,
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
        counts.feedbackIdentityConflicts +
        counts.feedbackInMultipleGroups,
    ).toBe(counts.feedbackCount)

    // The deliberate cases came through.
    expect(counts.feedbackIdentityConflicts).toBe(20)
    expect(counts.feedbackWithoutRegistration).toBe(30)
    expect(counts.registrationsWithMultipleFeedback).toBeGreaterThan(0)
    expect(counts.duplicateRegistrationCandidateCount).toBeGreaterThan(0)

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
    const measure = (registrations: number, feedback: number): number => {
      const snapshot = buildSnapshot(registrations, feedback)
      const started = performance.now()
      reconcile({
        eventId: 'evt-dev-001',
        registrations: snapshot.registrations,
        feedback: snapshot.feedback,
      })
      return performance.now() - started
    }

    // Warm up, so the first measurement does not pay for JIT compilation.
    measure(1_000, 900)

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
