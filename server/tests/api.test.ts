import { beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createApp } from '../app.js'
import { createMemoryStore, type MemoryStore } from './memoryStore.js'
import { hashDeviceToken } from '../auth/tokens.js'
import {
  batch,
  DEVICE_A,
  DEVICE_B,
  EVENT_ID,
  feedback,
  publicCodeFor,
  registration,
} from './fixtures.js'
import type {
  SyncBatch,
  SyncBatchResponse,
  SyncRecordResult,
} from '../../shared/sync/protocol.js'
import {
  MAX_BATCH_RECORDS,
  SYNC_PROTOCOL_VERSION,
} from '../../shared/sync/protocol.js'

const ENROLLMENT_SECRET = 'a-shared-enrolment-code'
const ORIGIN = 'http://localhost:5173'

let store: MemoryStore
let app: ReturnType<typeof createApp>

beforeEach(() => {
  store = createMemoryStore()
  app = createApp({
    store,
    enrollmentSecret: ENROLLMENT_SECRET,
    allowedOrigins: [ORIGIN],
    log: () => {},
  })
})

async function enroll(deviceId = DEVICE_A, secret = ENROLLMENT_SECRET) {
  return app.request('/v1/sync/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: EVENT_ID, deviceId, enrollmentSecret: secret }),
  })
}

async function enrolledToken(deviceId = DEVICE_A): Promise<string> {
  const response = await enroll(deviceId)
  const body = (await response.json()) as { deviceToken: string }
  return body.deviceToken
}

async function postBatch(
  token: string,
  payload: SyncBatch,
): Promise<{ status: number; body: SyncBatchResponse }> {
  const response = await app.request('/v1/sync/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as SyncBatchResponse,
  }
}

function statusOf(body: SyncBatchResponse, recordId: string): SyncRecordResult {
  const found = body.results.find((result) => result.recordId === recordId)
  if (found === undefined) {
    throw new Error('no result for record')
  }
  return found
}

describe('health', () => {
  it('reports status without leaking configuration', async () => {
    const response = await app.request('/health')
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body['status']).toBe('ok')
    // No connection string, no host, no schema detail.
    expect(JSON.stringify(body)).not.toMatch(/postgres|password|@|DATABASE/i)
  })
})

describe('enrolment', () => {
  it('issues a token for the correct enrolment code', async () => {
    const response = await enroll()
    const body = (await response.json()) as { deviceToken: string }

    expect(response.status).toBe(200)
    expect(body.deviceToken.length).toBeGreaterThanOrEqual(40)
  })

  it('stores only a hash of the token', async () => {
    const token = await enrolledToken()
    const stored = await store.findDevice(EVENT_ID, DEVICE_A)

    expect(stored?.tokenHash).toBe(hashDeviceToken(token))
    // The plaintext exists exactly once: in the response above.
    expect(JSON.stringify([...store.devices.values()])).not.toContain(token)
  })

  it('rejects a wrong enrolment code', async () => {
    const response = await enroll(DEVICE_A, 'not-the-code')

    expect(response.status).toBe(401)
    expect(store.devices.size).toBe(0)
  })

  it('gives the same answer however wrong the code is', async () => {
    // Never hint at how close a guess was.
    const almost = await enroll(DEVICE_A, ENROLLMENT_SECRET.slice(0, -1))
    const nothing = await enroll(DEVICE_A, 'x')

    expect(almost.status).toBe(nothing.status)
    expect(await almost.text()).toBe(await nothing.text())
  })

  it('rejects a malformed device id', async () => {
    const response = await app.request('/v1/sync/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: EVENT_ID,
        deviceId: 'not-a-uuid',
        enrollmentSecret: ENROLLMENT_SECRET,
      }),
    })

    expect(response.status).toBe(400)
  })

  it('re-enrolling replaces the previous token', async () => {
    const first = await enrolledToken()
    const second = await enrolledToken()

    expect(second).not.toBe(first)

    const rejected = await postBatch(first, batch([registration()]))
    expect(rejected.status).toBe(401)
  })
})

describe('authentication', () => {
  it('rejects a missing token', async () => {
    await enrolledToken()
    const response = await app.request('/v1/sync/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch([registration()])),
    })

    expect(response.status).toBe(401)
  })

  it('rejects a wrong token', async () => {
    await enrolledToken()
    const result = await postBatch('not-the-token', batch([registration()]))

    expect(result.status).toBe(401)
  })

  it('rejects a revoked device', async () => {
    const token = await enrolledToken()
    store.revoke(EVENT_ID, DEVICE_A)

    expect((await postBatch(token, batch([registration()]))).status).toBe(401)
  })

  it('rejects a batch for another event', async () => {
    const token = await enrolledToken()
    const result = await postBatch(
      token,
      batch([registration()], { eventId: 'evt-other' }),
    )

    expect(result.status).toBe(401)
  })

  it('rejects a batch claiming another uploader', async () => {
    const token = await enrolledToken(DEVICE_A)
    const result = await postBatch(
      token,
      batch([registration()], { uploaderDeviceId: DEVICE_B }),
    )

    expect(result.status).toBe(401)
  })

  it('rejects an unsupported protocol version', async () => {
    const token = await enrolledToken()
    const result = await postBatch(token, {
      ...batch([registration()]),
      protocolVersion: 2,
    } as unknown as SyncBatch)

    expect(result.status).toBe(400)
  })

  it('rejects a batch above the record limit', async () => {
    const token = await enrolledToken()
    const records = Array.from({ length: MAX_BATCH_RECORDS + 1 }, (_, i) =>
      registration({ publicCode: publicCodeFor(i + 1) }),
    )

    expect((await postBatch(token, batch(records))).status).toBe(400)
  })
})

describe('registration ingest', () => {
  it('accepts a new record', async () => {
    const token = await enrolledToken()
    const record = registration()

    const { body } = await postBatch(token, batch([record]))

    expect(statusOf(body, record.recordId)).toMatchObject({
      status: 'accepted',
      serverRevision: 1,
    })
    expect(store.registrations.size).toBe(1)
  })

  it('reports the same record again as already current', async () => {
    const token = await enrolledToken()
    const record = registration()

    await postBatch(token, batch([record]))
    const { body } = await postBatch(token, batch([record]))

    expect(statusOf(body, record.recordId).status).toBe('already_current')
    expect(store.registrations.size).toBe(1)
  })

  it('stays idempotent over ten deliveries', async () => {
    const token = await enrolledToken()
    const record = registration()

    for (let i = 0; i < 10; i += 1) {
      await postBatch(token, batch([record]))
    }

    expect(store.registrations.size).toBe(1)
    expect(store.registrations.get(record.recordId)?.revision).toBe(1)
  })

  it('accepts a higher revision and updates mutable fields', async () => {
    const token = await enrolledToken()
    const record = registration()
    await postBatch(token, batch([record]))

    const corrected = {
      ...record,
      email: 'corrected@example.com',
      revision: 2,
      updatedAt: '2026-01-01T10:00:00.000Z',
    }
    const { body } = await postBatch(token, batch([corrected]))

    expect(statusOf(body, record.recordId)).toMatchObject({
      status: 'accepted',
      serverRevision: 2,
    })
    expect(store.registrations.get(record.recordId)?.email).toBe(
      'corrected@example.com',
    )
  })

  it('rejects a higher revision that changes immutable identity', async () => {
    const token = await enrolledToken()
    const record = registration()
    await postBatch(token, batch([record]))

    const tampered = {
      ...record,
      participantId: randomUUID(),
      revision: 2,
    }
    const { body } = await postBatch(token, batch([tampered]))

    expect(statusOf(body, record.recordId)).toMatchObject({
      status: 'conflict',
      code: 'IMMUTABLE_FIELD_MISMATCH',
    })
    expect(store.registrations.get(record.recordId)?.participantId).toBe(
      record.participantId,
    )
  })

  it('refuses to guess when revisions match but contents differ', async () => {
    const token = await enrolledToken()
    const record = registration()
    await postBatch(token, batch([record]))

    const divergent = { ...record, email: 'other@example.com' }
    const { body } = await postBatch(token, batch([divergent]))

    expect(statusOf(body, record.recordId)).toMatchObject({
      status: 'conflict',
      code: 'REVISION_CONFLICT',
    })
    expect(store.registrations.get(record.recordId)?.email).toBe(record.email)
  })

  it('reports server_newer for a stale revision, without overwriting', async () => {
    const token = await enrolledToken()
    const record = registration()
    await postBatch(token, batch([{ ...record, revision: 3, email: 'new@example.com' }]))

    const { body } = await postBatch(token, batch([record]))

    expect(statusOf(body, record.recordId)).toMatchObject({
      status: 'server_newer',
      serverRevision: 3,
    })
    expect(store.registrations.get(record.recordId)?.email).toBe('new@example.com')
  })

  it('reports a conflict when another record claims the participant', async () => {
    const token = await enrolledToken()
    const first = registration()
    await postBatch(token, batch([first]))

    const impostor = registration({
      participantId: first.participantId,
      publicCode: publicCodeFor(2),
    })
    const { body } = await postBatch(token, batch([impostor]))

    expect(statusOf(body, impostor.recordId)).toMatchObject({
      status: 'conflict',
      code: 'PARTICIPANT_ALREADY_CLAIMED',
    })
    expect(store.registrations.size).toBe(1)
  })

  it('reports a conflict when another record claims the public code', async () => {
    const token = await enrolledToken()
    const first = registration()
    await postBatch(token, batch([first]))

    const impostor = registration({ publicCode: first.publicCode })
    const { body } = await postBatch(token, batch([impostor]))

    expect(statusOf(body, impostor.recordId)).toMatchObject({
      status: 'conflict',
      code: 'PUBLIC_CODE_ALREADY_CLAIMED',
    })
  })

  it('rejects a record belonging to another event', async () => {
    const token = await enrolledToken()
    const foreign = registration({ eventId: 'evt-other' })

    const { body } = await postBatch(token, batch([foreign]))

    expect(statusOf(body, foreign.recordId)).toMatchObject({
      status: 'invalid',
      code: 'WRONG_EVENT',
    })
  })
})

describe('feedback ingest', () => {
  it('accepts feedback before its registration exists', async () => {
    // The two devices upload independently; either may reach the server first.
    const token = await enrolledToken()
    const record = feedback()

    const { body } = await postBatch(token, batch([record]))

    expect(statusOf(body, record.recordId).status).toBe('accepted')
    expect(store.registrations.size).toBe(0)
  })

  it('accepts the registration afterwards', async () => {
    const token = await enrolledToken()
    const registrationRecord = registration()
    const feedbackRecord = feedback({
      publicCode: registrationRecord.publicCode,
      participantId: registrationRecord.participantId,
    })

    await postBatch(token, batch([feedbackRecord]))
    const { body } = await postBatch(token, batch([registrationRecord]))

    expect(statusOf(body, registrationRecord.recordId).status).toBe('accepted')
  })

  it('accepts manual feedback with no participant id', async () => {
    const token = await enrolledToken()
    const record = feedback({ captureMethod: 'manual' })

    const { body } = await postBatch(token, batch([record]))

    expect(statusOf(body, record.recordId).status).toBe('accepted')
    expect(store.feedback.get(record.recordId)?.participantId).toBeUndefined()
  })

  it('keeps two responses that share one public code', async () => {
    // Cross-device duplicates must stay representable for reconciliation.
    const token = await enrolledToken()
    const code = publicCodeFor(7)
    const fromB1 = feedback({ publicCode: code })
    const fromAnother = feedback({ publicCode: code, deviceId: DEVICE_B })

    const { body } = await postBatch(token, batch([fromB1, fromAnother]))

    expect(statusOf(body, fromB1.recordId).status).toBe('accepted')
    expect(statusOf(body, fromAnother.recordId).status).toBe('accepted')
    expect(store.feedback.size).toBe(2)
  })

  it('applies the same revision rules', async () => {
    const token = await enrolledToken()
    const record = feedback()
    await postBatch(token, batch([record]))

    expect(
      statusOf((await postBatch(token, batch([record]))).body, record.recordId)
        .status,
    ).toBe('already_current')

    const divergent = {
      ...record,
      answers: { ...record.answers, overall_rating: 1 as const },
    }
    expect(
      statusOf((await postBatch(token, batch([divergent]))).body, record.recordId)
        .status,
    ).toBe('conflict')
  })

  it('rejects a manual capture that claims a participant id', async () => {
    const token = await enrolledToken()
    const malformed = {
      ...feedback(),
      captureMethod: 'manual',
      participantId: randomUUID(),
    }

    // Rejected by the envelope schema: this is not a valid record at all.
    const result = await postBatch(token, batch([malformed as never]))
    expect(result.status).toBe(400)
  })
})

describe('restore-aware upload', () => {
  it('accepts records captured by another device', async () => {
    /*
     * The mandatory case. After a Phase 5 recovery, DEVICE_B holds records
     * captured by DEVICE_A and uploads them under its own credential.
     * Requiring record.deviceId to match the uploader would make recovered
     * data permanently unsyncable.
     */
    const token = await enrolledToken(DEVICE_B)
    const restored = registration({ deviceId: DEVICE_A })

    const { body } = await postBatch(
      token,
      batch([restored], { uploaderDeviceId: DEVICE_B }),
    )

    expect(statusOf(body, restored.recordId).status).toBe('accepted')

    const stored = store.registrations.get(restored.recordId)
    // Provenance preserved; delivery recorded separately.
    expect(stored?.deviceId).toBe(DEVICE_A)
    expect(stored?.lastUploaderDeviceId).toBe(DEVICE_B)
  })

  it('records the uploader that most recently delivered a record', async () => {
    const tokenA = await enrolledToken(DEVICE_A)
    const tokenB = await enrolledToken(DEVICE_B)
    const record = registration({ deviceId: DEVICE_A })

    await postBatch(tokenA, batch([record]))
    await postBatch(tokenB, batch([record], { uploaderDeviceId: DEVICE_B }))

    const stored = store.registrations.get(record.recordId)
    expect(stored?.deviceId).toBe(DEVICE_A)
    expect(stored?.lastUploaderDeviceId).toBe(DEVICE_B)
  })
})

describe('batch semantics', () => {
  it('commits the good records around one conflict', async () => {
    const token = await enrolledToken()

    const existing = registration({ publicCode: publicCodeFor(1) })
    await postBatch(token, batch([existing]))

    const fresh = Array.from({ length: 98 }, (_, i) =>
      registration({ publicCode: publicCodeFor(i + 10) }),
    )
    const alreadyCurrent = existing
    const conflicting = registration({
      ...existing,
      email: 'divergent@example.com',
    })

    const { body } = await postBatch(
      token,
      batch([...fresh, alreadyCurrent, conflicting]),
    )

    expect(body.results).toHaveLength(100)
    const tally = body.results.reduce<Record<string, number>>((counts, result) => {
      counts[result.status] = (counts[result.status] ?? 0) + 1
      return counts
    }, {})

    expect(tally['accepted']).toBe(98)
    expect(tally['already_current']).toBe(1)
    expect(tally['conflict']).toBe(1)
    // The 98 good records are safe on the server despite the conflict.
    expect(store.registrations.size).toBe(99)
  })

  it('returns one result per submitted record', async () => {
    const token = await enrolledToken()
    const records = Array.from({ length: 25 }, (_, i) =>
      registration({ publicCode: publicCodeFor(i + 1) }),
    )

    const { body } = await postBatch(token, batch(records))

    expect(body.results.map((r) => r.recordId).sort()).toEqual(
      records.map((r) => r.recordId).sort(),
    )
  })

  it('records a non-PII batch audit row', async () => {
    const token = await enrolledToken()
    await postBatch(token, batch([registration()]))

    expect(store.batches).toHaveLength(1)
    expect(store.batches[0]?.accepted).toBe(1)
  })
})

describe('concurrency', () => {
  it('produces one row and deterministic answers for simultaneous uploads', async () => {
    const tokenA = await enrolledToken(DEVICE_A)
    const tokenB = await enrolledToken(DEVICE_B)
    const record = registration()

    const [first, second] = await Promise.all([
      postBatch(tokenA, batch([record])),
      postBatch(tokenB, batch([record], { uploaderDeviceId: DEVICE_B })),
    ])

    expect(store.registrations.size).toBe(1)

    // One wins the insert; the other sees the identical row and acknowledges.
    const statuses = [
      statusOf(first.body, record.recordId).status,
      statusOf(second.body, record.recordId).status,
    ].sort()
    expect(statuses).toEqual(['accepted', 'already_current'])
  })

  it('never duplicates under repeated concurrent delivery', async () => {
    const token = await enrolledToken()
    const record = registration()

    await Promise.all(
      Array.from({ length: 8 }, () => postBatch(token, batch([record]))),
    )

    expect(store.registrations.size).toBe(1)
    expect(store.registrations.get(record.recordId)?.revision).toBe(1)
  })
})

describe('responses carry no participant data', () => {
  it('returns outcomes only', async () => {
    const token = await enrolledToken()
    const record = registration()
    const feedbackRecord = feedback({ comments: 'a memorable comment' } as never)

    const response = await app.request('/v1/sync/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(batch([record, feedbackRecord])),
    })
    const text = await response.text()

    for (const secret of [
      'Ada',
      'Lovelace',
      '7946',
      'ada@example.com',
      'Well organised',
    ]) {
      expect(text).not.toContain(secret)
    }
  })
})

describe('campaign fields on the wire', () => {
  const CAMPAIGN = {
    vehicle: 'Vehicle 2',
    interestedColour: 'Storm Black' as const,
    location: 'Prestige Tech Park',
    gender: 'Female' as const,
    testRideAt: '2026-01-01T10:30',
    drivingLicence: 'KA0120200001234',
    pincode: '560048',
  }

  it('accepts a registration carrying them', async () => {
    const token = await enrolledToken()
    const record = registration(CAMPAIGN)

    const { body } = await postBatch(token, batch([record]))

    expect(statusOf(body, record.recordId).status).toBe('accepted')
    expect(store.registrations.get(record.recordId)).toMatchObject(CAMPAIGN)
  })

  it('still accepts a registration without them', async () => {
    /*
     * A device that has not been updated, or a record captured before the
     * campaign existed and only now reaching the server. Making the fields
     * required would have stranded exactly those records.
     */
    const token = await enrolledToken()
    const record = registration()

    const { body } = await postBatch(token, batch([record]))

    expect(statusOf(body, record.recordId).status).toBe('accepted')
    expect(store.registrations.get(record.recordId)?.vehicle).toBeUndefined()
  })

  it('applies a correction to them at a higher revision', async () => {
    const token = await enrolledToken()
    const record = registration({ ...CAMPAIGN, vehicle: 'Vehicle 1' })
    await postBatch(token, batch([record]))

    const corrected = {
      ...record,
      vehicle: 'Vehicle 4',
      pincode: '560103',
      revision: 2,
      updatedAt: '2026-01-01T09:30:00.000Z',
    }
    const { body } = await postBatch(token, batch([corrected]))

    expect(statusOf(body, record.recordId)).toMatchObject({
      status: 'accepted',
      serverRevision: 2,
    })
    expect(store.registrations.get(record.recordId)).toMatchObject({
      vehicle: 'Vehicle 4',
      pincode: '560103',
    })
  })

  it('treats a campaign field changed at the same revision as a conflict', async () => {
    // Two devices holding the same revision but disagreeing about what was
    // captured. Accepting whichever arrived last would lose an edit silently.
    const token = await enrolledToken()
    const record = registration(CAMPAIGN)
    await postBatch(token, batch([record]))

    const { body } = await postBatch(
      token,
      batch([{ ...record, vehicle: 'Vehicle 4' }]),
    )

    expect(statusOf(body, record.recordId).status).toBe('conflict')
    expect(store.registrations.get(record.recordId)?.vehicle).toBe(
      CAMPAIGN.vehicle,
    )
  })

  it('rejects a test-ride time that is not a local date and time', async () => {
    const token = await enrolledToken()
    const record = registration({ testRideAt: '2026-01-01T10:30:00.000Z' })

    const { status } = await postBatch(token, batch([record]))

    // The schema takes the wall-clock form the campaign control produces; an
    // instant would mean the venue slot had been silently timezone-shifted.
    expect(status).toBe(400)
  })
})

describe('campaign feedback on the wire', () => {
  const CAMPAIGN_ANSWERS = {
    testRideExperience: 7,
    rotaryKnobUsage: 6,
    rideModesExperience: 5,
    overallExperienceRating: 7,
    topThreeFeatures: 'Torque',
    overallExperienceComments: 'Brilliant',
  } as const

  it('accepts a campaign response with its version and answers intact', async () => {
    const token = await enrolledToken()
    const record = feedback({
      formVersion: 'flying-flea-feedback-v1',
      answers: CAMPAIGN_ANSWERS,
    })

    const { body } = await postBatch(token, batch([record]))

    expect(statusOf(body, record.recordId).status).toBe('accepted')
    expect(store.feedback.get(record.recordId)).toMatchObject({
      formVersion: 'flying-flea-feedback-v1',
      answers: CAMPAIGN_ANSWERS,
    })
  })

  it('still accepts a feedback-v1 response', async () => {
    const token = await enrolledToken()
    const record = feedback()

    const { body } = await postBatch(token, batch([record]))

    expect(statusOf(body, record.recordId).status).toBe('accepted')
    expect(store.feedback.get(record.recordId)?.formVersion).toBe('feedback-v1')
  })

  it('refuses a record whose declared version and answers disagree', async () => {
    /*
     * The failure this closes: a record declaring the campaign questionnaire
     * while carrying the old one's answers parses cleanly if the two are
     * validated independently, and lands as a campaign response with no
     * campaign answers in it.
     */
    const token = await enrolledToken()
    const mismatched = feedback({ formVersion: 'flying-flea-feedback-v1' })

    const { status } = await postBatch(token, batch([mismatched]))

    expect(status).toBe(400)
    expect(store.feedback.size).toBe(0)
  })

  it('refuses a campaign rating outside 1-7', async () => {
    const token = await enrolledToken()
    const record = feedback({
      formVersion: 'flying-flea-feedback-v1',
      // Cast: the point of the test is that the runtime schema refuses it, and
      // the compile-time type is what stops it being written by accident.
      answers: { ...CAMPAIGN_ANSWERS, testRideExperience: 9 } as never,
    })

    const { status } = await postBatch(token, batch([record]))

    expect(status).toBe(400)
  })
})

describe('protocol v1 across mixed builds', () => {
  /*
   * Phase 9 added optional registration fields and a second questionnaire
   * without changing `SYNC_PROTOCOL_VERSION`. These tests are the evidence for
   * that decision, and for the one direction that is NOT supported, which is
   * documented in docs/flying-flea-campaign.md as a deployment gate.
   */

  it('accepts a pre-Phase-9 record from an older client', async () => {
    // The supported direction: old client, new server. A tablet that has not
    // been updated keeps working, including one carrying records captured
    // before the campaign existed.
    const token = await enrolledToken()
    const oldRegistration = registration()
    const oldFeedback = feedback()

    const { body } = await postBatch(
      token,
      batch([oldRegistration, oldFeedback]),
    )

    expect(statusOf(body, oldRegistration.recordId).status).toBe('accepted')
    expect(statusOf(body, oldFeedback.recordId).status).toBe('accepted')
  })

  it('accepts both builds in one batch', async () => {
    // An event mid-rollout: some tablets updated, some not, one operator
    // uploading from a device that restored a backup from each.
    const token = await enrolledToken()
    const old = registration()
    const current = registration({
      // A distinct public code: two registrations are two people.
      publicCode: publicCodeFor(2),
      vehicle: 'Vehicle 1',
      interestedColour: 'Flea Green' as const,
      location: 'Prestige Shantiniketan',
    })

    const { body } = await postBatch(token, batch([old, current]))

    expect(statusOf(body, old.recordId).status).toBe('accepted')
    expect(statusOf(body, current.recordId).status).toBe('accepted')
    expect(store.registrations.get(old.recordId)?.vehicle).toBeUndefined()
    expect(store.registrations.get(current.recordId)?.vehicle).toBe('Vehicle 1')
  })

  it('states the version it speaks, unchanged', () => {
    /*
     * Deliberately still 1. The changes were additive: optional fields a new
     * server ignores when absent, and a second `formVersion` an old server has
     * never seen. Bumping would have forced every device to be updated before
     * any could sync, mid-campaign, for no gain in either direction.
     *
     * The unsupported direction, a Phase 9 client against a pre-Phase 9 server,
     * cannot be prevented by a version number either: that server would
     * reject campaign feedback as an unknown form version and strand it on the
     * device. It is a deployment ordering rule, and it is written down.
     */
    expect(SYNC_PROTOCOL_VERSION).toBe(1)
  })
})
