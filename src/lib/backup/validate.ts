import { EVENT_CONFIG, stationFor } from '../../config/event'
import { isUuid } from '../identity/uuid'
import { parsePublicCode } from '../identity/publicCode'
import { DB_NAME, DB_VERSION } from '../storage'
import {
  EXPERIENCE_VALUES,
  FEEDBACK_FORM_VERSION,
  MAX_COMMENTS_LENGTH,
  OVERALL_RATINGS,
} from '../../types'
import type {
  DeviceConfigRow,
  SequenceRow,
} from '../storage'
import type { FeedbackRecord, RegistrationRecord, SyncStatus } from '../../types'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupEnvelopeV1,
  type BackupPayloadV1,
} from './format'
import {
  CIPHER_ALGORITHM,
  IV_BYTES,
  KDF_ALGORITHM,
  KDF_HASH,
  MAX_ACCEPTED_ITERATIONS,
  MIN_ACCEPTED_ITERATIONS,
  SALT_BYTES,
} from './crypto'
import { base64ToBytes } from './base64'

/*
 * Runtime validation of untrusted backup files.
 *
 * A restore file is a security boundary. It arrives from a USB stick, an email
 * attachment, a shared drive — anywhere — and `JSON.parse` succeeding says
 * nothing about whether it is safe to merge into a database holding an event's
 * records. So everything crosses this module as `unknown` and leaves as a typed
 * value only after being checked field by field. No branded cast is ever
 * applied to unvalidated input.
 *
 * Written by hand rather than with a schema library. The shapes are few and
 * stable, and the interesting checks are not shape checks at all — a public
 * code has to satisfy its own check character, an event has to match this
 * build, a `qr` capture has to carry a participant ID while a `manual` one must
 * not. Those rules already exist in the identity layer, and a schema library
 * would either duplicate them or need bridging back into it. A dependency that
 * validates the easy half and delegates the hard half is not worth the weight.
 *
 * Every message is structural — a field name and an index. Never a value, so a
 * validation error can never print a participant's name or email.
 */

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] }

/** Registration station: the only issuer whose codes appear in this data. */
const ISSUING_STATION = stationFor('registration').stationId

const SYNC_STATUSES: readonly SyncStatus[] = [
  'pending',
  'syncing',
  'synced',
  'error',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' ? value : null
}

function readNonEmptyString(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = readString(source, key)
  return value !== null && value.length > 0 ? value : null
}

function readInteger(
  source: Record<string, unknown>,
  key: string,
): number | null {
  const value = source[key]
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function readArray(source: Record<string, unknown>, key: string): unknown[] | null {
  const value = source[key]
  return Array.isArray(value) ? value : null
}

/** An ISO-8601 instant that actually parses. */
function isIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) {
    return false
  }
  return !Number.isNaN(Date.parse(value))
}

/* ------------------------------------------------------------------ *
 * Envelope
 * ------------------------------------------------------------------ */

/**
 * Validates the plaintext outer layer, before any key derivation.
 *
 * The iteration count matters here as much as the algorithm names: it is
 * attacker-controlled, and an unbounded value would let a single file freeze
 * the browser on click.
 */
export function validateEnvelope(
  input: unknown,
): ValidationResult<BackupEnvelopeV1> {
  const issues: string[] = []

  if (!isRecord(input)) {
    return { ok: false, issues: ['The file is not a backup file.'] }
  }

  if (readString(input, 'format') !== BACKUP_FORMAT) {
    return { ok: false, issues: ['The file is not a backup file.'] }
  }

  const version = readInteger(input, 'version')
  if (version !== BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      issues: [
        'This backup was made by a different version of the application and cannot be read here.',
      ],
    }
  }

  const kdf = isRecord(input['kdf']) ? input['kdf'] : null
  const cipher = isRecord(input['cipher']) ? input['cipher'] : null

  if (kdf === null || cipher === null) {
    return { ok: false, issues: ['The backup file is damaged.'] }
  }

  if (readString(kdf, 'algorithm') !== KDF_ALGORITHM) {
    issues.push('Unsupported key derivation algorithm.')
  }
  if (readString(kdf, 'hash') !== KDF_HASH) {
    issues.push('Unsupported key derivation hash.')
  }
  if (readString(cipher, 'algorithm') !== CIPHER_ALGORITHM) {
    issues.push('Unsupported encryption algorithm.')
  }

  const iterations = readInteger(kdf, 'iterations')
  if (
    iterations === null ||
    iterations < MIN_ACCEPTED_ITERATIONS ||
    iterations > MAX_ACCEPTED_ITERATIONS
  ) {
    issues.push('Unsupported key derivation cost.')
  }

  const salt = readNonEmptyString(kdf, 'salt')
  const iv = readNonEmptyString(cipher, 'iv')
  const ciphertext = readNonEmptyString(input, 'ciphertext')

  const saltBytes = salt === null ? null : base64ToBytes(salt)
  const ivBytes = iv === null ? null : base64ToBytes(iv)

  if (saltBytes === null || saltBytes.length !== SALT_BYTES) {
    issues.push('The backup file is damaged.')
  }
  if (ivBytes === null || ivBytes.length !== IV_BYTES) {
    issues.push('The backup file is damaged.')
  }
  if (ciphertext === null || base64ToBytes(ciphertext) === null) {
    issues.push('The backup file is damaged.')
  }

  if (issues.length > 0 || salt === null || iv === null || ciphertext === null) {
    return { ok: false, issues: issues.length > 0 ? issues : ['The backup file is damaged.'] }
  }

  return {
    ok: true,
    value: {
      format: BACKUP_FORMAT,
      version: BACKUP_FORMAT_VERSION,
      kdf: {
        algorithm: KDF_ALGORITHM,
        hash: KDF_HASH,
        iterations: iterations ?? MIN_ACCEPTED_ITERATIONS,
        salt,
      },
      cipher: { algorithm: CIPHER_ALGORITHM, iv },
      ciphertext,
    },
  }
}

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

function validateRegistration(
  input: unknown,
  index: number,
  issues: string[],
): RegistrationRecord | null {
  const where = `registrations[${index}]`

  if (!isRecord(input)) {
    issues.push(`${where}: not a record`)
    return null
  }

  const recordId = readNonEmptyString(input, 'recordId')
  const participantId = readNonEmptyString(input, 'participantId')
  const publicCode = readNonEmptyString(input, 'publicCode')
  const eventId = readNonEmptyString(input, 'eventId')
  const eventDay = readNonEmptyString(input, 'eventDay')
  const stationId = readNonEmptyString(input, 'stationId')
  const deviceId = readNonEmptyString(input, 'deviceId')
  const createdAt = readNonEmptyString(input, 'createdAt')
  const updatedAt = readNonEmptyString(input, 'updatedAt')
  const syncStatus = readString(input, 'syncStatus')
  const revision = readInteger(input, 'revision')
  const name = readString(input, 'name')
  const phone = readString(input, 'phone')
  const email = readString(input, 'email')

  if (input['kind'] !== 'registration') {
    issues.push(`${where}: wrong record kind`)
  }
  if (recordId === null || !isUuid(recordId)) {
    issues.push(`${where}: invalid recordId`)
  }
  if (participantId === null || !isUuid(participantId)) {
    issues.push(`${where}: invalid participantId`)
  }
  if (deviceId === null || !isUuid(deviceId)) {
    issues.push(`${where}: invalid deviceId`)
  }
  if (
    publicCode === null ||
    !parsePublicCode(publicCode, { expectedStation: ISSUING_STATION }).ok
  ) {
    // Re-validated against its own check character, not trusted for having
    // been in a file that decrypted.
    issues.push(`${where}: invalid public code`)
  }
  if (createdAt === null || !isIsoTimestamp(createdAt)) {
    issues.push(`${where}: invalid createdAt`)
  }
  if (updatedAt === null || !isIsoTimestamp(updatedAt)) {
    issues.push(`${where}: invalid updatedAt`)
  }
  if (syncStatus === null || !SYNC_STATUSES.includes(syncStatus as SyncStatus)) {
    issues.push(`${where}: invalid syncStatus`)
  }
  if (revision === null || revision < 1) {
    issues.push(`${where}: invalid revision`)
  }
  if (name === null || phone === null || email === null) {
    issues.push(`${where}: missing contact fields`)
  }
  if (eventId === null || eventDay === null || stationId === null) {
    issues.push(`${where}: missing provenance`)
  }

  if (issues.length > 0) {
    return null
  }

  // Every field above is checked; the cast records that, rather than assuming it.
  return input as unknown as RegistrationRecord
}

function validateFeedbackAnswers(
  input: unknown,
  where: string,
  issues: string[],
): void {
  if (!isRecord(input)) {
    issues.push(`${where}: invalid answers`)
    return
  }

  const rating = input['overall_rating']
  if (
    typeof rating !== 'number' ||
    !OVERALL_RATINGS.includes(rating as (typeof OVERALL_RATINGS)[number])
  ) {
    issues.push(`${where}: invalid overall_rating`)
  }

  const experience = input['experience']
  if (
    typeof experience !== 'string' ||
    !EXPERIENCE_VALUES.includes(
      experience as (typeof EXPERIENCE_VALUES)[number],
    )
  ) {
    issues.push(`${where}: invalid experience`)
  }

  if (typeof input['recommend'] !== 'boolean') {
    issues.push(`${where}: invalid recommend`)
  }

  if ('comments' in input) {
    const comments = input['comments']
    if (typeof comments !== 'string' || comments.length > MAX_COMMENTS_LENGTH) {
      issues.push(`${where}: invalid comments`)
    }
  }
}

function validateFeedback(
  input: unknown,
  index: number,
  issues: string[],
): FeedbackRecord | null {
  const where = `feedback[${index}]`
  const before = issues.length

  if (!isRecord(input)) {
    issues.push(`${where}: not a record`)
    return null
  }

  const recordId = readNonEmptyString(input, 'recordId')
  const publicCode = readNonEmptyString(input, 'publicCode')
  const deviceId = readNonEmptyString(input, 'deviceId')
  const createdAt = readNonEmptyString(input, 'createdAt')
  const updatedAt = readNonEmptyString(input, 'updatedAt')
  const syncStatus = readString(input, 'syncStatus')
  const revision = readInteger(input, 'revision')
  const captureMethod = readString(input, 'captureMethod')

  if (input['kind'] !== 'feedback') {
    issues.push(`${where}: wrong record kind`)
  }
  if (recordId === null || !isUuid(recordId)) {
    issues.push(`${where}: invalid recordId`)
  }
  if (deviceId === null || !isUuid(deviceId)) {
    issues.push(`${where}: invalid deviceId`)
  }
  if (
    publicCode === null ||
    !parsePublicCode(publicCode, { expectedStation: ISSUING_STATION }).ok
  ) {
    issues.push(`${where}: invalid public code`)
  }
  if (createdAt === null || !isIsoTimestamp(createdAt)) {
    issues.push(`${where}: invalid createdAt`)
  }
  if (updatedAt === null || !isIsoTimestamp(updatedAt)) {
    issues.push(`${where}: invalid updatedAt`)
  }
  if (syncStatus === null || !SYNC_STATUSES.includes(syncStatus as SyncStatus)) {
    issues.push(`${where}: invalid syncStatus`)
  }
  if (revision === null || revision < 1) {
    issues.push(`${where}: invalid revision`)
  }
  if (input['formVersion'] !== FEEDBACK_FORM_VERSION) {
    issues.push(`${where}: unsupported questionnaire version`)
  }

  /*
   * The identity rule from Phase 3, enforced on the way in: a QR capture knows
   * the participant ID, a manual capture cannot and must not claim to.
   */
  if (captureMethod === 'qr') {
    const participantId = readNonEmptyString(input, 'participantId')
    if (participantId === null || !isUuid(participantId)) {
      issues.push(`${where}: invalid participantId`)
    }
  } else if (captureMethod === 'manual') {
    if ('participantId' in input) {
      issues.push(`${where}: manual capture must not carry a participantId`)
    }
  } else {
    issues.push(`${where}: invalid captureMethod`)
  }

  validateFeedbackAnswers(input['answers'], where, issues)

  if (issues.length > before) {
    return null
  }

  return input as unknown as FeedbackRecord
}

function validateSequence(
  input: unknown,
  index: number,
  issues: string[],
): SequenceRow | null {
  const where = `sequences[${index}]`

  if (!isRecord(input)) {
    issues.push(`${where}: not a record`)
    return null
  }

  const key = readNonEmptyString(input, 'key')
  const value = readInteger(input, 'value')

  if (key === null) {
    issues.push(`${where}: invalid key`)
  }
  if (value === null || value < 0) {
    // A negative counter would hand out codes that have already been printed.
    issues.push(`${where}: invalid sequence value`)
  }

  return key === null || value === null || value < 0 ? null : { key, value }
}

function validateDeviceConfig(
  input: unknown,
  index: number,
  issues: string[],
): DeviceConfigRow | null {
  const where = `deviceConfig[${index}]`

  if (!isRecord(input)) {
    issues.push(`${where}: not a record`)
    return null
  }

  const key = readNonEmptyString(input, 'key')
  const value = readString(input, 'value')
  const updatedAt = readString(input, 'updatedAt')

  if (key === null || value === null || updatedAt === null) {
    issues.push(`${where}: invalid device configuration row`)
    return null
  }

  return { key, value, updatedAt }
}

/* ------------------------------------------------------------------ *
 * Payload
 * ------------------------------------------------------------------ */

export interface ValidatePayloadOptions {
  /** Restricts the backup to this build's event. Defaults to the configured event. */
  readonly expectedEventId?: string
  readonly expectedEventDay?: string
}

/**
 * Validates a decrypted payload in full.
 *
 * Returns every issue found rather than the first, so a corrupt file can be
 * diagnosed in one pass instead of a dozen attempts.
 */
export function validatePayload(
  input: unknown,
  options: ValidatePayloadOptions = {},
): ValidationResult<BackupPayloadV1> {
  const issues: string[] = []

  if (!isRecord(input)) {
    return { ok: false, issues: ['The backup contents are not readable.'] }
  }

  if (readInteger(input, 'backupFormatVersion') !== BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      issues: [
        'This backup was made by a newer version of the application and cannot be restored here.',
      ],
    }
  }

  const backupId = readNonEmptyString(input, 'backupId')
  if (backupId === null || !isUuid(backupId)) {
    issues.push('invalid backupId')
  }

  const createdAt = readNonEmptyString(input, 'createdAt')
  if (createdAt === null || !isIsoTimestamp(createdAt)) {
    issues.push('invalid createdAt')
  }

  const application = isRecord(input['application']) ? input['application'] : null
  if (
    application === null ||
    readString(application, 'version') === null ||
    readString(application, 'buildId') === null
  ) {
    issues.push('invalid application metadata')
  }

  const database = isRecord(input['database']) ? input['database'] : null
  const schemaVersion = database === null ? null : readInteger(database, 'schemaVersion')
  if (database === null || readNonEmptyString(database, 'name') === null) {
    issues.push('invalid database metadata')
  }
  if (schemaVersion === null || schemaVersion < 1) {
    issues.push('invalid database schema version')
  } else if (schemaVersion > DB_VERSION) {
    issues.push(
      'This backup uses a newer database format than this application understands.',
    )
  }

  const event = isRecord(input['event']) ? input['event'] : null
  const eventId = event === null ? null : readNonEmptyString(event, 'eventId')
  const eventDay = event === null ? null : readNonEmptyString(event, 'eventDay')
  if (eventId === null || eventDay === null) {
    issues.push('invalid event metadata')
  } else {
    const expectedEventId = options.expectedEventId ?? EVENT_CONFIG.eventId
    const expectedEventDay = options.expectedEventDay ?? EVENT_CONFIG.eventDay

    if (eventId !== expectedEventId || eventDay !== expectedEventDay) {
      // V1 is one event on one day; merging another event's records into this
      // database would corrupt both.
      return {
        ok: false,
        issues: ['This backup belongs to another event and cannot be restored here.'],
      }
    }
  }

  const sourceDeviceId = readNonEmptyString(input, 'sourceDeviceId')
  if (sourceDeviceId === null || !isUuid(sourceDeviceId)) {
    issues.push('invalid source device')
  }

  const registrationsInput = readArray(input, 'registrations')
  const feedbackInput = readArray(input, 'feedback')
  const sequencesInput = readArray(input, 'sequences')
  const deviceConfigInput = readArray(input, 'deviceConfig')

  if (
    registrationsInput === null ||
    feedbackInput === null ||
    sequencesInput === null ||
    deviceConfigInput === null
  ) {
    return { ok: false, issues: [...issues, 'The backup contents are not readable.'] }
  }

  const registrations: RegistrationRecord[] = []
  registrationsInput.forEach((entry, index) => {
    const record = validateRegistration(entry, index, issues)
    if (record !== null) {
      registrations.push(record)
    }
  })

  const feedback: FeedbackRecord[] = []
  feedbackInput.forEach((entry, index) => {
    const record = validateFeedback(entry, index, issues)
    if (record !== null) {
      feedback.push(record)
    }
  })

  const sequences: SequenceRow[] = []
  sequencesInput.forEach((entry, index) => {
    const row = validateSequence(entry, index, issues)
    if (row !== null) {
      sequences.push(row)
    }
  })

  const deviceConfig: DeviceConfigRow[] = []
  deviceConfigInput.forEach((entry, index) => {
    const row = validateDeviceConfig(entry, index, issues)
    if (row !== null) {
      deviceConfig.push(row)
    }
  })

  /* Records must belong to this event individually, not just in the header. */
  const expectedEventId = options.expectedEventId ?? EVENT_CONFIG.eventId
  const expectedEventDay = options.expectedEventDay ?? EVENT_CONFIG.eventDay

  registrations.forEach((record, index) => {
    if (record.eventId !== expectedEventId || record.eventDay !== expectedEventDay) {
      issues.push(`registrations[${index}]: belongs to another event`)
    }
  })
  feedback.forEach((record, index) => {
    if (record.eventId !== expectedEventId || record.eventDay !== expectedEventDay) {
      issues.push(`feedback[${index}]: belongs to another event`)
    }
  })

  /* Uniqueness within the file itself. */
  assertUnique(registrations.map((r) => r.recordId), 'registration recordId', issues)
  assertUnique(
    registrations.map((r) => r.participantId),
    'registration participantId',
    issues,
  )
  assertUnique(
    registrations.map((r) => r.publicCode),
    'registration public code',
    issues,
  )
  assertUnique(feedback.map((r) => r.recordId), 'feedback recordId', issues)
  assertUnique(sequences.map((r) => r.key), 'sequence key', issues)
  // Feedback public codes are deliberately NOT unique: two devices may each
  // hold a response for the same participant, and both must survive.

  /* Declared counts must match what is actually in the file. */
  const counts = isRecord(input['counts']) ? input['counts'] : null
  if (counts === null) {
    issues.push('invalid counts')
  } else {
    if (readInteger(counts, 'registrations') !== registrationsInput.length) {
      issues.push('registration count does not match the records in the backup')
    }
    if (readInteger(counts, 'feedback') !== feedbackInput.length) {
      issues.push('feedback count does not match the records in the backup')
    }
    if (readInteger(counts, 'sequences') !== sequencesInput.length) {
      issues.push('sequence count does not match the records in the backup')
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  return { ok: true, value: input as unknown as BackupPayloadV1 }
}

function assertUnique(
  values: readonly string[],
  label: string,
  issues: string[],
): void {
  const seen = new Set<string>()

  for (const value of values) {
    if (seen.has(value)) {
      // The duplicated value is never printed — it could be an identifier that
      // ties back to a participant.
      issues.push(`duplicate ${label} in backup`)
      return
    }
    seen.add(value)
  }
}

export { DB_NAME }
