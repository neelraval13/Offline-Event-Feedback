import { randomUUID } from 'node:crypto'
import type {
  FeedbackWireRecord,
  RegistrationWireRecord,
  SyncBatch,
} from '../../shared/sync/protocol'
import { SYNC_PROTOCOL_VERSION } from '../../shared/sync/protocol'

export const EVENT_ID = 'evt-dev-001'
export const EVENT_DAY = '2026-01-01'

/** The device that captured the records. */
export const DEVICE_A = '11111111-2222-4333-8444-555555555555'
/** A replacement device, restored from DEVICE_A's backup. */
export const DEVICE_B = '99999999-8888-4777-8666-555555555555'

/*
 * Public codes must satisfy the shared schema's shape: station, six hex
 * characters of device issuer, sequence, check character. The check character
 * is not recomputed here — the server validates shape, and the identity layer
 * on the client is what guarantees the arithmetic.
 */
export function publicCodeFor(sequence: number, issuer = 'B8EFD9'): string {
  return `A1-${issuer}-${String(sequence).padStart(5, '0')}-X`
}

export function registration(
  overrides: Partial<RegistrationWireRecord> = {},
): RegistrationWireRecord {
  return {
    kind: 'registration',
    recordId: randomUUID(),
    participantId: randomUUID(),
    publicCode: publicCodeFor(1),
    eventId: EVENT_ID,
    eventDay: EVENT_DAY,
    stationId: 'A1',
    deviceId: DEVICE_A,
    name: 'Ada Lovelace',
    phone: '+44 20 7946 0958',
    email: 'ada@example.com',
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T09:00:00.000Z',
    revision: 1,
    ...overrides,
  }
}

export function feedback(
  overrides: Partial<FeedbackWireRecord> = {},
): FeedbackWireRecord {
  const base = {
    kind: 'feedback' as const,
    recordId: randomUUID(),
    participantId: randomUUID(),
    publicCode: publicCodeFor(1),
    captureMethod: 'qr' as const,
    eventId: EVENT_ID,
    eventDay: EVENT_DAY,
    stationId: 'B1',
    deviceId: DEVICE_A,
    formVersion: 'feedback-v1' as const,
    answers: {
      overall_rating: 4 as const,
      experience: 'good' as const,
      recommend: true,
      comments: 'Well organised',
    },
    createdAt: '2026-01-01T11:00:00.000Z',
    updatedAt: '2026-01-01T11:00:00.000Z',
    revision: 1,
  }

  const merged = { ...base, ...overrides }

  // A manual capture carries no participant ID, and the schema enforces it.
  if (merged.captureMethod === 'manual') {
    const { participantId: _dropped, ...withoutParticipant } = merged
    return withoutParticipant as FeedbackWireRecord
  }

  return merged as FeedbackWireRecord
}

export function batch(
  records: readonly (RegistrationWireRecord | FeedbackWireRecord)[],
  overrides: Partial<SyncBatch> = {},
): SyncBatch {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    batchId: randomUUID(),
    eventId: EVENT_ID,
    uploaderDeviceId: DEVICE_A,
    records: [...records],
    ...overrides,
  } as SyncBatch
}
