import type {
  DeviceConfigRow,
  SequenceRow,
} from '../storage'
import type {
  DeviceId,
  EventDay,
  EventId,
  FeedbackRecord,
  IsoTimestamp,
  RegistrationRecord,
} from '../../types'

/*
 * The backup file format.
 *
 * Two layers. The **envelope** is the plaintext outside of the encryption: only
 * what a reader needs to identify the format and derive the key. The
 * **payload** is everything else, and lives inside the ciphertext.
 *
 * The split is the privacy boundary. Anyone holding the file without the
 * passphrase learns that it is a backup of this application and nothing
 * further: no event, no device, no counts, and above all no participant.
 */

export const BACKUP_FORMAT = 'offline-event-feedback-backup'
export const BACKUP_FORMAT_VERSION = 1
export const BACKUP_FILE_EXTENSION = '.oefbackup'

/**
 * Largest restore file accepted, before any parsing or decryption.
 *
 * A 10,000-participant backup is roughly 5-8 MB of JSON, about a third larger
 * again after Base64. 64 MiB is comfortably above that and still small enough
 * that a hostile file cannot exhaust memory on a tablet.
 */
export const MAX_BACKUP_FILE_BYTES = 64 * 1024 * 1024

/** The plaintext outer layer. Deliberately says almost nothing. */
export interface BackupEnvelopeV1 {
  readonly format: typeof BACKUP_FORMAT
  readonly version: typeof BACKUP_FORMAT_VERSION
  readonly kdf: {
    readonly algorithm: 'PBKDF2'
    readonly hash: 'SHA-256'
    readonly iterations: number
    readonly salt: string
  }
  readonly cipher: {
    readonly algorithm: 'AES-GCM'
    readonly iv: string
  }
  readonly ciphertext: string
}

/** Everything of substance, only ever seen after successful decryption. */
export interface BackupPayloadV1 {
  readonly backupFormatVersion: typeof BACKUP_FORMAT_VERSION
  readonly backupId: string
  readonly createdAt: IsoTimestamp

  readonly application: {
    readonly version: string
    readonly buildId: string
  }

  readonly database: {
    readonly name: string
    readonly schemaVersion: number
  }

  readonly event: {
    readonly eventId: EventId
    readonly eventDay: EventDay
  }

  /** Provenance only. Restore never adopts this as its own identity. */
  readonly sourceDeviceId: DeviceId

  readonly counts: {
    readonly registrations: number
    readonly feedback: number
    readonly sequences: number
  }

  readonly registrations: readonly RegistrationRecord[]
  readonly feedback: readonly FeedbackRecord[]
  readonly sequences: readonly SequenceRow[]
  /**
   * Captured for diagnostics. **No key from here is ever imported**. See the
   * device identity rules in restore.ts.
   */
  readonly deviceConfig: readonly DeviceConfigRow[]
}

/** Operational metadata shown after verifying a file. Never any PII. */
export interface BackupSummary {
  readonly backupId: string
  readonly createdAt: IsoTimestamp
  readonly applicationVersion: string
  readonly applicationBuildId: string
  readonly schemaVersion: number
  readonly eventId: EventId
  readonly eventDay: EventDay
  readonly sourceDeviceId: DeviceId
  readonly registrations: number
  readonly feedback: number
  readonly sequences: number
}

export function summarise(payload: BackupPayloadV1): BackupSummary {
  return {
    backupId: payload.backupId,
    createdAt: payload.createdAt,
    applicationVersion: payload.application.version,
    applicationBuildId: payload.application.buildId,
    schemaVersion: payload.database.schemaVersion,
    eventId: payload.event.eventId,
    eventDay: payload.event.eventDay,
    sourceDeviceId: payload.sourceDeviceId,
    registrations: payload.registrations.length,
    feedback: payload.feedback.length,
    sequences: payload.sequences.length,
  }
}

/**
 * Filename for a generated backup.
 *
 * Carries a timestamp and nothing else. No participant name, no event detail:
 * a filename is visible in a file manager, an email client and a backup log,
 * long before anyone types a passphrase.
 */
export function backupFileName(createdAt: Date): string {
  const stamp = createdAt.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  return `offline-event-feedback_${stamp}${BACKUP_FILE_EXTENSION}`
}
