import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { reconcile } from './engine.js'
import { normalizeEmail, normalizePhone } from './normalize.js'
import type {
  ReconciliationFeedback,
  ReconciliationInput,
  ReconciliationRegistration,
} from './types.js'

/*
 * The engine is pure, so these tests are the real specification of Phase 7.
 * Everything below runs without a database.
 */

const EVENT_ID = 'evt-dev-001'

let sequence = 0

function registration(
  overrides: Partial<ReconciliationRegistration> = {},
): ReconciliationRegistration {
  sequence += 1
  return {
    recordId: randomUUID(),
    participantId: randomUUID(),
    publicCode: `A1-B8EFD9-${String(sequence).padStart(5, '0')}-X`,
    phone: `+44 20 7946 ${String(1000 + sequence).slice(-4)}`,
    email: `participant${sequence}@example.com`,
    ...overrides,
  }
}

function qrFeedback(
  target: ReconciliationRegistration,
  overrides: Partial<ReconciliationFeedback> = {},
): ReconciliationFeedback {
  return {
    recordId: randomUUID(),
    captureMethod: 'qr',
    participantId: target.participantId,
    publicCode: target.publicCode,
    // A sticker capture has no respondent details, by database constraint.
    respondentPhone: null,
    respondentEmail: null,
    ...overrides,
  }
}

function manualFeedback(
  target: ReconciliationRegistration,
  overrides: Partial<ReconciliationFeedback> = {},
): ReconciliationFeedback {
  return {
    recordId: randomUUID(),
    captureMethod: 'manual',
    participantId: null,
    publicCode: target.publicCode,
    respondentPhone: null,
    respondentEmail: null,
    ...overrides,
  }
}

function run(
  registrations: ReconciliationRegistration[],
  feedback: ReconciliationFeedback[] = [],
) {
  const input: ReconciliationInput = { eventId: EVENT_ID, registrations, feedback }
  return reconcile(input)
}

const feedbackFor = (output: ReturnType<typeof run>, recordId: string) =>
  output.feedbackResults.find((result) => result.feedbackRecordId === recordId)

const registrationFor = (output: ReturnType<typeof run>, recordId: string) =>
  output.registrationResults.find(
    (result) => result.registrationRecordId === recordId,
  )

describe('QR feedback matching', () => {
  it('matches when both identifiers agree', () => {
    const target = registration()
    const feedback = qrFeedback(target)

    const result = feedbackFor(run([target], [feedback]), feedback.recordId)

    expect(result).toMatchObject({
      status: 'matched',
      registrationRecordId: target.recordId,
      matchMethod: 'qr_identity',
    })
  })

  it('flags a conflict when the two identifiers point at different registrations', () => {
    /*
     * The QR contract says both identifiers describe one person. When they
     * disagree, neither is preferred: the disagreement is the finding.
     */
    const alice = registration()
    const bob = registration()
    const feedback = qrFeedback(alice, { publicCode: bob.publicCode })

    const result = feedbackFor(run([alice, bob], [feedback]), feedback.recordId)

    expect(result).toMatchObject({
      status: 'identity_conflict',
      registrationRecordId: null,
      matchMethod: null,
    })
  })

  it('flags a conflict when only the participant resolves', () => {
    const target = registration()
    const feedback = qrFeedback(target, { publicCode: 'A1-B8EFD9-99999-Z' })

    expect(feedbackFor(run([target], [feedback]), feedback.recordId)?.status).toBe(
      'identity_conflict',
    )
  })

  it('flags a conflict when only the public code resolves', () => {
    const target = registration()
    const feedback = qrFeedback(target, { participantId: randomUUID() })

    expect(feedbackFor(run([target], [feedback]), feedback.recordId)?.status).toBe(
      'identity_conflict',
    )
  })

  it('reports no registration when neither identifier resolves', () => {
    const stranger = registration()
    const feedback = qrFeedback(stranger)

    const result = feedbackFor(run([], [feedback]), feedback.recordId)

    expect(result).toMatchObject({
      status: 'without_registration',
      registrationRecordId: null,
    })
  })

  it('never silently prefers the participant id over the public code', () => {
    const alice = registration()
    const bob = registration()
    const feedback = qrFeedback(alice, { publicCode: bob.publicCode })

    const result = feedbackFor(run([alice, bob], [feedback]), feedback.recordId)

    // Neither registration is credited with this response.
    expect(result?.registrationRecordId).toBeNull()
    expect(registrationFor(run([alice, bob], [feedback]), alice.recordId)?.status).toBe(
      'without_feedback',
    )
  })
})

describe('manual feedback matching', () => {
  it('matches on the printed code alone', () => {
    const target = registration()
    const feedback = manualFeedback(target)

    const result = feedbackFor(run([target], [feedback]), feedback.recordId)

    expect(result).toMatchObject({
      status: 'matched',
      registrationRecordId: target.recordId,
      matchMethod: 'manual_public_code',
    })
  })

  it('reports no registration when the code resolves to nothing', () => {
    const feedback = manualFeedback(registration())

    expect(feedbackFor(run([], [feedback]), feedback.recordId)).toMatchObject({
      status: 'without_registration',
      matchMethod: null,
    })
  })

  it('never fabricates a participant id', () => {
    // The relationship lives in the derived result, not in the raw record.
    const target = registration()
    const feedback = manualFeedback(target)
    const output = run([target], [feedback])

    expect(feedback.participantId).toBeNull()
    expect(feedbackFor(output, feedback.recordId)?.registrationRecordId).toBe(
      target.recordId,
    )
  })
})

describe('registration feedback status', () => {
  it('reports a registration with no feedback', () => {
    const target = registration()

    expect(registrationFor(run([target]), target.recordId)).toMatchObject({
      status: 'without_feedback',
      validFeedbackCount: 0,
    })
  })

  it('reports a registration with exactly one response', () => {
    const target = registration()

    expect(
      registrationFor(run([target], [qrFeedback(target)]), target.recordId),
    ).toMatchObject({ status: 'matched', validFeedbackCount: 1 })
  })

  it('reports a registration with two responses', () => {
    const target = registration()

    expect(
      registrationFor(
        run([target], [qrFeedback(target), qrFeedback(target)]),
        target.recordId,
      ),
    ).toMatchObject({ status: 'multiple_feedback', validFeedbackCount: 2 })
  })

  it('does not count identity-conflict feedback as valid', () => {
    const alice = registration()
    const bob = registration()
    const conflicted = qrFeedback(alice, { publicCode: bob.publicCode })

    const output = run([alice, bob], [conflicted])

    expect(registrationFor(output, alice.recordId)).toMatchObject({
      status: 'without_feedback',
      validFeedbackCount: 0,
    })
    expect(registrationFor(output, bob.recordId)?.validFeedbackCount).toBe(0)
  })

  it('counts only the valid feedback alongside a conflicted one', () => {
    const alice = registration()
    const bob = registration()
    const valid = qrFeedback(alice)
    const conflicted = qrFeedback(alice, { publicCode: bob.publicCode })

    const output = run([alice, bob], [valid, conflicted])

    expect(registrationFor(output, alice.recordId)).toMatchObject({
      status: 'matched',
      validFeedbackCount: 1,
    })
  })
})

describe('multiple feedback', () => {
  it('flags the registration and every response in the group', () => {
    const target = registration()
    const first = qrFeedback(target)
    const second = qrFeedback(target)

    const output = run([target], [first, second])

    expect(registrationFor(output, target.recordId)?.status).toBe('multiple_feedback')
    expect(feedbackFor(output, first.recordId)?.status).toBe('multiple_feedback')
    expect(feedbackFor(output, second.recordId)?.status).toBe('multiple_feedback')
  })

  it('keeps both responses linked to the registration', () => {
    // Nothing is deleted and no winner is chosen: device clocks are not aligned
    // and arrival order reflects connectivity, not when a participant answered.
    const target = registration()
    const first = qrFeedback(target)
    const second = manualFeedback(target)

    const output = run([target], [first, second])

    expect(feedbackFor(output, first.recordId)?.registrationRecordId).toBe(
      target.recordId,
    )
    expect(feedbackFor(output, second.recordId)?.registrationRecordId).toBe(
      target.recordId,
    )
    expect(feedbackFor(output, first.recordId)?.matchMethod).toBe('qr_identity')
    expect(feedbackFor(output, second.recordId)?.matchMethod).toBe(
      'manual_public_code',
    )
  })

  it('handles a QR and a manual response for one registration', () => {
    const target = registration()
    const output = run([target], [qrFeedback(target), manualFeedback(target)])

    expect(registrationFor(output, target.recordId)).toMatchObject({
      status: 'multiple_feedback',
      validFeedbackCount: 2,
    })
  })

  it('flags three responses just the same', () => {
    const target = registration()
    const output = run([target], [
      qrFeedback(target),
      qrFeedback(target),
      manualFeedback(target),
    ])

    expect(registrationFor(output, target.recordId)?.validFeedbackCount).toBe(3)
    expect(
      output.feedbackResults.every((result) => result.status === 'multiple_feedback'),
    ).toBe(true)
  })
})

describe('determinism', () => {
  it('produces the same classifications whatever the input order', () => {
    const registrations = Array.from({ length: 20 }, () => registration())
    const feedback = [
      ...registrations.slice(0, 10).map((target) => qrFeedback(target)),
      ...registrations.slice(5, 12).map((target) => manualFeedback(target)),
      qrFeedback(registrations[0] as ReconciliationRegistration, {
        publicCode: (registrations[1] as ReconciliationRegistration).publicCode,
      }),
    ]

    const forwards = run([...registrations], [...feedback])
    const backwards = run([...registrations].reverse(), [...feedback].reverse())

    expect(backwards.registrationResults).toEqual(forwards.registrationResults)
    expect(backwards.feedbackResults).toEqual(forwards.feedbackResults)
    expect(backwards.duplicateCandidates).toEqual(forwards.duplicateCandidates)
    expect(backwards.counts).toEqual(forwards.counts)
  })

  it('is stable across repeated runs of identical input', () => {
    const registrations = Array.from({ length: 5 }, () => registration())
    const feedback = registrations.map((target) => qrFeedback(target))

    expect(run(registrations, feedback)).toEqual(run(registrations, feedback))
  })

  it('records the engine version', () => {
    /*
     * v2 since contact identity landed. Pinned to a literal deliberately:
     * asserting against the imported constant would pass whatever it said, and
     * the point of this test is that changing the rules is a decision somebody
     * has to make in two places. A run is only interpretable against the rules
     * that produced it.
     */
    expect(run([]).engineVersion).toBe('reconciliation-v2')
  })
})

describe('out-of-order arrival', () => {
  it('resolves on a later run once the registration arrives', () => {
    /*
     * Two legitimate historical snapshots. The first is not wrong, at that
     * moment the Point A device genuinely had not synced.
     */
    const target = registration()
    const feedback = manualFeedback(target)

    const first = run([], [feedback])
    expect(feedbackFor(first, feedback.recordId)?.status).toBe('without_registration')

    const second = run([target], [feedback])
    expect(feedbackFor(second, feedback.recordId)).toMatchObject({
      status: 'matched',
      registrationRecordId: target.recordId,
    })

    // The earlier snapshot is untouched by the later one.
    expect(feedbackFor(first, feedback.recordId)?.status).toBe('without_registration')
  })
})

describe('duplicate registration candidates', () => {
  const CONTACT = { phone: '+91 98765 43210', email: 'test@example.com' }

  it('pairs registrations sharing both phone and email', () => {
    const first = registration(CONTACT)
    const second = registration(CONTACT)

    const output = run([first, second])

    expect(output.duplicateCandidates).toHaveLength(1)
    expect(output.duplicateCandidates[0]?.matchBasis).toBe('phone_and_email')
  })

  it('emits only the strongest basis for a pair', () => {
    // A reviewer should see one candidate, not three.
    const first = registration(CONTACT)
    const second = registration(CONTACT)

    const bases = run([first, second]).duplicateCandidates.map((c) => c.matchBasis)

    expect(bases).toEqual(['phone_and_email'])
    expect(bases).not.toContain('phone_only')
    expect(bases).not.toContain('email_only')
  })

  it('treats formatted phone variants as the same number', () => {
    const first = registration({ phone: '+91 98765 43210', email: 'a@example.com' })
    const second = registration({ phone: '919876543210', email: 'b@example.com' })

    expect(run([first, second]).duplicateCandidates).toEqual([
      {
        leftRegistrationRecordId: [first.recordId, second.recordId].sort()[0],
        rightRegistrationRecordId: [first.recordId, second.recordId].sort()[1],
        matchBasis: 'phone_only',
      },
    ])
  })

  it('treats email case and surrounding space as the same address', () => {
    const first = registration({ phone: '+44 1111 111111', email: 'Test@Example.com' })
    const second = registration({ phone: '+44 2222 222222', email: ' test@example.com ' })

    expect(run([first, second]).duplicateCandidates[0]?.matchBasis).toBe('email_only')
  })

  it('pairs on phone alone', () => {
    const first = registration({ phone: '5550101234', email: 'one@example.com' })
    const second = registration({ phone: '555 010 1234', email: 'two@example.com' })

    expect(run([first, second]).duplicateCandidates[0]?.matchBasis).toBe('phone_only')
  })

  it('does not pair on name', () => {
    // Names are not a matching key: too many people share one.
    const first = registration({ phone: '1111111', email: 'a@example.com' })
    const second = registration({ phone: '2222222', email: 'b@example.com' })

    expect(run([first, second]).duplicateCandidates).toEqual([])
  })

  it('emits a pair once, canonically ordered', () => {
    const first = registration(CONTACT)
    const second = registration(CONTACT)

    const forwards = run([first, second]).duplicateCandidates
    const backwards = run([second, first]).duplicateCandidates

    expect(forwards).toEqual(backwards)
    expect(forwards[0]?.leftRegistrationRecordId).toBe(
      [first.recordId, second.recordId].sort()[0],
    )
  })

  it('emits every pair in a group of three', () => {
    const shared = { phone: '5550109999', email: 'shared@example.com' }
    const output = run([
      registration(shared),
      registration(shared),
      registration(shared),
    ])

    expect(output.duplicateCandidates).toHaveLength(3)
    expect(
      output.duplicateCandidates.every((c) => c.matchBasis === 'phone_and_email'),
    ).toBe(true)
  })

  it('ignores blank contact values rather than grouping on emptiness', () => {
    // Two registrations with no digits in their phone are not a candidate pair.
    const first = registration({ phone: 'n/a', email: 'a@example.com' })
    const second = registration({ phone: '--', email: 'b@example.com' })

    expect(run([first, second]).duplicateCandidates).toEqual([])
  })

  it('does not infer a missing country code', () => {
    // `+91 98765 43210` and `9876543210` may be different people entirely.
    const first = registration({ phone: '+91 98765 43210', email: 'a@example.com' })
    const second = registration({ phone: '9876543210', email: 'b@example.com' })

    expect(run([first, second]).duplicateCandidates).toEqual([])
  })

  it('applies no provider-specific email rules', () => {
    // Gmail dots and +tags are meaningful at some providers and not others.
    const first = registration({ phone: '1111111', email: 'first.last@gmail.com' })
    const second = registration({ phone: '2222222', email: 'firstlast@gmail.com' })
    const tagged = registration({ phone: '3333333', email: 'first.last+event@gmail.com' })

    expect(run([first, second, tagged]).duplicateCandidates).toEqual([])
  })
})

describe('normalisation', () => {
  it('reduces a phone number to its digits', () => {
    expect(normalizePhone('+44 (0)20 7946-0958')).toBe('4402079460958')
    expect(normalizePhone('919876543210')).toBe('919876543210')
    expect(normalizePhone('n/a')).toBe('')
  })

  it('trims and lower-cases an email', () => {
    expect(normalizeEmail('  Test@Example.COM ')).toBe('test@example.com')
  })
})

describe('run invariants', () => {
  it('gives every registration and every feedback exactly one result', () => {
    const registrations = Array.from({ length: 12 }, () => registration())
    const feedback = [
      ...registrations.slice(0, 6).map((target) => qrFeedback(target)),
      ...registrations.slice(0, 2).map((target) => manualFeedback(target)),
      manualFeedback(registration()),
    ]

    const output = run(registrations, feedback)

    expect(output.registrationResults).toHaveLength(registrations.length)
    expect(output.feedbackResults).toHaveLength(feedback.length)
    expect(
      new Set(output.registrationResults.map((r) => r.registrationRecordId)).size,
    ).toBe(registrations.length)
    expect(new Set(output.feedbackResults.map((r) => r.feedbackRecordId)).size).toBe(
      feedback.length,
    )
  })

  it('has registration statuses that sum to the source count', () => {
    const registrations = Array.from({ length: 15 }, () => registration())
    const feedback = [
      ...registrations.slice(0, 5).map((target) => qrFeedback(target)),
      ...registrations.slice(0, 3).map((target) => manualFeedback(target)),
    ]

    const { counts } = run(registrations, feedback)

    expect(
      counts.matchedRegistrations +
        counts.registrationsWithoutFeedback +
        counts.registrationsWithMultipleFeedback,
    ).toBe(counts.registrationCount)
    expect(counts.registrationCount).toBe(15)
  })

  it('has feedback statuses that sum to the source count', () => {
    const alice = registration()
    const bob = registration()
    const feedback = [
      qrFeedback(alice),
      manualFeedback(alice),
      qrFeedback(bob, { publicCode: alice.publicCode }),
      manualFeedback(registration()),
    ]

    const { counts } = run([alice, bob], feedback)

    expect(
      counts.matchedFeedback +
        counts.feedbackWithoutRegistration +
        counts.feedbackIdentityConflicts +
        counts.feedbackInMultipleGroups,
    ).toBe(counts.feedbackCount)
    expect(counts.feedbackCount).toBe(4)
  })

  it('handles an empty snapshot', () => {
    const output = run([], [])

    expect(output.counts.registrationCount).toBe(0)
    expect(output.counts.feedbackCount).toBe(0)
    expect(output.duplicateCandidates).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * Contact identity: the third path
 * ------------------------------------------------------------------ */

/**
 * A response whose identity is the rider's own details.
 *
 * Takes no registration, deliberately: this rider may never have been to
 * Point A, and a helper that required one would quietly make every test below
 * a test about somebody who had already registered.
 */
function contactFeedback(
  contact: { phone: string; email: string },
  overrides: Partial<ReconciliationFeedback> = {},
): ReconciliationFeedback {
  return {
    recordId: randomUUID(),
    captureMethod: 'contact',
    // No sticker, so neither identifier exists. Not empty strings: an empty
    // code would join against every other empty code.
    participantId: null,
    publicCode: null,
    respondentPhone: contact.phone,
    respondentEmail: contact.email,
    ...overrides,
  }
}

/** A registration whose contact details are known, for matching against. */
function registeredWith(contact: { phone: string; email: string }) {
  return registration({ phone: contact.phone, email: contact.email })
}

const RIDER = { phone: '9876543210', email: 'grace@example.com' }

describe('contact feedback: a unique match', () => {
  it('links to the one registration whose phone and email both match', () => {
    const target = registeredWith(RIDER)
    const feedback = contactFeedback(RIDER)

    const result = feedbackFor(run([target], [feedback]), feedback.recordId)

    expect(result).toMatchObject({
      status: 'matched',
      registrationRecordId: target.recordId,
      matchMethod: 'contact_identity',
    })
  })

  it('counts towards its registration, exactly like a scanned response', () => {
    const target = registeredWith(RIDER)
    const feedback = contactFeedback(RIDER)

    const output = run([target], [feedback])

    expect(registrationFor(output, target.recordId)).toMatchObject({
      status: 'matched',
      validFeedbackCount: 1,
    })
    expect(output.counts.matchedFeedback).toBe(1)
    expect(output.counts.standaloneFeedback).toBe(0)
  })

  it('matches through formatting differences, as duplicate detection does', () => {
    /*
     * The rider typed their number one way at Point A and another at Point B.
     * The same normalisation both places, from `normalize.ts`: strip
     * formatting, change nothing else. If these two rules ever diverged, the
     * engine could propose that two registrations are one person while
     * refusing to match a response to either.
     */
    const target = registration({
      phone: '+91 98765 43210',
      email: 'Grace@Example.com  ',
    })
    const feedback = contactFeedback({
      phone: '(98765) 43210',
      email: 'grace@example.com',
    })

    expect(normalizePhone(target.phone)).not.toBe(normalizePhone(feedback.respondentPhone as string))
    // Not equal as typed, and that is the point: a country code is never
    // inferred. This pair therefore does NOT match.
    expect(feedbackFor(run([target], [feedback]), feedback.recordId)).toMatchObject({
      status: 'standalone',
    })
  })

  it('matches when only formatting differs, country code included on both', () => {
    const target = registration({
      phone: '+91 98765 43210',
      email: '  Grace@Example.com ',
    })
    const feedback = contactFeedback({
      phone: '+91-98765-43210',
      email: 'grace@example.com',
    })

    expect(normalizePhone(target.phone)).toBe(
      normalizePhone(feedback.respondentPhone as string),
    )
    expect(normalizeEmail(target.email)).toBe(
      normalizeEmail(feedback.respondentEmail as string),
    )
    expect(feedbackFor(run([target], [feedback]), feedback.recordId)).toMatchObject({
      status: 'matched',
      matchMethod: 'contact_identity',
    })
  })
})

describe('contact feedback: what it refuses to match on', () => {
  it('does not match on the phone number alone', () => {
    /*
     * Families share phone numbers. This is not hypothetical: the duplicate
     * candidate detector in this same engine exists because the collision is
     * common enough to need reviewing.
     */
    const target = registration({
      phone: RIDER.phone,
      email: 'someone.else@example.com',
    })
    const feedback = contactFeedback(RIDER)

    expect(feedbackFor(run([target], [feedback]), feedback.recordId)).toMatchObject({
      status: 'standalone',
      registrationRecordId: null,
      matchMethod: null,
    })
  })

  it('does not match on the email alone', () => {
    // Couples share email accounts.
    const target = registration({ phone: '9000000001', email: RIDER.email })
    const feedback = contactFeedback(RIDER)

    expect(feedbackFor(run([target], [feedback]), feedback.recordId)).toMatchObject({
      status: 'standalone',
      registrationRecordId: null,
    })
  })

  it('does not match on the name, even an exactly equal one', () => {
    /*
     * Names are not identifiers. Two riders with the same name at one event is
     * a Tuesday, and a name match would attach one rider's opinion to the
     * other's registration with nothing on any screen to show it happened.
     *
     * The engine is not even given a name to match on: `ReconciliationFeedback`
     * has no respondent name field. This asserts the consequence.
     */
    const target = registration({
      phone: '9000000002',
      email: 'different@example.com',
    })
    const feedback = contactFeedback(RIDER)

    expect(feedbackFor(run([target], [feedback]), feedback.recordId)).toMatchObject({
      status: 'standalone',
      registrationRecordId: null,
    })
  })

  it('refuses to choose when two registrations share the exact pair', () => {
    /*
     * Both halves match, and match twice. There is genuinely no answer to which
     * rider this is, and picking the earlier one, or the one with more fields
     * filled in, would record a guess as a fact.
     */
    const first = registeredWith(RIDER)
    const second = registeredWith(RIDER)
    const feedback = contactFeedback(RIDER)

    const output = run([first, second], [feedback])

    expect(feedbackFor(output, feedback.recordId)).toMatchObject({
      status: 'identity_conflict',
      registrationRecordId: null,
      matchMethod: null,
    })
    // Neither registration is credited with a response.
    expect(registrationFor(output, first.recordId)?.validFeedbackCount).toBe(0)
    expect(registrationFor(output, second.recordId)?.validFeedbackCount).toBe(0)
    expect(output.counts.feedbackIdentityConflicts).toBe(1)
    expect(output.counts.standaloneFeedback).toBe(0)
  })

  it('flags the same two registrations as a possible duplicate person', () => {
    // The conflict above and this candidate are the same fact seen from two
    // sides, and an organiser needs both to understand what happened.
    const first = registeredWith(RIDER)
    const second = registeredWith(RIDER)

    const output = run([first, second], [contactFeedback(RIDER)])

    expect(output.duplicateCandidates).toHaveLength(1)
    expect(output.duplicateCandidates[0]?.matchBasis).toBe('phone_and_email')
  })
})

describe('standalone feedback', () => {
  it('is not the same finding as a sticker that resolved to nothing', () => {
    /*
     * The distinction this status exists for. Both have no registration; one is
     * the contact path working and the other is a code that led nowhere.
     * Folding them together would either bury real problems under valid
     * feedback, or put valid feedback under a heading that says something
     * broke.
     */
    const orphanSticker = manualFeedback(registration())
    const direct = contactFeedback(RIDER)

    const output = run([], [orphanSticker, direct])

    expect(feedbackFor(output, orphanSticker.recordId)?.status).toBe(
      'without_registration',
    )
    expect(feedbackFor(output, direct.recordId)?.status).toBe('standalone')
    expect(output.counts.feedbackWithoutRegistration).toBe(1)
    expect(output.counts.standaloneFeedback).toBe(1)
  })

  it('is never attributed to a registration', () => {
    const stranger = registration()
    const direct = contactFeedback(RIDER)

    const output = run([stranger], [direct])

    expect(feedbackFor(output, direct.recordId)).toMatchObject({
      registrationRecordId: null,
      matchMethod: null,
    })
    expect(registrationFor(output, stranger.recordId)).toMatchObject({
      status: 'without_feedback',
      validFeedbackCount: 0,
    })
  })

  it('does not move the registration counts at all', () => {
    // Coverage is a question about the registration list, and these riders are
    // not on it. They must not appear in either half of that fraction.
    const registered = registeredWith({ phone: '9111111111', email: 'a@b.com' })
    const withResponse = manualFeedback(registered)

    const output = run(
      [registered],
      [withResponse, contactFeedback(RIDER), contactFeedback({ phone: '9222222222', email: 'x@y.com' })],
    )

    expect(output.counts.registrationCount).toBe(1)
    expect(output.counts.matchedRegistrations).toBe(1)
    expect(output.counts.registrationsWithoutFeedback).toBe(0)
    expect(output.counts.standaloneFeedback).toBe(2)
    // Every response is still classified: nothing vanishes from a run.
    expect(output.counts.feedbackCount).toBe(3)
    expect(output.feedbackResults).toHaveLength(3)
  })

  it('is what a rider with unusable contact details gets, not a crash', () => {
    /*
     * Both fields are required at the desk and bounded on the wire, so a
     * response whose phone normalises to nothing should not exist. If one ever
     * does, it matches nobody rather than matching everybody: a key built from
     * one usable half and one empty one would group every registration missing
     * the same half and report conflicts between people who share only an
     * absence.
     */
    const target = registration({ phone: '   ', email: RIDER.email })
    const feedback = contactFeedback({ phone: '   ', email: RIDER.email })

    const output = run([target], [feedback])

    expect(feedbackFor(output, feedback.recordId)?.status).toBe('standalone')
    expect(registrationFor(output, target.recordId)?.validFeedbackCount).toBe(0)
  })
})

describe('contact feedback alongside the sticker paths', () => {
  it('leaves QR and manual classification untouched', () => {
    const alice = registeredWith({ phone: '9111111111', email: 'alice@example.com' })
    const bob = registeredWith({ phone: '9222222222', email: 'bob@example.com' })

    const scanned = qrFeedback(alice)
    const typed = manualFeedback(bob)
    const direct = contactFeedback(RIDER)

    const output = run([alice, bob], [scanned, typed, direct])

    expect(feedbackFor(output, scanned.recordId)).toMatchObject({
      status: 'matched',
      matchMethod: 'qr_identity',
    })
    expect(feedbackFor(output, typed.recordId)).toMatchObject({
      status: 'matched',
      matchMethod: 'manual_public_code',
    })
    expect(feedbackFor(output, direct.recordId)?.status).toBe('standalone')
  })

  it('joins the multiple-response group when a rider answers twice by two paths', () => {
    /*
     * One rider, a scanned response and a contact response that resolves to the
     * same registration. Two valid responses for one person: the existing rule
     * applies unchanged and no winner is chosen, whichever path produced them.
     */
    const target = registeredWith(RIDER)
    const scanned = qrFeedback(target)
    const direct = contactFeedback(RIDER)

    const output = run([target], [scanned, direct])

    expect(feedbackFor(output, scanned.recordId)?.status).toBe('multiple_feedback')
    expect(feedbackFor(output, direct.recordId)?.status).toBe('multiple_feedback')
    expect(registrationFor(output, target.recordId)).toMatchObject({
      status: 'multiple_feedback',
      validFeedbackCount: 2,
    })
    expect(output.counts.matchedFeedback).toBe(0)
    expect(output.counts.feedbackInMultipleGroups).toBe(2)
  })

  it('stays deterministic regardless of the order responses arrive in', () => {
    const target = registeredWith(RIDER)
    const responses = [
      contactFeedback(RIDER),
      qrFeedback(registeredWith({ phone: '9333333333', email: 'c@example.com' })),
      contactFeedback({ phone: '9444444444', email: 'd@example.com' }),
    ]

    const forwards = run([target], responses)
    const backwards = run([target], [...responses].reverse())

    expect(backwards.feedbackResults).toEqual(forwards.feedbackResults)
    expect(backwards.counts).toEqual(forwards.counts)
  })

  it('resolves on a later run once the registration syncs', () => {
    // The same out-of-order story the sticker paths have, by a different route:
    // the rider registered, and the Point A device had not uploaded yet.
    const target = registeredWith(RIDER)
    const direct = contactFeedback(RIDER)

    expect(feedbackFor(run([], [direct]), direct.recordId)?.status).toBe(
      'standalone',
    )
    expect(feedbackFor(run([target], [direct]), direct.recordId)).toMatchObject({
      status: 'matched',
      matchMethod: 'contact_identity',
      registrationRecordId: target.recordId,
    })
  })
})
