import { EVENT_CONFIG } from '../../config/event'
import { APP_VERSION, BUILD_ID } from '../pwa/appVersion'
import { newRecordId } from '../identity/uuid'
import { DB_VERSION, type OfflineEventDb } from '../storage'
import { EXCLUDED_FROM_BACKUP_KEYS } from '../sync/syncCredentials'
import { deviceId as toDeviceId, isoTimestamp } from '../../types'
import type { BackupPayloadV1 } from './format'
import { BACKUP_FORMAT_VERSION } from './format'
import { validatePayload, type ValidationResult } from './validate'

/*
 * Reading the database as one coherent snapshot.
 *
 * All four stores are read inside a single Dexie read transaction. Querying
 * them one at a time would let a registration land between two reads, and the
 * backup would then hold a registration whose sequence counter had not moved:
 * a file that looks perfectly valid and quietly reissues a printed code on
 * restore.
 *
 * Nothing here touches the network, and nothing writes.
 */

/** Sorting keeps the plaintext stable between runs, and diffable by a human. */
function byKey<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => key(left).localeCompare(key(right)))
}

/**
 * Reads every store in one transaction and assembles the backup payload.
 *
 * The device ID is read from the same snapshot rather than provisioned here:
 * a backup records where the data came from, and must not create identity as a
 * side effect of being taken.
 */
export async function createSnapshot(
  database: OfflineEventDb,
): Promise<BackupPayloadV1> {
  return database.transaction(
    'r',
    database.registrations,
    database.feedback,
    database.sequences,
    database.deviceConfig,
    async (): Promise<BackupPayloadV1> => {
      const [registrations, feedback, sequences, deviceConfig] =
        await Promise.all([
          database.registrations.toArray(),
          database.feedback.toArray(),
          database.sequences.toArray(),
          database.deviceConfig.toArray(),
        ])

      const sortedRegistrations = byKey(registrations, (record) => record.recordId)
      const sortedFeedback = byKey(feedback, (record) => record.recordId)
      const sortedSequences = byKey(sequences, (row) => row.key)
      /*
       * The synchronisation credential is stripped before it can reach a file.
       *
       * A device token is not event data. Carrying it in a backup would make
       * the file a reusable server credential in anyone's hands, and restoring
       * it would hand a replacement machine the failed one's upload identity.
       * A replacement enrols itself. `deviceId` stays, exactly as Phase 5
       * requires; that is provenance, not a credential.
       */
      const sortedDeviceConfig = byKey(
        deviceConfig.filter(
          (row) => !EXCLUDED_FROM_BACKUP_KEYS.includes(row.key),
        ),
        (row) => row.key,
      )

      const storedDeviceId =
        sortedDeviceConfig.find((row) => row.key === 'deviceId')?.value ?? ''

      return {
        backupFormatVersion: BACKUP_FORMAT_VERSION,
        backupId: newRecordId(),
        createdAt: isoTimestamp(new Date().toISOString()),
        application: { version: APP_VERSION, buildId: BUILD_ID },
        database: { name: database.name, schemaVersion: DB_VERSION },
        event: {
          eventId: EVENT_CONFIG.eventId,
          eventDay: EVENT_CONFIG.eventDay,
        },
        sourceDeviceId: toDeviceId(storedDeviceId),
        counts: {
          registrations: sortedRegistrations.length,
          feedback: sortedFeedback.length,
          sequences: sortedSequences.length,
        },
        registrations: sortedRegistrations,
        feedback: sortedFeedback,
        sequences: sortedSequences,
        deviceConfig: sortedDeviceConfig,
      }
    },
  )
}

/**
 * Checks a snapshot before it is encrypted.
 *
 * Deliberately the same validator the restore path runs on untrusted files. If
 * the local database has drifted into a state this application would refuse to
 * restore, writing it to an encrypted file would only produce a backup that
 * cannot be used, worse, one the operator believes in.
 */
export function validateSnapshot(
  payload: BackupPayloadV1,
): ValidationResult<BackupPayloadV1> {
  return validatePayload(payload)
}
