import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, destroyTestDb } from '../../test/db'
import type { OfflineEventDb } from '../storage/db'
import {
  createFeedback,
  createRegistration,
  getOrCreateDeviceId,
} from '../storage'
import { storeSyncCredential } from './syncCredentials'
import { collectEligible, runSync } from './syncWorker'
import { EVENT_CONFIG } from '../../config/event'
import {
  eventDay,
  eventId,
  stationId,
  type FeedbackRecord,
  type RegistrationRecord,
} from '../../types'
import type { SyncBatch } from '../../../shared/sync/protocol'

/*
 * A device holding two events' records, synced with one event's credential.
 *
 * This is the situation the rollover runbook exists to prevent, and this file
 * is what makes the software safe when somebody does not read it: a tablet that
 * ran the previous event, still holding records that never reached the server,
 * enrolled for the new event and synced.
 *
 * Without scoping, every one of those old records is put in a new-event batch,
 * refused per record by the server with `wrongEvent`, and marked with a
 * permanent error code that the new build can never clear. The records are not
 * deleted, but they are now behind an error state, and the operator has been
 * shown a failure that looks like a fault rather than like a step they skipped.
 *
 * The rule proved below is narrow and absolute: **records belonging to another
 * event are not eligible, and nothing happens to them at all.**
 */

const PREVIOUS_EVENT = 'ff-rc-2026-08-23'
const PREVIOUS_DAY = '2026-08-23'

let database: OfflineEventDb

beforeEach(async () => {
  database = createTestDb()
  await getOrCreateDeviceId(database)
  await storeSyncCredential(
    { eventId: EVENT_CONFIG.eventId, token: 'test-token' },
    database,
  )
})

afterEach(async () => {
  await destroyTestDb(database)
})

/** Provenance for one event or the other. */
async function contextFor(which: 'current' | 'previous') {
  const deviceId = await getOrCreateDeviceId(database)
  return which === 'current'
    ? {
        eventId: EVENT_CONFIG.eventId,
        eventDay: EVENT_CONFIG.eventDay,
        stationId: stationId('A1'),
        deviceId,
      }
    : {
        eventId: eventId(PREVIOUS_EVENT),
        eventDay: eventDay(PREVIOUS_DAY),
        stationId: stationId('A1'),
        deviceId,
      }
}

async function seedRegistration(
  which: 'current' | 'previous',
  name: string,
): Promise<RegistrationRecord> {
  return createRegistration(database, {
    ...(await contextFor(which)),
    name,
    phone: '9876543210',
    email: `${name.toLowerCase().replace(/\W/g, '')}@example.invalid`,
    vehicle: 'Vehicle 1',
    interestedColour: 'Flea Green',
    location: which === 'current' ? 'Bengaluru' : 'Richardson & Cruddas',
  })
}

async function seedFeedback(
  which: 'current' | 'previous',
  registration: RegistrationRecord,
): Promise<FeedbackRecord> {
  const context = await contextFor(which)
  return createFeedback(database, {
    ...context,
    stationId: stationId('B1'),
    // The store requires a city on every response it writes. The previous
    // event's real records predate the field, and the assertions below do not
    // depend on which value it holds, only that it is never touched.
    location: which === 'current' ? 'Bengaluru' : 'Hyderabad',
    identity: {
      captureMethod: 'qr',
      publicCode: registration.publicCode,
      participantId: registration.participantId,
    },
    formVersion: 'flying-flea-feedback-v1',
    answers: {
      testRideExperience: 6,
      rotaryKnobUsage: 5,
      rideModesExperience: 6,
      overallExperienceRating: 7,
    },
  })
}

/** A transport that accepts everything and records what it was asked to send. */
function acceptingTransport() {
  const batches: SyncBatch[] = []

  return {
    batches,
    send: async (batch: SyncBatch) => {
      batches.push(batch)
      return {
        ok: true as const,
        value: {
          batchId: batch.batchId,
          protocolVersion: 1 as const,
          results: batch.records.map((record) => ({
            recordId: record.recordId,
            status: 'accepted' as const,
          })),
        },
      }
    },
  }
}

/** The fields a sync run must never alter on a record it did not send. */
function operationalState(record: RegistrationRecord | FeedbackRecord) {
  return {
    syncStatus: record.syncStatus,
    revision: record.revision,
    updatedAt: record.updatedAt,
    lastSyncedAt: record.lastSyncedAt,
    syncErrorCode: record.syncErrorCode,
    eventId: record.eventId,
  }
}

describe('a device holding both events, synced for the current one', () => {
  it('sends exactly the current event’s records and nothing else', async () => {
    const oldRegistration = await seedRegistration('previous', 'August Rider')
    await seedFeedback('previous', oldRegistration)
    const newRegistration = await seedRegistration('current', 'September Rider')
    const newFeedback = await seedFeedback('current', newRegistration)

    const transport = acceptingTransport()
    const outcome = await runSync({ database, send: transport.send })

    // Two records attempted, out of four on the device.
    expect(outcome.attempted).toBe(2)
    expect(outcome.synced).toBe(2)
    expect(outcome.failed).toBe(0)
    expect(outcome.foreignEventRecords).toBe(2)

    const sent = transport.batches.flatMap((batch) => batch.records)
    expect(sent).toHaveLength(2)
    expect(sent.map((record) => record.recordId).sort()).toEqual(
      [newRegistration.recordId, newFeedback.recordId].sort(),
    )

    // And every record in every batch belongs to the batch's own event, which
    // is the invariant the server checks and refuses on.
    for (const batch of transport.batches) {
      expect(batch.eventId).toBe(EVENT_CONFIG.eventId)
      for (const record of batch.records) {
        expect(record.eventId).toBe(batch.eventId)
      }
    }
  })

  it('marks exactly the current event’s records as delivered', async () => {
    const oldRegistration = await seedRegistration('previous', 'August Rider')
    const oldFeedback = await seedFeedback('previous', oldRegistration)
    const newRegistration = await seedRegistration('current', 'September Rider')
    const newFeedback = await seedFeedback('current', newRegistration)

    await runSync({ database, send: acceptingTransport().send })

    expect(
      (await database.registrations.get(newRegistration.recordId))?.syncStatus,
    ).toBe('synced')
    expect((await database.feedback.get(newFeedback.recordId))?.syncStatus).toBe(
      'synced',
    )

    // The previous event's records are still waiting, which is the truth: no
    // server has been told about them.
    expect(
      (await database.registrations.get(oldRegistration.recordId))?.syncStatus,
    ).toBe('pending')
    expect((await database.feedback.get(oldFeedback.recordId))?.syncStatus).toBe(
      'pending',
    )
  })

  it('leaves the other event’s records operationally untouched', async () => {
    /*
     * The strongest form of the guarantee. Not merely "not marked in error":
     * not marked at all, not revised, not re-dated, not deleted, not rewritten.
     * These rows are somebody's registration and somebody's answers, and the
     * only safe thing a device configured for a different event can do with
     * them is nothing.
     */
    const oldRegistration = await seedRegistration('previous', 'August Rider')
    const oldFeedback = await seedFeedback('previous', oldRegistration)
    const newRegistration = await seedRegistration('current', 'September Rider')
    await seedFeedback('current', newRegistration)

    const before = {
      registration: operationalState(oldRegistration),
      feedback: operationalState(oldFeedback),
    }

    await runSync({ database, send: acceptingTransport().send })

    const afterRegistration = await database.registrations.get(
      oldRegistration.recordId,
    )
    const afterFeedback = await database.feedback.get(oldFeedback.recordId)

    expect(afterRegistration).toBeDefined()
    expect(afterFeedback).toBeDefined()
    expect(operationalState(afterRegistration!)).toEqual(before.registration)
    expect(operationalState(afterFeedback!)).toEqual(before.feedback)

    // Byte for byte, in fact: the whole record is unchanged.
    expect(afterRegistration).toEqual(oldRegistration)
    expect(afterFeedback).toEqual(oldFeedback)
  })

  it('never produces an error or a wrongEvent code for them', async () => {
    const oldRegistration = await seedRegistration('previous', 'August Rider')
    const oldFeedback = await seedFeedback('previous', oldRegistration)
    const newRegistration = await seedRegistration('current', 'September Rider')
    await seedFeedback('current', newRegistration)

    const outcome = await runSync({ database, send: acceptingTransport().send })

    expect(outcome.failed).toBe(0)

    for (const record of [
      await database.registrations.get(oldRegistration.recordId),
      await database.feedback.get(oldFeedback.recordId),
    ]) {
      expect(record?.syncStatus).not.toBe('error')
      expect(record?.syncErrorCode).toBeUndefined()
    }
  })

  it('reports nothing to do when only the other event has pending records', async () => {
    /*
     * A device that has been rolled over but has not yet taken a rider. There
     * is genuinely nothing for this event to send, and saying so is correct;
     * the foreign count is how the operator learns the rest is still there.
     */
    const oldRegistration = await seedRegistration('previous', 'August Rider')
    await seedFeedback('previous', oldRegistration)

    const transport = acceptingTransport()
    const outcome = await runSync({ database, send: transport.send })

    expect(outcome.attempted).toBe(0)
    expect(outcome.enrolled).toBe(true)
    expect(outcome.foreignEventRecords).toBe(2)
    expect(transport.batches).toHaveLength(0)
  })
})

describe('collecting eligible records', () => {
  it('partitions by the event asked for', async () => {
    const oldRegistration = await seedRegistration('previous', 'August Rider')
    await seedFeedback('previous', oldRegistration)
    const newRegistration = await seedRegistration('current', 'September Rider')
    await seedFeedback('current', newRegistration)

    const current = await collectEligible(database, EVENT_CONFIG.eventId)
    expect(current.eligible).toHaveLength(2)
    expect(current.foreignEventRecords).toBe(2)

    // Asked the other way round, the answer is the mirror image. The function
    // has no notion of a "right" event; the caller supplies it.
    const previous = await collectEligible(database, PREVIOUS_EVENT)
    expect(previous.eligible).toHaveLength(2)
    expect(previous.foreignEventRecords).toBe(2)
  })
})

describe('a credential for another event', () => {
  it('attempts nothing at all, not even this event’s records', async () => {
    /*
     * A device still holding the previous event's credential. It cannot upload
     * anything: the server authenticates the token against the event named in
     * the batch. Attempting would produce a guaranteed rejection and show the
     * operator a failure on a screen where nothing is broken yet.
     *
     * Note what is seeded: a perfectly good current-event record. Even that is
     * not sent, because the credential is not for this event.
     */
    await storeSyncCredential(
      { eventId: PREVIOUS_EVENT, token: 'stale-token' },
      database,
    )

    const registration = await seedRegistration('current', 'September Rider')
    const transport = acceptingTransport()

    const outcome = await runSync({ database, send: transport.send })

    expect(transport.batches).toHaveLength(0)
    expect(outcome.attempted).toBe(0)
    expect(outcome.enrolled).toBe(false)
    expect(outcome.transportFailure).toBe('event_mismatch')

    // And the record it could not send is still pending, not in error.
    expect(
      (await database.registrations.get(registration.recordId))?.syncStatus,
    ).toBe('pending')
  })
})
