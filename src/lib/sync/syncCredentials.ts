import { db, type OfflineEventDb } from '../storage'

/*
 * The device's synchronisation credential.
 *
 * Stored in `deviceConfig`, alongside the device identity, because it belongs
 * to this browser installation and nothing else.
 *
 * It is deliberately **excluded from backups**. A credential is not event data:
 * restoring it onto a replacement machine would hand a second device the first
 * one's upload identity, and a backup file would become a reusable server
 * credential in anyone's hands. A replacement enrols itself — see
 * `EXCLUDED_FROM_BACKUP_KEYS`.
 */

export const SYNC_TOKEN_KEY = 'syncDeviceToken'
export const SYNC_EVENT_KEY = 'syncEventId'
export const LAST_SYNC_ATTEMPT_KEY = 'lastSyncAttemptAt'
export const LAST_SYNC_SUCCESS_KEY = 'lastSyncSuccessAt'
export const LAST_SYNC_ERROR_KEY = 'lastSyncError'

/**
 * `deviceConfig` keys a backup must never carry.
 *
 * Only the credential. `deviceId` stays in the backup exactly as Phase 5
 * requires — it is provenance, and the payload records where data came from.
 */
export const EXCLUDED_FROM_BACKUP_KEYS: readonly string[] = [SYNC_TOKEN_KEY]

export interface SyncCredential {
  readonly eventId: string
  readonly token: string
}

export async function readSyncCredential(
  database: OfflineEventDb = db,
): Promise<SyncCredential | null> {
  const [token, eventId] = await Promise.all([
    database.deviceConfig.get(SYNC_TOKEN_KEY),
    database.deviceConfig.get(SYNC_EVENT_KEY),
  ])

  if (token === undefined || eventId === undefined) {
    return null
  }
  return { eventId: eventId.value, token: token.value }
}

export async function storeSyncCredential(
  credential: SyncCredential,
  database: OfflineEventDb = db,
): Promise<void> {
  const updatedAt = new Date().toISOString()

  await database.deviceConfig.bulkPut([
    { key: SYNC_TOKEN_KEY, value: credential.token, updatedAt },
    { key: SYNC_EVENT_KEY, value: credential.eventId, updatedAt },
  ])
}

export async function clearSyncCredential(
  database: OfflineEventDb = db,
): Promise<void> {
  await database.deviceConfig.bulkDelete([SYNC_TOKEN_KEY, SYNC_EVENT_KEY])
}

export interface SyncActivity {
  readonly lastAttemptAt: string | null
  readonly lastSuccessAt: string | null
  readonly lastError: string | null
}

export async function readSyncActivity(
  database: OfflineEventDb = db,
): Promise<SyncActivity> {
  const [attempt, success, error] = await Promise.all([
    database.deviceConfig.get(LAST_SYNC_ATTEMPT_KEY),
    database.deviceConfig.get(LAST_SYNC_SUCCESS_KEY),
    database.deviceConfig.get(LAST_SYNC_ERROR_KEY),
  ])

  return {
    lastAttemptAt: attempt?.value ?? null,
    lastSuccessAt: success?.value ?? null,
    lastError: error?.value ?? null,
  }
}

export async function recordSyncActivity(
  patch: { attemptAt?: string; successAt?: string; error?: string | null },
  database: OfflineEventDb = db,
): Promise<void> {
  const updatedAt = new Date().toISOString()
  const rows = []

  if (patch.attemptAt !== undefined) {
    rows.push({ key: LAST_SYNC_ATTEMPT_KEY, value: patch.attemptAt, updatedAt })
  }
  if (patch.successAt !== undefined) {
    rows.push({ key: LAST_SYNC_SUCCESS_KEY, value: patch.successAt, updatedAt })
  }
  if (patch.error !== undefined && patch.error !== null) {
    rows.push({ key: LAST_SYNC_ERROR_KEY, value: patch.error, updatedAt })
  }

  if (rows.length > 0) {
    await database.deviceConfig.bulkPut(rows)
  }
  if (patch.error === null) {
    await database.deviceConfig.delete(LAST_SYNC_ERROR_KEY)
  }
}
