import type { OfflineEventDb } from './db'
import { now } from './metadata'
import type {
  FeedbackRecord,
  IsoTimestamp,
  RecordId,
  RegistrationRecord,
  SyncStatus,
} from '../../types'

/*
 * Transport state.
 *
 * Delivery is not an edit. `revision` and `updatedAt` describe what a person
 * changed about a record; `syncStatus`, `lastSyncedAt` and `syncErrorCode`
 * describe whether it reached the server yet.
 *
 * These functions exist because `updateRegistration` unconditionally increments
 * `revision`. Marking a record synced through that path would raise its
 * revision, the server would then see a higher revision carrying identical
 * contents, and the two would ratchet against each other forever. Nothing here
 * touches `revision`, `updatedAt`, or any identity field.
 */

/** Stable, non-PII reason a record will not sync. */
export type SyncErrorCode = string

interface TransportPatch {
  readonly syncStatus: SyncStatus
  readonly lastSyncedAt?: IsoTimestamp
  readonly syncErrorCode?: SyncErrorCode
}

/**
 * Applies transport fields to a record.
 *
 * The previous error code is dropped first and only re-added when the new state
 * has one, so a record that syncs successfully does not keep a stale
 * explanation of a failure that no longer applies.
 */
function withTransport<T extends RegistrationRecord | FeedbackRecord>(
  existing: T,
  patch: TransportPatch,
): T {
  const { syncErrorCode: _previous, ...withoutError } = existing

  return {
    ...withoutError,
    syncStatus: patch.syncStatus,
    ...(patch.lastSyncedAt === undefined
      ? {}
      : { lastSyncedAt: patch.lastSyncedAt }),
    ...(patch.syncErrorCode === undefined
      ? {}
      : { syncErrorCode: patch.syncErrorCode }),
  } as T
}

async function patchRegistration(
  database: OfflineEventDb,
  recordId: RecordId,
  patch: TransportPatch,
): Promise<void> {
  await database.transaction('rw', database.registrations, async () => {
    const existing = await database.registrations.get(recordId)
    if (existing !== undefined) {
      await database.registrations.put(withTransport(existing, patch))
    }
  })
}

async function patchFeedback(
  database: OfflineEventDb,
  recordId: RecordId,
  patch: TransportPatch,
): Promise<void> {
  await database.transaction('rw', database.feedback, async () => {
    const existing = await database.feedback.get(recordId)
    if (existing !== undefined) {
      await database.feedback.put(withTransport(existing, patch))
    }
  })
}

export async function markRegistrationSynced(
  database: OfflineEventDb,
  recordId: RecordId,
): Promise<void> {
  await patchRegistration(database, recordId, {
    syncStatus: 'synced',
    lastSyncedAt: now(),
  })
}

export async function markRegistrationSyncError(
  database: OfflineEventDb,
  recordId: RecordId,
  code: SyncErrorCode,
): Promise<void> {
  await patchRegistration(database, recordId, {
    syncStatus: 'error',
    syncErrorCode: code,
  })
}

/** Returns a record to the outbox, used when a transient failure clears. */
export async function markRegistrationPending(
  database: OfflineEventDb,
  recordId: RecordId,
): Promise<void> {
  await patchRegistration(database, recordId, { syncStatus: 'pending' })
}

export async function markFeedbackSynced(
  database: OfflineEventDb,
  recordId: RecordId,
): Promise<void> {
  await patchFeedback(database, recordId, {
    syncStatus: 'synced',
    lastSyncedAt: now(),
  })
}

export async function markFeedbackSyncError(
  database: OfflineEventDb,
  recordId: RecordId,
  code: SyncErrorCode,
): Promise<void> {
  await patchFeedback(database, recordId, {
    syncStatus: 'error',
    syncErrorCode: code,
  })
}

export async function markFeedbackPending(
  database: OfflineEventDb,
  recordId: RecordId,
): Promise<void> {
  await patchFeedback(database, recordId, { syncStatus: 'pending' })
}
