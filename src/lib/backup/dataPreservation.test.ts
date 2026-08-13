import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, destroyTestDb } from '../../test/db'
import { recordContextFor } from '../../config/recordContext'
import {
  createFeedback,
  createRegistration,
  getOrCreateDeviceId,
  peekDeviceId,
  type OfflineEventDb,
} from '../storage'
import { createEncryptedBackup } from './createBackup'
import { verifyBackupFile } from './verifyBackup'
import { restoreBackup } from './restore'

/*
 * Phase 5 must not break Phase 4.
 *
 * Backing up and verifying are read-only with respect to operational data, and
 * the device identity that survives service-worker installs and application
 * updates must survive these too.
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

/** Creates a registration and a feedback record the way the app does. */
async function captureRealRecords(database: OfflineEventDb) {
  const deviceId = await getOrCreateDeviceId(database)

  const registration = await createRegistration(database, {
    ...recordContextFor('registration', deviceId),
    name: 'Ada Lovelace',
    phone: '+44 20 7946 0958',
    email: 'ada@example.com',
  })

  const feedback = await createFeedback(database, {
    ...recordContextFor('feedback', deviceId),
    identity: {
      captureMethod: 'qr',
      publicCode: registration.publicCode,
      participantId: registration.participantId,
    },
    formVersion: 'feedback-v1',
    answers: { overall_rating: 5, experience: 'excellent', recommend: true },
  })

  return { deviceId, registration, feedback }
}

describe('backup does not disturb operational data', () => {
  it('leaves records and device identity exactly as they were', async () => {
    const { deviceId, registration, feedback } =
      await captureRealRecords(database)

    const backup = await createEncryptedBackup(database, PASSPHRASE, FAST)
    expect(backup.ok).toBe(true)
    if (!backup.ok) {
      return
    }

    await verifyBackupFile(backup.contents, PASSPHRASE)

    expect(await peekDeviceId(database)).toBe(deviceId)
    expect(await database.registrations.get(registration.recordId)).toEqual(
      registration,
    )
    expect(await database.feedback.get(feedback.recordId)).toEqual(feedback)
  })

  it('backs up records captured by the real Point A and Point B paths', async () => {
    const { registration, feedback } = await captureRealRecords(database)

    const backup = await createEncryptedBackup(database, PASSPHRASE, FAST)
    if (!backup.ok) {
      throw new Error('backup failed')
    }
    const verified = await verifyBackupFile(backup.contents, PASSPHRASE)

    expect(verified.ok).toBe(true)
    if (!verified.ok) {
      return
    }
    expect(verified.payload.registrations[0]).toEqual(registration)
    expect(verified.payload.feedback[0]).toEqual(feedback)
  })

  it('survives a full recovery onto a replacement device', async () => {
    const { registration, feedback } = await captureRealRecords(database)
    const sourceDeviceId = await peekDeviceId(database)

    const backup = await createEncryptedBackup(database, PASSPHRASE, FAST)
    if (!backup.ok) {
      throw new Error('backup failed')
    }
    const verified = await verifyBackupFile(backup.contents, PASSPHRASE)
    if (!verified.ok) {
      throw new Error('verification failed')
    }

    const replacement = createTestDb()
    try {
      const replacementDeviceId = await getOrCreateDeviceId(replacement)
      await restoreBackup(replacement, verified.payload)

      // The sticker the participant is wearing still resolves.
      const restored = await replacement.registrations.get(registration.recordId)
      expect(restored?.participantId).toBe(registration.participantId)
      expect(restored?.publicCode).toBe(registration.publicCode)
      expect(await replacement.feedback.get(feedback.recordId)).toEqual(feedback)

      // A new registration on the replacement belongs to the replacement.
      const fresh = await createRegistration(replacement, {
        ...recordContextFor('registration', replacementDeviceId),
        name: 'Grace Hopper',
        phone: '+1 555 010 1234',
        email: 'grace@example.com',
      })

      expect(fresh.deviceId).toBe(replacementDeviceId)
      expect(fresh.deviceId).not.toBe(sourceDeviceId)
      // A different issuer namespace, so its codes cannot collide with the
      // source device's if that machine ever comes back into service.
      expect(fresh.publicCode).not.toBe(registration.publicCode)
      expect(await peekDeviceId(replacement)).toBe(replacementDeviceId)
    } finally {
      await destroyTestDb(replacement)
    }
  })
})
