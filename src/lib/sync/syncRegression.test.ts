import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, destroyTestDb } from '../../test/db'
import { recordContextFor } from '../../config/recordContext'
import {
  createRegistration,
  getOrCreateDeviceId,
  peekDeviceId,
  type OfflineEventDb,
} from '../storage'
import { createEncryptedBackup, restoreBackup, verifyBackupFile } from '../backup'
import {
  readSyncCredential,
  storeSyncCredential,
  SYNC_TOKEN_KEY,
} from './syncCredentials'
import { runSync } from './syncWorker'

/*
 * Phase 6 must not weaken Phases 4 and 5.
 *
 * The credential a device uses to upload is not event data. It must not travel
 * in a backup, and a replacement device must enrol on its own account.
 */

const PASSPHRASE = 'a passphrase of sufficient length'
const FAST = { iterations: 1_000 }
const DEVICE_TOKEN = 'Zm9yYmlkZGVuLXRva2VuLXZhbHVlLW5vdC1pbi1iYWNrdXBz'

let database: OfflineEventDb

beforeEach(async () => {
  database = createTestDb()
  await getOrCreateDeviceId(database)
})

afterEach(async () => {
  await destroyTestDb(database)
})

async function captureRegistration(): Promise<void> {
  const deviceId = await getOrCreateDeviceId(database)
  await createRegistration(database, {
    ...recordContextFor('registration', deviceId),
    name: 'Ada Lovelace',
    phone: '+44 20 7946 0958',
    email: 'ada@example.com',
  })
}

describe('backups never carry a sync credential', () => {
  it('excludes the device token from the decrypted payload', async () => {
    await captureRegistration()
    await storeSyncCredential(
      { eventId: 'evt-dev-001', token: DEVICE_TOKEN },
      database,
    )
    // The credential really is stored locally.
    expect((await readSyncCredential(database))?.token).toBe(DEVICE_TOKEN)

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

    // Not in the decrypted payload, and not under its key either.
    const payload = JSON.stringify(verified.payload)
    expect(payload).not.toContain(DEVICE_TOKEN)
    expect(payload).not.toContain(SYNC_TOKEN_KEY)
    expect(
      verified.payload.deviceConfig.some((row) => row.key === SYNC_TOKEN_KEY),
    ).toBe(false)
  })

  it('keeps the device identity in the backup, exactly as before', async () => {
    // Phase 5 behaviour is unchanged: deviceId is provenance, not a credential.
    await captureRegistration()
    await storeSyncCredential(
      { eventId: 'evt-dev-001', token: DEVICE_TOKEN },
      database,
    )
    const deviceId = await peekDeviceId(database)

    const backup = await createEncryptedBackup(database, PASSPHRASE, FAST)
    if (!backup.ok) {
      throw new Error('backup failed')
    }
    const verified = await verifyBackupFile(backup.contents, PASSPHRASE)
    if (!verified.ok) {
      throw new Error('verification failed')
    }

    expect(verified.payload.sourceDeviceId).toBe(deviceId)
    expect(
      verified.payload.deviceConfig.some((row) => row.key === 'deviceId'),
    ).toBe(true)
  })

  it('leaves a replacement device unenrolled after a restore', async () => {
    await captureRegistration()
    await storeSyncCredential(
      { eventId: 'evt-dev-001', token: DEVICE_TOKEN },
      database,
    )

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
      await getOrCreateDeviceId(replacement)
      await restoreBackup(replacement, verified.payload)

      // The records arrived; the credential did not.
      expect(await replacement.registrations.count()).toBe(1)
      expect(await readSyncCredential(replacement)).toBeNull()

      // And so the replacement cannot sync until an operator enrols it.
      const outcome = await runSync({
        database: replacement,
        send: async () => {
          throw new Error('must not attempt to send')
        },
      })
      expect(outcome.enrolled).toBe(false)
    } finally {
      await destroyTestDb(replacement)
    }
  })
})

describe('an unconfigured or unreachable server changes nothing locally', () => {
  it('leaves capture working when sync is not enrolled', async () => {
    // Phase 4's guarantee: nothing about startup or capture waits on a server.
    await captureRegistration()
    await captureRegistration()

    const outcome = await runSync({ database })

    expect(outcome.enrolled).toBe(false)
    expect(await database.registrations.count()).toBe(2)
  })

  it('leaves records untouched when the server is unreachable', async () => {
    await storeSyncCredential(
      { eventId: 'evt-dev-001', token: DEVICE_TOKEN },
      database,
    )
    await captureRegistration()
    const before = await database.registrations.toArray()

    await runSync({
      database,
      send: async () => ({ ok: false, failure: 'unreachable' }),
    })

    expect(await database.registrations.toArray()).toEqual(before)
  })
})
