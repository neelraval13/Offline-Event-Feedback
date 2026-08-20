import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, destroyTestDb } from '../../test/db'
import { recordContextFor } from '../../config/recordContext'
import {
  createFeedback,
  createRegistration,
  getOrCreateDeviceId,
  updateRegistration,
  type OfflineEventDb,
} from '../storage'
import { chunkRecords, collectEligible, runSync } from './syncWorker'
import { storeSyncCredential } from './syncCredentials'
import { toFeedbackWire, toRegistrationWire } from './wire'
import {
  feedbackWireSchema,
  MAX_BATCH_RECORDS,
  SYNC_PROTOCOL_VERSION,
  type SyncBatch,
  type SyncBatchResponse,
  type SyncRecordResult,
} from '../../../shared/sync/protocol'
import type { SyncTransportResult } from './syncClient'
import type { FeedbackRecord, RegistrationRecord } from '../../types'

/*
 * The client outbox.
 *
 * The transport is injected, so these tests exercise batching, acknowledgement
 * handling and local state transitions without a network, which is where all
 * the decisions that matter actually live.
 */

let database: OfflineEventDb

beforeEach(async () => {
  database = createTestDb()
  await getOrCreateDeviceId(database)
  await storeSyncCredential({ eventId: 'evt-dev-001', token: 'test-token' }, database)
})

afterEach(async () => {
  await destroyTestDb(database)
  vi.restoreAllMocks()
})

async function captureRegistration(
  name = 'Ada Lovelace',
): Promise<RegistrationRecord> {
  const deviceId = await getOrCreateDeviceId(database)
  return createRegistration(database, {
    ...recordContextFor('registration', deviceId),
    name,
    phone: '+44 20 7946 0958',
    email: 'ada@example.com',
  })
}

async function captureFeedback(
  registration: RegistrationRecord,
): Promise<FeedbackRecord> {
  const deviceId = await getOrCreateDeviceId(database)
  return createFeedback(database, {
    ...recordContextFor('feedback', deviceId),
    identity: {
      captureMethod: 'qr',
      publicCode: registration.publicCode,
      participantId: registration.participantId,
    },
    formVersion: 'feedback-v1',
    answers: { overall_rating: 5, experience: 'excellent', recommend: true },
  })
}

/** A transport that answers with one status for every record it is given. */
function respondWith(
  status: SyncRecordResult['status'],
  code?: string,
): {
  send: (batch: SyncBatch) => Promise<SyncTransportResult<SyncBatchResponse>>
  batches: SyncBatch[]
} {
  const batches: SyncBatch[] = []

  return {
    batches,
    send: async (batch) => {
      batches.push(batch)
      return {
        ok: true,
        value: {
          protocolVersion: SYNC_PROTOCOL_VERSION,
          batchId: batch.batchId,
          results: batch.records.map((record) => ({
            recordId: record.recordId,
            status,
            ...(code === undefined ? {} : { code }),
          })),
        },
      }
    },
  }
}

describe('successful delivery', () => {
  it('marks an accepted registration synced', async () => {
    const record = await captureRegistration()
    const transport = respondWith('accepted')

    const outcome = await runSync({ database, send: transport.send })

    expect(outcome.synced).toBe(1)
    expect((await database.registrations.get(record.recordId))?.syncStatus).toBe(
      'synced',
    )
  })

  it('treats already_current as success', async () => {
    // The server holds this exact revision; there is nothing left to send.
    const registration = await captureRegistration()
    const feedback = await captureFeedback(registration)
    const transport = respondWith('already_current')

    await runSync({ database, send: transport.send })

    expect((await database.feedback.get(feedback.recordId))?.syncStatus).toBe(
      'synced',
    )
  })

  it('records when the record was delivered', async () => {
    const record = await captureRegistration()
    await runSync({ database, send: respondWith('accepted').send })

    const stored = await database.registrations.get(record.recordId)
    expect(stored?.lastSyncedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('does not resend a record that is already synced', async () => {
    await captureRegistration()
    await runSync({ database, send: respondWith('accepted').send })

    const second = respondWith('accepted')
    const outcome = await runSync({ database, send: second.send })

    expect(outcome.attempted).toBe(0)
    expect(second.batches).toHaveLength(0)
  })
})

describe('transport state is not a domain edit', () => {
  it('leaves revision and updatedAt untouched', async () => {
    /*
     * The invariant this whole module is shaped around. `updateRegistration`
     * increments revision on every call, so syncing through it would raise the
     * revision, the server would see a higher revision with identical contents,
     * and the two would ratchet against each other forever.
     */
    const record = await captureRegistration()
    await runSync({ database, send: respondWith('accepted').send })

    const stored = await database.registrations.get(record.recordId)
    expect(stored?.revision).toBe(record.revision)
    expect(stored?.updatedAt).toBe(record.updatedAt)
  })

  it('leaves identity untouched', async () => {
    const record = await captureRegistration()
    await runSync({ database, send: respondWith('accepted').send })

    const stored = await database.registrations.get(record.recordId)
    expect(stored?.recordId).toBe(record.recordId)
    expect(stored?.participantId).toBe(record.participantId)
    expect(stored?.publicCode).toBe(record.publicCode)
  })

  it('leaves feedback revision untouched', async () => {
    const registration = await captureRegistration()
    const feedback = await captureFeedback(registration)
    await runSync({ database, send: respondWith('accepted').send })

    const stored = await database.feedback.get(feedback.recordId)
    expect(stored?.revision).toBe(feedback.revision)
    expect(stored?.updatedAt).toBe(feedback.updatedAt)
  })
})

describe('transient failures leave records pending', () => {
  const failures = [
    { label: 'network unavailable', failure: 'unreachable' },
    { label: 'a timeout', failure: 'timeout' },
    { label: 'a server error', failure: 'server_error' },
  ] as const

  it.each(failures)('keeps records pending after $label', async ({ failure }) => {
    const record = await captureRegistration()

    const outcome = await runSync({
      database,
      send: async () => ({ ok: false, failure }),
    })

    expect(outcome.transportFailure).toBe(failure)
    expect(outcome.synced).toBe(0)
    // Nothing is known to be wrong with the record, so nothing is marked wrong.
    expect((await database.registrations.get(record.recordId))?.syncStatus).toBe(
      'pending',
    )
  })

  it('retries successfully once the server returns', async () => {
    const record = await captureRegistration()
    await runSync({ database, send: async () => ({ ok: false, failure: 'unreachable' }) })

    await runSync({ database, send: respondWith('accepted').send })

    expect((await database.registrations.get(record.recordId))?.syncStatus).toBe(
      'synced',
    )
  })

  it('stops after the first failed batch, leaving the rest pending', async () => {
    for (let i = 0; i < 150; i += 1) {
      await captureRegistration(`Participant ${i}`)
    }

    const outcome = await runSync({
      database,
      send: async () => ({ ok: false, failure: 'unreachable' }),
    })

    expect(outcome.batches).toBe(1)
    expect(
      (await database.registrations.where('syncStatus').equals('pending').count()),
    ).toBe(150)
  })
})

describe('hard outcomes park the record', () => {
  const hard = [
    { status: 'conflict', code: 'REVISION_CONFLICT' },
    { status: 'invalid', code: 'INVALID_RECORD' },
    { status: 'server_newer', code: undefined },
  ] as const

  it.each(hard)('marks $status as an error', async ({ status, code }) => {
    const record = await captureRegistration()

    const outcome = await runSync({
      database,
      send: respondWith(status, code).send,
    })

    expect(outcome.failed).toBe(1)
    const stored = await database.registrations.get(record.recordId)
    expect(stored?.syncStatus).toBe('error')
    expect(stored?.syncErrorCode).toBeDefined()
    // Still not a domain edit.
    expect(stored?.revision).toBe(record.revision)
  })

  it('does not resend a parked record on the next run', async () => {
    await captureRegistration()
    await runSync({ database, send: respondWith('conflict', 'X').send })

    const second = respondWith('accepted')
    await runSync({ database, send: second.send })

    expect(second.batches).toHaveLength(0)
  })

  it('stores a non-PII code', async () => {
    const record = await captureRegistration()
    await runSync({ database, send: respondWith('conflict', 'REVISION_CONFLICT').send })

    const stored = await database.registrations.get(record.recordId)
    expect(stored?.syncErrorCode).toBe('REVISION_CONFLICT')
    expect(stored?.syncErrorCode).not.toContain('Ada')
  })
})

describe('a lost response is harmless', () => {
  it('marks the record synced on the retry', async () => {
    /*
     * The highest-value case in the whole phase. The server commits, the
     * response never arrives, the device cannot tell the difference from a
     * request that was never received, so the record stays pending and is
     * sent again. Ingest is idempotent, so the retry answers already_current
     * and the device can finally stop.
     */
    const record = await captureRegistration()

    // Attempt one: committed centrally, but the answer is lost in transit.
    const lost = await runSync({
      database,
      send: async () => ({ ok: false, failure: 'unreachable' }),
    })
    expect(lost.synced).toBe(0)
    expect((await database.registrations.get(record.recordId))?.syncStatus).toBe(
      'pending',
    )

    // Attempt two: the server recognises the record it already holds.
    const retry = await runSync({ database, send: respondWith('already_current').send })

    expect(retry.synced).toBe(1)
    const stored = await database.registrations.get(record.recordId)
    expect(stored?.syncStatus).toBe('synced')
    // And no duplicate identity was minted anywhere along the way.
    expect(stored?.participantId).toBe(record.participantId)
    expect(await database.registrations.count()).toBe(1)
  })

  it('never leaves a record stranded in a syncing state', async () => {
    // There is no persisted `syncing`: a browser closed mid-request would
    // strand every record in it forever.
    await captureRegistration()

    const inFlight = runSync({
      database,
      send: async () => ({ ok: false, failure: 'timeout' }),
    })

    expect(
      await database.registrations.where('syncStatus').equals('syncing').count(),
    ).toBe(0)
    await inFlight
    expect(
      await database.registrations.where('syncStatus').equals('syncing').count(),
    ).toBe(0)
  })
})

describe('a corrected record syncs again', () => {
  it('returns to pending and uploads the higher revision', async () => {
    const record = await captureRegistration()
    await runSync({ database, send: respondWith('accepted').send })
    expect((await database.registrations.get(record.recordId))?.syncStatus).toBe(
      'synced',
    )

    // Point A's correction path raises the revision and re-queues the record.
    await updateRegistration(database, record.recordId, {
      email: 'corrected@example.com',
    })

    const stored = await database.registrations.get(record.recordId)
    expect(stored?.syncStatus).toBe('pending')
    expect(stored?.revision).toBe(record.revision + 1)

    const second = respondWith('accepted')
    await runSync({ database, send: second.send })

    const uploaded = second.batches[0]?.records[0]
    expect(uploaded?.revision).toBe(record.revision + 1)
    expect((await database.registrations.get(record.recordId))?.syncStatus).toBe(
      'synced',
    )
  })
})

describe('wire records', () => {
  it('carry no transport state', async () => {
    const record = await captureRegistration()
    await runSync({ database, send: respondWith('accepted').send })

    const synced = await database.registrations.get(record.recordId)
    const wire = toRegistrationWire(synced as RegistrationRecord) as Record<
      string,
      unknown
    >

    for (const field of ['syncStatus', 'lastSyncedAt', 'syncErrorCode']) {
      expect(field in wire).toBe(false)
    }
  })

  it('preserve the capturing device, not the uploader', async () => {
    /*
     * After a Phase 5 recovery this device uploads records captured elsewhere.
     * The wire record must keep the original provenance.
     */
    const sourceDevice = '11111111-2222-4333-8444-555555555555'
    const record = await captureRegistration()
    await database.registrations.put({
      ...record,
      deviceId: sourceDevice as never,
    })

    const restored = await database.registrations.get(record.recordId)
    const wire = toRegistrationWire(restored as RegistrationRecord)

    expect(wire.deviceId).toBe(sourceDevice)

    const transport = respondWith('accepted')
    await runSync({ database, send: transport.send })

    const uploaderDeviceId = transport.batches[0]?.uploaderDeviceId
    expect(uploaderDeviceId).not.toBe(sourceDevice)
    expect(transport.batches[0]?.records[0]?.deviceId).toBe(sourceDevice)
  })

  it('omit participantId for a manual capture', async () => {
    const registration = await captureRegistration()
    const deviceId = await getOrCreateDeviceId(database)
    const feedback = await createFeedback(database, {
      ...recordContextFor('feedback', deviceId),
      identity: { captureMethod: 'manual', publicCode: registration.publicCode },
      formVersion: 'feedback-v1',
      answers: { overall_rating: 3, experience: 'okay', recommend: false },
    })

    const wire = toFeedbackWire(feedback) as Record<string, unknown>
    expect('participantId' in wire).toBe(false)
  })

  it('carry the rider’s details, and only those, for a contact capture', async () => {
    const deviceId = await getOrCreateDeviceId(database)
    const feedback = await createFeedback(database, {
      ...recordContextFor('feedback', deviceId),
      identity: {
        captureMethod: 'contact',
        respondentName: 'Grace Hopper',
        respondentPhone: '9876543210',
        respondentEmail: 'grace@example.com',
      },
      formVersion: 'feedback-v1',
      answers: { overall_rating: 5, experience: 'excellent', recommend: true },
    })

    const wire = toFeedbackWire(feedback) as Record<string, unknown>

    expect(wire).toMatchObject({
      captureMethod: 'contact',
      respondentName: 'Grace Hopper',
      respondentPhone: '9876543210',
      respondentEmail: 'grace@example.com',
    })
    /*
     * Absent keys, not keys holding undefined. The server's identity check
     * refuses a contact record that carries either identifier, so a spread of
     * `undefined` would be a batch rejected in the field with no way to
     * diagnose it from the tablet.
     */
    expect('publicCode' in wire).toBe(false)
    expect('participantId' in wire).toBe(false)
  })

  it('validate against the shared wire contract, all three of them', async () => {
    /*
     * The client's mapper and the server's schema are the two halves of one
     * contract, and this is where they are checked against each other without a
     * network. A record this build produces that the server would refuse is a
     * record stranded on a tablet at an event.
     */
    const registration = await captureRegistration()
    const deviceId = await getOrCreateDeviceId(database)

    const identities = [
      {
        captureMethod: 'qr' as const,
        publicCode: registration.publicCode,
        participantId: registration.participantId,
      },
      { captureMethod: 'manual' as const, publicCode: registration.publicCode },
      {
        captureMethod: 'contact' as const,
        respondentName: 'Grace Hopper',
        respondentPhone: '9876543210',
        respondentEmail: 'grace@example.com',
      },
    ]

    for (const identity of identities) {
      const record = await createFeedback(database, {
        ...recordContextFor('feedback', deviceId),
        identity,
        formVersion: 'feedback-v1',
        answers: { overall_rating: 4, experience: 'good', recommend: true },
      })

      const parsed = feedbackWireSchema.safeParse(toFeedbackWire(record))
      expect(
        parsed.success ||
          parsed.error.issues.map((issue) => issue.message).join(' | '),
      ).toBe(true)
    }
  })
})

describe('enrolment gates syncing', () => {
  it('does nothing when the device is not enrolled', async () => {
    const fresh = createTestDb()
    try {
      await getOrCreateDeviceId(fresh)
      const outcome = await runSync({ database: fresh, send: respondWith('accepted').send })

      expect(outcome.enrolled).toBe(false)
      expect(outcome.attempted).toBe(0)
    } finally {
      await destroyTestDb(fresh)
    }
  })
})

describe('batching', () => {
  it('never exceeds the batch limit', () => {
    const records = Array.from({ length: 1_000 }, (_, i) => i)
    const batches = chunkRecords(records)

    expect(batches.every((batch) => batch.length <= MAX_BATCH_RECORDS)).toBe(true)
    expect(batches.flat()).toHaveLength(1_000)
  })

  it('sends every pending record exactly once per pass', async () => {
    for (let i = 0; i < 250; i += 1) {
      await captureRegistration(`Participant ${i}`)
    }

    const transport = respondWith('accepted')
    const outcome = await runSync({ database, send: transport.send })

    expect(outcome.batches).toBe(3)
    const sent = transport.batches.flatMap((batch) =>
      batch.records.map((record) => record.recordId),
    )
    expect(sent).toHaveLength(250)
    expect(new Set(sent).size).toBe(250)
  })

  it('collects registrations and feedback together', async () => {
    const registration = await captureRegistration()
    await captureFeedback(registration)

    const eligible = await collectEligible(database)

    expect(eligible).toHaveLength(2)
    expect(eligible.map((entry) => entry.kind).sort()).toEqual([
      'feedback',
      'registration',
    ])
  })
})
