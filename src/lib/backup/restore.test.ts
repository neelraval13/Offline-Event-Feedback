import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, destroyTestDb } from '../../test/db'
import type { OfflineEventDb } from '../storage'
import { getOrCreateDeviceId, peekDeviceId } from '../storage'
import { restoreBackup } from './restore'
import { createSnapshot } from './snapshot'
import {
  DESTINATION_DEVICE,
  makeFeedback,
  makePayload,
  makeRegistration,
  seedDatabase,
  SOURCE_DEVICE,
} from './testFixtures'
import { EVENT_CONFIG } from '../../config/event'
import { deriveIssuerCode } from '../identity/issuerCode'

let database: OfflineEventDb

beforeEach(() => {
  database = createTestDb()
})

afterEach(async () => {
  await destroyTestDb(database)
})

const SEQUENCE_KEY = `publicCode:${EVENT_CONFIG.eventId}:${EVENT_CONFIG.eventDay}:A1:${deriveIssuerCode(SOURCE_DEVICE)}`

describe('restoring into an empty database', () => {
  it('adds every record', async () => {
    const registration = makeRegistration(1)
    const feedback = makeFeedback(registration)

    const result = await restoreBackup(
      database,
      makePayload({ registrations: [registration], feedback: [feedback] }),
    )

    expect(result.ok && result.counts.registrationsAdded).toBe(1)
    expect(result.ok && result.counts.feedbackAdded).toBe(1)
    expect(await database.registrations.count()).toBe(1)
    expect(await database.feedback.count()).toBe(1)
  })

  it('preserves identity exactly as captured', async () => {
    // The participant is wearing a sticker printed from these values.
    const registration = makeRegistration(1)
    await restoreBackup(database, makePayload({ registrations: [registration] }))

    const stored = await database.registrations.get(registration.recordId)
    expect(stored?.participantId).toBe(registration.participantId)
    expect(stored?.publicCode).toBe(registration.publicCode)
    expect(stored?.recordId).toBe(registration.recordId)
  })

  it('preserves sync state rather than resetting it', async () => {
    // Phase 6 will define synchronisation; restore must not pre-empt it.
    const registration = makeRegistration(1, {
      syncStatus: 'synced',
      revision: 3,
      updatedAt: '2026-01-02T10:00:00.000Z' as never,
    })

    await restoreBackup(database, makePayload({ registrations: [registration] }))

    const stored = await database.registrations.get(registration.recordId)
    expect(stored?.syncStatus).toBe('synced')
    expect(stored?.revision).toBe(3)
    expect(stored?.updatedAt).toBe('2026-01-02T10:00:00.000Z')
  })
})

describe('restore is a merge, never a replace', () => {
  it('keeps local records the backup has never seen', async () => {
    // The whole reason restore does not clear: these are the records nobody
    // else has a copy of.
    const localOnly = makeRegistration(50, {}, DESTINATION_DEVICE)
    await database.registrations.add(localOnly)

    const fromBackup = makeRegistration(1)
    await restoreBackup(database, makePayload({ registrations: [fromBackup] }))

    expect(await database.registrations.count()).toBe(2)
    expect(await database.registrations.get(localOnly.recordId)).toBeDefined()
  })

  it('keeps local feedback the backup has never seen', async () => {
    const registration = makeRegistration(50, {}, DESTINATION_DEVICE)
    const localFeedback = makeFeedback(registration, {}, DESTINATION_DEVICE)
    await database.feedback.add(localFeedback)

    await restoreBackup(database, makePayload({ registrations: [] }))

    expect(await database.feedback.get(localFeedback.recordId)).toBeDefined()
  })
})

describe('merge rules', () => {
  it('skips a record that is already identical', async () => {
    const registration = makeRegistration(1)
    await database.registrations.add(registration)

    const result = await restoreBackup(
      database,
      makePayload({ registrations: [registration] }),
    )

    expect(result.ok && result.counts.registrationsUnchanged).toBe(1)
    expect(result.ok && result.counts.registrationsAdded).toBe(0)
  })

  it('takes the higher revision from the backup', async () => {
    const original = makeRegistration(1)
    await database.registrations.add(original)

    const corrected = {
      ...original,
      email: 'corrected@example.com',
      revision: 2,
      updatedAt: '2026-01-01T10:00:00.000Z' as never,
    }
    const result = await restoreBackup(
      database,
      makePayload({ registrations: [corrected] }),
    )

    expect(result.ok && result.counts.registrationsUpdated).toBe(1)
    expect((await database.registrations.get(original.recordId))?.email).toBe(
      'corrected@example.com',
    )
  })

  it('keeps the local record when it has the higher revision', async () => {
    // A backup older than the device it is restored onto must not roll it back.
    const backupVersion = makeRegistration(1)
    const localNewer = {
      ...backupVersion,
      email: 'newer@example.com',
      revision: 5,
      updatedAt: '2026-01-03T10:00:00.000Z' as never,
    }
    await database.registrations.add(localNewer)

    const result = await restoreBackup(
      database,
      makePayload({ registrations: [backupVersion] }),
    )

    expect(result.ok && result.counts.registrationsUnchanged).toBe(1)
    expect((await database.registrations.get(backupVersion.recordId))?.email).toBe(
      'newer@example.com',
    )
  })

  it('refuses to guess when revisions match but contents differ', async () => {
    const local = makeRegistration(1)
    await database.registrations.add(local)

    const conflicting = { ...local, email: 'different@example.com' }
    const result = await restoreBackup(
      database,
      makePayload({ registrations: [conflicting] }),
    )

    expect(result.ok).toBe(false)
    expect(!result.ok && result.conflicts.join(' ')).toContain(
      'same record ID and revision',
    )
    // Nothing overwritten.
    expect((await database.registrations.get(local.recordId))?.email).toBe(
      'ada@example.com',
    )
  })

  it('refuses when the same record ID has different identity', async () => {
    const local = makeRegistration(1)
    await database.registrations.add(local)

    const impostor = { ...makeRegistration(2), recordId: local.recordId }
    const result = await restoreBackup(
      database,
      makePayload({ registrations: [impostor] }),
    )

    expect(result.ok).toBe(false)
    expect(!result.ok && result.conflicts.join(' ')).toContain(
      'different identity or provenance',
    )
  })

  it('refuses when a participant already belongs to another local record', async () => {
    const local = makeRegistration(1)
    await database.registrations.add(local)

    const clashing = { ...makeRegistration(2), participantId: local.participantId }
    const result = await restoreBackup(
      database,
      makePayload({ registrations: [clashing] }),
    )

    expect(result.ok).toBe(false)
    expect(!result.ok && result.conflicts.join(' ')).toContain(
      'participant already exists locally',
    )
    expect(await database.registrations.count()).toBe(1)
  })

  it('refuses when a public code already belongs to another local record', async () => {
    const local = makeRegistration(1)
    await database.registrations.add(local)

    const clashing = { ...makeRegistration(2), publicCode: local.publicCode }
    const result = await restoreBackup(
      database,
      makePayload({ registrations: [clashing] }),
    )

    expect(result.ok).toBe(false)
    expect(!result.ok && result.conflicts.join(' ')).toContain(
      'public code already exists locally',
    )
  })

  it('merges feedback by record ID, allowing a shared public code', async () => {
    // Two devices may each hold a response for one participant. Both survive.
    const registration = makeRegistration(1)
    const fromThisDevice = makeFeedback(registration, {}, DESTINATION_DEVICE)
    await database.feedback.add(fromThisDevice)

    const fromBackup = makeFeedback(registration)
    const result = await restoreBackup(
      database,
      makePayload({ registrations: [registration], feedback: [fromBackup] }),
    )

    expect(result.ok).toBe(true)
    expect(await database.feedback.count()).toBe(2)
  })
})

describe('sequences take the maximum, never the backup value', () => {
  it('raises a lower local counter', async () => {
    await database.sequences.put({ key: SEQUENCE_KEY, value: 5 })

    await restoreBackup(
      database,
      makePayload({ sequences: [{ key: SEQUENCE_KEY, value: 42 }] }),
    )

    expect((await database.sequences.get(SEQUENCE_KEY))?.value).toBe(42)
  })

  it('never lowers a higher local counter', async () => {
    /*
     * The decisive rule. Lowering the counter would reissue public codes that
     * are already printed and on participants: the exact collision the
     * per-device issuer was built to eliminate.
     */
    await database.sequences.put({ key: SEQUENCE_KEY, value: 900 })

    await restoreBackup(
      database,
      makePayload({ sequences: [{ key: SEQUENCE_KEY, value: 42 }] }),
    )

    expect((await database.sequences.get(SEQUENCE_KEY))?.value).toBe(900)
  })

  it('inserts a counter the device has never had', async () => {
    const result = await restoreBackup(
      database,
      makePayload({ sequences: [{ key: SEQUENCE_KEY, value: 7 }] }),
    )

    expect(result.ok && result.counts.sequencesMerged).toBe(1)
    expect((await database.sequences.get(SEQUENCE_KEY))?.value).toBe(7)
  })
})

describe('device identity is never cloned', () => {
  it('leaves the destination device ID untouched', async () => {
    /*
     * The critical rule. If a restore adopted the source identity, two
     * independent offline machines would share a public-code issuer namespace
     * and start printing colliding codes.
     */
    const destinationDeviceId = await getOrCreateDeviceId(database)
    expect(destinationDeviceId).not.toBe(SOURCE_DEVICE)

    await restoreBackup(
      database,
      makePayload({ registrations: [makeRegistration(1)] }),
    )

    expect(await peekDeviceId(database)).toBe(destinationDeviceId)
  })

  it('imports no device configuration at all', async () => {
    await getOrCreateDeviceId(database)
    const before = await database.deviceConfig.toArray()

    await restoreBackup(
      database,
      makePayload({
        registrations: [makeRegistration(1)],
        deviceConfig: [
          { key: 'deviceId', value: SOURCE_DEVICE, updatedAt: '2026-01-01T00:00:00.000Z' },
          {
            key: 'lastBackupGeneratedAt',
            value: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    )

    expect(await database.deviceConfig.toArray()).toEqual(before)
  })

  it('keeps the source device on the restored records themselves', async () => {
    // Provenance is preserved: these records really were captured elsewhere.
    const registration = makeRegistration(1)
    await restoreBackup(database, makePayload({ registrations: [registration] }))

    expect((await database.registrations.get(registration.recordId))?.deviceId).toBe(
      SOURCE_DEVICE,
    )
  })
})

describe('atomicity', () => {
  it('imports nothing at all when one record conflicts', async () => {
    /*
     * 99 perfectly good records and one hard conflict. A partial restore would
     * leave a database nobody can reason about or safely retry.
     */
    const local = makeRegistration(1)
    await database.registrations.add(local)

    const good = Array.from({ length: 99 }, (_, i) => makeRegistration(i + 10))
    const conflicting = { ...local, email: 'different@example.com' }

    const result = await restoreBackup(
      database,
      makePayload({ registrations: [...good, conflicting] }),
    )

    expect(result.ok).toBe(false)
    // Only the pre-existing record remains: none of the 99 were written.
    expect(await database.registrations.count()).toBe(1)
  })

  it('leaves sequences untouched when the restore aborts', async () => {
    const local = makeRegistration(1)
    await database.registrations.add(local)
    await database.sequences.put({ key: SEQUENCE_KEY, value: 5 })

    await restoreBackup(
      database,
      makePayload({
        registrations: [{ ...local, email: 'different@example.com' }],
        sequences: [{ key: SEQUENCE_KEY, value: 999 }],
      }),
    )

    expect((await database.sequences.get(SEQUENCE_KEY))?.value).toBe(5)
  })

  it('leaves feedback untouched when a registration conflicts', async () => {
    const local = makeRegistration(1)
    await database.registrations.add(local)

    const registration = makeRegistration(2)
    await restoreBackup(
      database,
      makePayload({
        registrations: [{ ...local, email: 'different@example.com' }],
        feedback: [makeFeedback(registration)],
      }),
    )

    expect(await database.feedback.count()).toBe(0)
  })
})

describe('idempotency', () => {
  it('restoring the same backup twice changes nothing the second time', async () => {
    const registrations = Array.from({ length: 100 }, (_, i) =>
      makeRegistration(i + 1),
    )
    const feedback = registrations
      .slice(0, 90)
      .map((registration) => makeFeedback(registration))
    const payload = makePayload({ registrations, feedback })

    const first = await restoreBackup(database, payload)
    expect(first.ok && first.counts.registrationsAdded).toBe(100)
    expect(first.ok && first.counts.feedbackAdded).toBe(90)
    expect(await database.registrations.count()).toBe(100)
    expect(await database.feedback.count()).toBe(90)

    const second = await restoreBackup(database, payload)

    expect(second.ok && second.counts.registrationsAdded).toBe(0)
    expect(second.ok && second.counts.registrationsUnchanged).toBe(100)
    expect(second.ok && second.counts.feedbackAdded).toBe(0)
    expect(second.ok && second.counts.feedbackUnchanged).toBe(90)
    expect(await database.registrations.count()).toBe(100)
    expect(await database.feedback.count()).toBe(90)
  })

  it('is stable across a third restore', async () => {
    const payload = makePayload({ registrations: [makeRegistration(1)] })

    await restoreBackup(database, payload)
    await restoreBackup(database, payload)
    await restoreBackup(database, payload)

    expect(await database.registrations.count()).toBe(1)
  })
})

describe('round trip through a snapshot', () => {
  it('restores a snapshot of one device onto another', async () => {
    await seedDatabase(database, { registrations: 5 })
    const payload = await createSnapshot(database)

    const replacement = createTestDb()
    try {
      const replacementDeviceId = await getOrCreateDeviceId(replacement)
      const result = await restoreBackup(replacement, payload)

      expect(result.ok).toBe(true)
      expect(await replacement.registrations.count()).toBe(5)
      expect(await replacement.feedback.count()).toBe(5)
      // The replacement keeps its own identity.
      expect(await peekDeviceId(replacement)).toBe(replacementDeviceId)
    } finally {
      await destroyTestDb(replacement)
    }
  })
})
