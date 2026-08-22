/*
 * Invented data for the Device Admin concept.
 *
 * Nothing here reads IndexedDB, runs a sync, enrols a device, applies an
 * application update, or creates, verifies or restores a backup. There is no
 * `db`, no `runSync`, no `enrollDevice`, no `createEncryptedBackup`, no
 * `verifyBackupFile`, no `restoreBackup` and no `applyPendingUpdate`. The
 * concept renders these constants, which is what makes it safe to open on a
 * machine that also holds real event data.
 *
 * The shapes below deliberately mirror the real ones (`LocalCounts`,
 * `SyncActivity`, `BackupSummary`, `RestoreCounts`, `DatabaseStatus`) without
 * importing them, so the concept cannot accidentally acquire a dependency on a
 * module that owns behaviour. Where a figure exists in the real system it is
 * plausible; where it does not, it is not invented.
 *
 * No participant data of any kind: counts, timestamps and technical identifiers
 * only. A support screen never needs a name, and a screen facing a desk should
 * not have one on it.
 */

/** Counts, in the shape `getLocalCounts` returns. */
export interface ConceptCounts {
  readonly registrations: {
    readonly total: number
    readonly pending: number
    readonly synced: number
    readonly error: number
  }
  readonly feedback: {
    readonly total: number
    readonly pending: number
    readonly synced: number
    readonly error: number
  }
}

/** A quiet device at the end of a shift: everything delivered, nothing wrong. */
export const HEALTHY_COUNTS: ConceptCounts = {
  registrations: { total: 1284, pending: 0, synced: 1284, error: 0 },
  feedback: { total: 1109, pending: 0, synced: 1109, error: 0 },
}

/** Mid-shift on a venue with no usable network: safe, and undelivered. */
export const PENDING_COUNTS: ConceptCounts = {
  registrations: { total: 1284, pending: 12, synced: 1272, error: 0 },
  feedback: { total: 1109, pending: 3, synced: 1106, error: 0 },
}

/** The server accepted most of a batch and refused some of it. */
export const ERROR_COUNTS: ConceptCounts = {
  registrations: { total: 1284, pending: 0, synced: 1280, error: 4 },
  feedback: { total: 1109, pending: 0, synced: 1108, error: 1 },
}

export function pendingTotal(counts: ConceptCounts): number {
  return counts.registrations.pending + counts.feedback.pending
}

export function errorTotal(counts: ConceptCounts): number {
  return counts.registrations.error + counts.feedback.error
}

export function syncedTotal(counts: ConceptCounts): number {
  return counts.registrations.synced + counts.feedback.synced
}

/** Timestamps, already formatted. The concept does not read a clock. */
export const CONCEPT_LAST_SYNC_SUCCESS = '23 Aug 2026, 10:41'
export const CONCEPT_LAST_SYNC_ATTEMPT = '23 Aug 2026, 10:41'
export const CONCEPT_LAST_BACKUP_GENERATED = '23 Aug 2026, 09:58'
export const CONCEPT_LAST_BACKUP_VERIFIED = '23 Aug 2026, 10:02'

/** `describeAppVersion()` returns `version · buildId`. */
export const CONCEPT_APP_VERSION = '0.0.0 · 2026-08-22T09:14:03Z'

/** Technical facts, in the shape `useDeviceDiagnostics` reports them. */
export const CONCEPT_DEVICE = {
  deviceId: '582abddf-9b67-4218-9992-cd0d21a72409',
  databaseName: 'offline-event-feedback',
  databaseVersion: 8,
  databaseState: 'ready',
  eventId: 'ff-rc-2026-08-23',
  eventDay: '2026-08-23',
} as const

/** The real message `getDatabaseStatus` produces when the store will not open. */
export const CONCEPT_DB_ERROR =
  'QuotaExceededError: the database could not be opened'

/** Real wording from `SyncPanel`'s failure table. */
export const CONCEPT_UNREACHABLE =
  'Sync could not reach the central server. Your local records are safe and remain pending. Try again when connectivity is available.'

export const CONCEPT_UNAUTHORIZED =
  'This device is no longer authorised to sync. Enrol it again to continue.'

/** A verified backup, in the shape `BackupSummary` has. */
export const CONCEPT_BACKUP_SUMMARY = {
  createdAt: '23 Aug 2026, 09:58',
  eventId: 'ff-rc-2026-08-23',
  sourceDeviceId: 'f41d2c88-7b0a-4f6e-9a31-0c7e5b2d9a44',
  registrations: 1284,
  feedback: 1109,
  schemaVersion: 1,
} as const

export const CONCEPT_BACKUP_FILENAME =
  'ff-rc-2026-08-23-582abddf-20260823-0958.oefbackup'

/** A restore result, in the shape `RestoreCounts` has. */
export const CONCEPT_RESTORE_COUNTS = {
  registrationsAdded: 41,
  registrationsUpdated: 3,
  registrationsUnchanged: 1240,
  feedbackAdded: 28,
  feedbackUpdated: 0,
  feedbackUnchanged: 1081,
  sequencesMerged: 2,
} as const

/** Real wording from `BackupPanel`. */
export const CONCEPT_RESTORE_STOPPED =
  'The restore was stopped and nothing was imported. The existing records on this device are unchanged.'

export const CONCEPT_BACKUP_WRONG_PASSPHRASE =
  'That passphrase did not open this file, or the file is not a backup from this application.'

/** The minimum the real panel enforces. */
export const CONCEPT_MIN_PASSPHRASE = 12
