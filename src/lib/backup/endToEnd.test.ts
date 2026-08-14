import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, destroyTestDb } from '../../test/db'
import {
  getOrCreateDeviceId,
  peekDeviceId,
  type OfflineEventDb,
} from '../storage'
import { createEncryptedBackup } from './createBackup'
import { verifyBackupFile } from './verifyBackup'
import { restoreBackup } from './restore'
import { createSnapshot } from './snapshot'
import { BACKUP_FORMAT, backupFileName, MAX_BACKUP_FILE_BYTES } from './format'
import { makeFeedback, makeRegistration, seedDatabase } from './testFixtures'

/*
 * The whole recovery path, end to end: a device is backed up, the file is
 * verified as an operator would, and a replacement device restores it.
 *
 * A low KDF cost is used throughout. The production configuration is exercised
 * separately in crypto.test.ts; repeating 600,000 iterations here would add
 * minutes and prove nothing new about the backup format.
 */

const FAST = { iterations: 1_000 }
const PASSPHRASE = 'a passphrase of sufficient length'

let database: OfflineEventDb

beforeEach(() => {
  database = createTestDb()
})

afterEach(async () => {
  await destroyTestDb(database)
})

describe('backup, verify, restore', () => {
  it('recovers a device onto a replacement', async () => {
    await seedDatabase(database, { registrations: 8, feedbackFor: 5 })
    const sourceDeviceId = await peekDeviceId(database)

    const backup = await createEncryptedBackup(database, PASSPHRASE, FAST)
    expect(backup.ok).toBe(true)
    if (!backup.ok) {
      return
    }

    const verified = await verifyBackupFile(backup.contents, PASSPHRASE)
    expect(verified.ok).toBe(true)
    if (!verified.ok) {
      return
    }

    expect(verified.summary.registrations).toBe(8)
    expect(verified.summary.feedback).toBe(5)
    expect(verified.summary.sourceDeviceId).toBe(sourceDeviceId)

    const replacement = createTestDb()
    try {
      const replacementDeviceId = await getOrCreateDeviceId(replacement)

      const restored = await restoreBackup(replacement, verified.payload)
      expect(restored.ok && restored.counts.registrationsAdded).toBe(8)
      expect(restored.ok && restored.counts.feedbackAdded).toBe(5)

      expect(await replacement.registrations.count()).toBe(8)
      expect(await replacement.feedback.count()).toBe(5)
      // The replacement keeps its own identity; it does not become the source.
      expect(await peekDeviceId(replacement)).toBe(replacementDeviceId)
      expect(await peekDeviceId(replacement)).not.toBe(sourceDeviceId)
    } finally {
      await destroyTestDb(replacement)
    }
  })

  it('names the file with a timestamp and nothing else', async () => {
    await seedDatabase(database, { registrations: 1 })
    const backup = await createEncryptedBackup(database, PASSPHRASE, FAST)

    expect(backup.ok && backup.fileName).toMatch(
      /^offline-event-feedback_\d{8}T\d{6}Z\.oefbackup$/,
    )
  })

  it('derives the filename from the backup timestamp', () => {
    expect(backupFileName(new Date('2026-08-13T16:25:00.000Z'))).toBe(
      'offline-event-feedback_20260813T162500Z.oefbackup',
    )
  })

  it('rejects the wrong passphrase without revealing anything', async () => {
    await seedDatabase(database, { registrations: 2 })
    const backup = await createEncryptedBackup(database, PASSPHRASE, FAST)
    if (!backup.ok) {
      throw new Error('backup failed')
    }

    const verified = await verifyBackupFile(backup.contents, 'wrong passphrase')

    expect(verified.ok).toBe(false)
    expect(!verified.ok && verified.message).toContain('could not be unlocked')
  })

  it('rejects a tampered file', async () => {
    await seedDatabase(database, { registrations: 2 })
    const backup = await createEncryptedBackup(database, PASSPHRASE, FAST)
    if (!backup.ok) {
      throw new Error('backup failed')
    }

    const envelope = JSON.parse(backup.contents) as { ciphertext: string }
    const tampered = JSON.stringify({
      ...envelope,
      ciphertext: `A${envelope.ciphertext.slice(1)}`,
    })

    expect((await verifyBackupFile(tampered, PASSPHRASE)).ok).toBe(false)
  })

  it('rejects a truncated file', async () => {
    await seedDatabase(database, { registrations: 2 })
    const backup = await createEncryptedBackup(database, PASSPHRASE, FAST)
    if (!backup.ok) {
      throw new Error('backup failed')
    }

    const truncated = backup.contents.slice(0, backup.contents.length / 2)

    expect((await verifyBackupFile(truncated, PASSPHRASE)).ok).toBe(false)
  })

  it('rejects a file that is not a backup at all', async () => {
    expect((await verifyBackupFile('{"hello":"world"}', PASSPHRASE)).ok).toBe(false)
    expect((await verifyBackupFile('not json', PASSPHRASE)).ok).toBe(false)
  })

  it('refuses a file larger than the accepted limit', async () => {
    // Untrusted input: parsing an arbitrarily large string would take the tab
    // down before any validation ran.
    const oversized = `{"padding":"${'x'.repeat(MAX_BACKUP_FILE_BYTES + 16)}"}`

    const result = await verifyBackupFile(oversized, PASSPHRASE)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('too large')
  })

  it('verification imports nothing', async () => {
    await seedDatabase(database, { registrations: 3 })
    const backup = await createEncryptedBackup(database, PASSPHRASE, FAST)
    if (!backup.ok) {
      throw new Error('backup failed')
    }

    const replacement = createTestDb()
    try {
      await verifyBackupFile(backup.contents, PASSPHRASE)
      expect(await replacement.registrations.count()).toBe(0)
      expect(await replacement.feedback.count()).toBe(0)
    } finally {
      await destroyTestDb(replacement)
    }
  })
})

describe('the outer file leaks nothing', () => {
  it('contains no participant data before decryption', async () => {
    const registration = makeRegistration(1, {
      name: 'Grace Hopper',
      phone: '+1 555 010 1234',
      email: 'grace@example.com',
    })
    const feedback = makeFeedback(registration, {
      answers: {
        overall_rating: 5,
        experience: 'excellent',
        recommend: true,
        comments: 'The queue moved quickly',
      },
    })
    await database.registrations.add(registration)
    await database.feedback.add(feedback)
    await database.deviceConfig.put({
      key: 'deviceId',
      value: registration.deviceId,
      updatedAt: '2026-01-01T08:00:00.000Z',
    })

    const backup = await createEncryptedBackup(database, PASSPHRASE, FAST)
    if (!backup.ok) {
      throw new Error('backup failed')
    }

    const file = backup.contents

    for (const secret of [
      'Grace',
      'Hopper',
      '555 010 1234',
      '5550101234',
      'grace@example.com',
      'example.com',
      'The queue moved quickly',
      PASSPHRASE,
      registration.participantId,
      registration.publicCode,
    ]) {
      expect(file).not.toContain(secret)
    }
  })

  it('exposes only format and key-derivation metadata', async () => {
    await seedDatabase(database, { registrations: 2 })
    const backup = await createEncryptedBackup(database, PASSPHRASE, FAST)
    if (!backup.ok) {
      throw new Error('backup failed')
    }

    const envelope = JSON.parse(backup.contents) as Record<string, unknown>

    expect(Object.keys(envelope).sort()).toEqual([
      'cipher',
      'ciphertext',
      'format',
      'kdf',
      'version',
    ])
    expect(envelope['format']).toBe(BACKUP_FORMAT)
    // No event, no device, no counts: an unopened file says nothing about
    // whose data it holds or how much of it there is.
    expect(backup.contents).not.toContain('evt-dev-001')
    expect(backup.contents).not.toContain('registrations')
  })

  it('keeps nothing in the filename either', async () => {
    await seedDatabase(database, { registrations: 1 })
    const backup = await createEncryptedBackup(database, PASSPHRASE, FAST)
    if (!backup.ok) {
      throw new Error('backup failed')
    }

    // A filename is visible in a file manager long before a passphrase is typed.
    expect(backup.fileName).not.toMatch(/[A-Za-z]+@/)
    expect(backup.fileName).not.toContain('evt-')
  })
})

describe('backup is read-only with respect to operational data', () => {
  it('changes nothing on the source device', async () => {
    const { registrations, feedback } = await seedDatabase(database, {
      registrations: 4,
    })
    const deviceIdBefore = await peekDeviceId(database)
    const registrationsBefore = await database.registrations.toArray()
    const feedbackBefore = await database.feedback.toArray()
    const sequencesBefore = await database.sequences.toArray()

    await createEncryptedBackup(database, PASSPHRASE, FAST)

    expect(await peekDeviceId(database)).toBe(deviceIdBefore)
    expect(await database.registrations.toArray()).toEqual(registrationsBefore)
    expect(await database.feedback.toArray()).toEqual(feedbackBefore)
    expect(await database.sequences.toArray()).toEqual(sequencesBefore)
    expect(registrations).toHaveLength(4)
    expect(feedback).toHaveLength(4)
  })

  it('does not provision a device identity as a side effect', async () => {
    // A backup records where data came from; it must not create identity.
    await database.registrations.add(makeRegistration(1))

    await createEncryptedBackup(database, PASSPHRASE, FAST)

    expect(await peekDeviceId(database)).toBeUndefined()
  })
})

describe('refusing to back up inconsistent data', () => {
  it('will not produce a file from data that fails validation', async () => {
    /*
     * A backup of corrupt data is worse than none: it cannot be restored, and
     * the operator believes the device is protected.
     */
    const registration = makeRegistration(1)
    await database.registrations.add({
      ...registration,
      publicCode: `${registration.publicCode.slice(0, -1)}Z` as never,
    })

    const backup = await createEncryptedBackup(database, PASSPHRASE, FAST)

    expect(backup.ok).toBe(false)
    expect(!backup.ok && backup.message).toContain('failed validation')
  })

  it('reports structurally, without naming a participant', async () => {
    const registration = makeRegistration(1, { name: 'Grace Hopper' })
    await database.registrations.add({
      ...registration,
      participantId: 'not-a-uuid' as never,
    })

    const backup = await createEncryptedBackup(database, PASSPHRASE, FAST)

    expect(backup.ok).toBe(false)
    const issues = !backup.ok ? (backup.issues ?? []).join(' ') : ''
    expect(issues).toContain('invalid participantId')
    expect(issues).not.toContain('Grace')
  })
})

describe('snapshot consistency', () => {
  it('reads every store in one coherent view', async () => {
    await seedDatabase(database, { registrations: 6, feedbackFor: 4 })

    const snapshot = await createSnapshot(database)

    expect(snapshot.counts.registrations).toBe(6)
    expect(snapshot.counts.feedback).toBe(4)
    expect(snapshot.registrations).toHaveLength(6)
    expect(snapshot.feedback).toHaveLength(4)
    expect(snapshot.sequences).toHaveLength(1)
    expect(snapshot.deviceConfig).toHaveLength(1)
  })

  it('sorts deterministically, so two snapshots of one database match', async () => {
    await seedDatabase(database, { registrations: 5 })

    const first = await createSnapshot(database)
    const second = await createSnapshot(database)

    expect(first.registrations.map((r) => r.recordId)).toEqual(
      second.registrations.map((r) => r.recordId),
    )
    expect(first.feedback.map((r) => r.recordId)).toEqual(
      second.feedback.map((r) => r.recordId),
    )
  })
})

describe('campaign records survive a backup and restore', () => {
  const RIDER = {
    vehicle: 'Vehicle 2',
    interestedColour: 'Storm Black' as const,
    location: 'Prestige Tech Park',
    gender: 'Female' as const,
    testRideAt: '2026-01-01T10:30',
    drivingLicence: 'KA0120200001234',
    pincode: '560048',
  }

  const CAMPAIGN_ANSWERS = {
    testRideExperience: 7,
    rotaryKnobUsage: 6,
    rideModesExperience: 5,
    overallExperienceRating: 7,
    topThreeFeatures: 'Torque, brakes, the silence',
    overallExperienceComments: 'Brilliant',
  } as const

  it('carries every campaign field and answer to a replacement device', async () => {
    /*
     * The recovery this protects: a tablet dies mid-event and the replacement
     * must hold the same registrations, campaign answers included. A restore
     * that dropped the vehicle would leave the event with riders it cannot tell
     * apart by bike.
     */
    await seedDatabase(database, { registrations: 0 })
    const registration = makeRegistration(1, RIDER)
    const feedback = makeFeedback(registration, {
      formVersion: 'flying-flea-feedback-v1',
      answers: CAMPAIGN_ANSWERS,
    })
    await database.registrations.add(registration)
    await database.feedback.add(feedback)

    const file = await createEncryptedBackup(database, PASSPHRASE, FAST)
    expect(file.ok).toBe(true)
    if (!file.ok) {
      return
    }

    const replacement = createTestDb()
    try {
      await getOrCreateDeviceId(replacement)
      // Verified first, exactly as an operator would: the file is decrypted and
      // validated before a single record is written.
      const verified = await verifyBackupFile(file.contents, PASSPHRASE)
      expect(verified.ok).toBe(true)
      if (!verified.ok) {
        return
      }

      const result = await restoreBackup(replacement, verified.payload)
      expect(result.ok).toBe(true)

      const restored = await replacement.registrations.get(registration.recordId)
      expect(restored).toMatchObject(RIDER)

      const restoredFeedback = await replacement.feedback.get(feedback.recordId)
      expect(restoredFeedback?.formVersion).toBe('flying-flea-feedback-v1')
      expect(restoredFeedback?.answers).toEqual(CAMPAIGN_ANSWERS)
    } finally {
      await destroyTestDb(replacement)
    }
  })

  it('restores a file holding both questionnaires', async () => {
    // A device that worked a generic event and then the campaign holds records
    // of each. A restore that validated everything against one shape would
    // reject a perfectly good backup.
    await seedDatabase(database, { registrations: 0 })
    const first = makeRegistration(1, RIDER)
    const second = makeRegistration(2)
    const legacy = makeFeedback(first)
    const campaign = makeFeedback(second, {
      formVersion: 'flying-flea-feedback-v1',
      answers: CAMPAIGN_ANSWERS,
    })
    await database.registrations.bulkAdd([first, second])
    await database.feedback.bulkAdd([legacy, campaign])

    const file = await createEncryptedBackup(database, PASSPHRASE, FAST)
    expect(file.ok).toBe(true)
    if (!file.ok) {
      return
    }

    const replacement = createTestDb()
    try {
      await getOrCreateDeviceId(replacement)
      const verified = await verifyBackupFile(file.contents, PASSPHRASE)
      expect(verified.ok).toBe(true)
      if (!verified.ok) {
        return
      }

      const result = await restoreBackup(replacement, verified.payload)

      expect(result.ok).toBe(true)
      expect(await replacement.feedback.count()).toBe(2)
    } finally {
      await destroyTestDb(replacement)
    }
  })
})
