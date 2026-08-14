import { EVENT_CONFIG } from '../../config/event'
import { deriveIssuerCode } from '../identity/issuerCode'
import {
  formatPublicCode,
  nextIssuableSequence,
} from '../identity/publicCode'
import { newParticipantId, newRecordId } from '../identity/uuid'
import { DB_VERSION, type OfflineEventDb } from '../storage'
import {
  deviceId as toDeviceId,
  isoTimestamp,
  stationId,
  type DeviceId,
  type FeedbackQuestionnairePayload,
  type FeedbackRecord,
  type RegistrationRecord,
} from '../../types'
import { BACKUP_FORMAT_VERSION, type BackupPayloadV1 } from './format'

/*
 * Fixtures for the backup suites.
 *
 * Records are built to look exactly like the ones Point A and Point B produce:
 * real UUIDs, real public codes with valid check characters, because the
 * validator checks all of that and a fixture that cheats would test nothing.
 */

export const SOURCE_DEVICE = toDeviceId('11111111-2222-4333-8444-555555555555')
export const DESTINATION_DEVICE = toDeviceId(
  '99999999-8888-4777-8666-555555555555',
)

const A1 = stationId('A1')
const B1 = stationId('B1')

/**
 * The nth code an issuer would actually hand out.
 *
 * Roughly one sequence number in 37 has no printable check character and is
 * skipped by the real allocator, so a fixture that formatted raw counters would
 * throw on those. Walking the same path keeps fixture codes both valid and
 * distinct, which the unique indexes require.
 */
const issuableCache = new Map<string, number[]>()

function nthIssuable(issuerCode: string, n: number): number {
  const cached = issuableCache.get(issuerCode) ?? []

  let candidate = cached.length === 0 ? 1 : (cached[cached.length - 1] as number) + 1
  while (cached.length < n) {
    const next = nextIssuableSequence({ stationId: A1, issuerCode: issuerCode as never }, candidate)
    cached.push(next)
    candidate = next + 1
  }
  issuableCache.set(issuerCode, cached)

  return cached[n - 1] as number
}

export function makeRegistration(
  sequence: number,
  overrides: Partial<RegistrationRecord> = {},
  device: DeviceId = SOURCE_DEVICE,
): RegistrationRecord {
  return {
    kind: 'registration',
    recordId: newRecordId(),
    eventId: EVENT_CONFIG.eventId,
    eventDay: EVENT_CONFIG.eventDay,
    stationId: A1,
    deviceId: device,
    createdAt: isoTimestamp('2026-01-01T09:00:00.000Z'),
    updatedAt: isoTimestamp('2026-01-01T09:00:00.000Z'),
    revision: 1,
    syncStatus: 'pending',
    participantId: newParticipantId(),
    publicCode: formatPublicCode(
      { stationId: A1, issuerCode: deriveIssuerCode(device) },
      nthIssuable(deriveIssuerCode(device), sequence),
    ),
    name: 'Ada Lovelace',
    phone: '+44 20 7946 0958',
    email: 'ada@example.com',
    ...overrides,
  }
}

/**
 * `overrides` takes the questionnaire as a pair.
 *
 * `Partial<FeedbackRecord>` would let a caller override `formVersion` alone and
 * leave the old questionnaire's answers behind it: the exact mismatch the
 * discriminated payload exists to prevent, reintroduced in the fixtures.
 */
type FeedbackOverrides = Partial<Omit<FeedbackRecord, 'formVersion' | 'answers'>> &
  Partial<FeedbackQuestionnairePayload>

export function makeFeedback(
  registration: RegistrationRecord,
  overrides: FeedbackOverrides = {},
  device: DeviceId = SOURCE_DEVICE,
): FeedbackRecord {
  /*
   * Assembled from whichever half the caller supplied, then asserted once.
   *
   * The assertion is deliberate and is confined to fixtures: the validator
   * suites exist to prove that a *hostile* file, including one whose answers do
   * not match its declared version, is refused, and they cannot build such a
   * file through a type that makes it impossible. Production code has no such
   * escape hatch.
   */
  const questionnaire = {
    formVersion: overrides.formVersion ?? 'feedback-v1',
    answers: overrides.answers ?? {
      overall_rating: 4,
      experience: 'good',
      recommend: true,
      comments: 'Well organised',
    },
  } as FeedbackQuestionnairePayload

  const { formVersion: _version, answers: _answers, ...rest } = overrides

  return {
    kind: 'feedback',
    recordId: newRecordId(),
    eventId: EVENT_CONFIG.eventId,
    eventDay: EVENT_CONFIG.eventDay,
    stationId: B1,
    deviceId: device,
    createdAt: isoTimestamp('2026-01-01T11:00:00.000Z'),
    updatedAt: isoTimestamp('2026-01-01T11:00:00.000Z'),
    revision: 1,
    syncStatus: 'pending',
    captureMethod: 'qr',
    publicCode: registration.publicCode,
    participantId: registration.participantId,
    ...questionnaire,
    ...rest,
  }
}

/** A payload built directly, for tests that never touch a database. */
export function makePayload(
  overrides: Partial<BackupPayloadV1> = {},
): BackupPayloadV1 {
  const registrations = overrides.registrations ?? []
  const feedback = overrides.feedback ?? []
  const sequences = overrides.sequences ?? []

  return {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    backupId: newRecordId(),
    createdAt: isoTimestamp('2026-01-01T12:00:00.000Z'),
    application: { version: '0.0.0', buildId: '2026-01-01T12:00:00Z' },
    database: { name: 'offline-event-feedback', schemaVersion: DB_VERSION },
    event: { eventId: EVENT_CONFIG.eventId, eventDay: EVENT_CONFIG.eventDay },
    sourceDeviceId: SOURCE_DEVICE,
    deviceConfig: [
      {
        key: 'deviceId',
        value: SOURCE_DEVICE,
        updatedAt: '2026-01-01T08:00:00.000Z',
      },
    ],
    ...overrides,
    counts: overrides.counts ?? {
      registrations: registrations.length,
      feedback: feedback.length,
      sequences: sequences.length,
    },
    registrations,
    feedback,
    sequences,
  }
}

/** Seeds a database as the source device would have left it. */
export async function seedDatabase(
  database: OfflineEventDb,
  options: { registrations: number; feedbackFor?: number } = {
    registrations: 3,
  },
): Promise<{
  registrations: RegistrationRecord[]
  feedback: FeedbackRecord[]
}> {
  const registrations = Array.from({ length: options.registrations }, (_, i) =>
    makeRegistration(i + 1),
  )
  const feedback = registrations
    .slice(0, options.feedbackFor ?? options.registrations)
    .map((registration) => makeFeedback(registration))

  await database.registrations.bulkAdd(registrations)
  await database.feedback.bulkAdd(feedback)
  await database.deviceConfig.put({
    key: 'deviceId',
    value: SOURCE_DEVICE,
    updatedAt: '2026-01-01T08:00:00.000Z',
  })
  await database.sequences.put({
    key: `publicCode:${EVENT_CONFIG.eventId}:${EVENT_CONFIG.eventDay}:A1:${deriveIssuerCode(SOURCE_DEVICE)}`,
    value: options.registrations,
  })

  return { registrations, feedback }
}
