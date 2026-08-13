import { describe, expect, it } from 'vitest'
import {
  buildQrPayload,
  parseQrPayload,
  QR_PAYLOAD_VERSION,
  qrPayloadForRegistration,
  serializeQrPayload,
} from './qrPayload'
import { formatPublicCode } from './publicCode'
import { newParticipantId, newRecordId } from './uuid'
import {
  deviceId,
  eventDay,
  eventId,
  isoTimestamp,
  publicParticipantCode,
  stationId,
  type RegistrationRecord,
} from '../../types'

const EVENT = eventId('evt-dev-001')
const OTHER_EVENT = eventId('evt-other-002')

function samplePayload() {
  return buildQrPayload({
    eventId: EVENT,
    participantId: newParticipantId(),
    publicCode: formatPublicCode('A1', 1),
  })
}

function sampleRegistration(): RegistrationRecord {
  return {
    kind: 'registration',
    recordId: newRecordId(),
    eventId: EVENT,
    eventDay: eventDay('2026-01-01'),
    stationId: stationId('A1'),
    deviceId: deviceId('device-under-test'),
    createdAt: isoTimestamp('2026-01-01T09:00:00.000Z'),
    updatedAt: isoTimestamp('2026-01-01T09:00:00.000Z'),
    revision: 1,
    syncStatus: 'pending',
    participantId: newParticipantId(),
    publicCode: formatPublicCode('A1', 1),
    name: 'Ada Lovelace',
    phone: '+44 20 7946 0958',
    email: 'ada@example.com',
  }
}

describe('serialize -> parse round trip', () => {
  it('returns an equivalent payload', () => {
    const payload = samplePayload()
    const result = parseQrPayload(serializeQrPayload(payload))
    expect(result.ok && result.payload).toEqual(payload)
  })

  it('survives the event and prefix expectations being supplied', () => {
    const payload = samplePayload()
    const result = parseQrPayload(serializeQrPayload(payload), {
      expectedEventId: EVENT,
      expectedPrefix: 'A1',
    })
    expect(result.ok).toBe(true)
  })

  it('emits exactly the four contract fields', () => {
    const serialized = serializeQrPayload(samplePayload())
    expect(Object.keys(JSON.parse(serialized) as object).sort()).toEqual([
      'code',
      'event',
      'participant',
      'v',
    ])
  })
})

describe('parseQrPayload rejections', () => {
  it('rejects input that is not JSON', () => {
    expect(parseQrPayload('not json')).toEqual({
      ok: false,
      reason: 'invalid-json',
    })
  })

  it('rejects JSON that is not an object', () => {
    for (const raw of ['42', '"text"', 'null', '[1,2,3]']) {
      expect(parseQrPayload(raw)).toEqual({ ok: false, reason: 'not-an-object' })
    }
  })

  it('rejects an unsupported version', () => {
    const payload = { ...samplePayload(), v: 2 }
    expect(parseQrPayload(JSON.stringify(payload))).toEqual({
      ok: false,
      reason: 'unsupported-version',
    })
  })

  it('rejects a missing version', () => {
    const { v: _v, ...withoutVersion } = samplePayload()
    expect(parseQrPayload(JSON.stringify(withoutVersion))).toEqual({
      ok: false,
      reason: 'missing-field',
    })
  })

  it('rejects each missing field', () => {
    for (const field of ['event', 'participant', 'code'] as const) {
      const payload: Record<string, unknown> = { ...samplePayload() }
      delete payload[field]
      expect(parseQrPayload(JSON.stringify(payload))).toEqual({
        ok: false,
        reason: 'missing-field',
      })
    }
  })

  it('rejects fields of the wrong type', () => {
    const payload = { ...samplePayload(), participant: 12345 }
    expect(parseQrPayload(JSON.stringify(payload))).toEqual({
      ok: false,
      reason: 'missing-field',
    })
  })

  it('rejects a participant ID that is not a UUID', () => {
    const payload = { ...samplePayload(), participant: 'participant-1' }
    expect(parseQrPayload(JSON.stringify(payload))).toEqual({
      ok: false,
      reason: 'invalid-participant-id',
    })
  })

  it('rejects a sticker from another event', () => {
    const serialized = serializeQrPayload(samplePayload())
    expect(parseQrPayload(serialized, { expectedEventId: OTHER_EVENT })).toEqual(
      { ok: false, reason: 'event-mismatch' },
    )
  })

  it('accepts any event when none is expected', () => {
    const payload = buildQrPayload({
      eventId: OTHER_EVENT,
      participantId: newParticipantId(),
      publicCode: formatPublicCode('A1', 1),
    })
    expect(parseQrPayload(serializeQrPayload(payload)).ok).toBe(true)
  })

  it('rejects a public code that fails its own check character', () => {
    const payload = {
      ...samplePayload(),
      code: publicParticipantCode('A1-00001-P'),
    }
    expect(parseQrPayload(JSON.stringify(payload))).toEqual({
      ok: false,
      reason: 'invalid-public-code',
    })
  })

  it('rejects a public code from an unexpected station', () => {
    const payload = buildQrPayload({
      eventId: EVENT,
      participantId: newParticipantId(),
      publicCode: formatPublicCode('B1', 1),
    })
    expect(
      parseQrPayload(serializeQrPayload(payload), { expectedPrefix: 'A1' }),
    ).toEqual({ ok: false, reason: 'invalid-public-code' })
  })

  it('does not trust a payload merely because it parses as JSON', () => {
    const hostile = JSON.stringify({
      v: QR_PAYLOAD_VERSION,
      event: EVENT,
      participant: newParticipantId(),
      code: 'A1-00001-O',
      name: 'injected',
      admin: true,
    })
    const result = parseQrPayload(hostile)
    // Extra keys are ignored rather than carried into the payload.
    expect(result.ok && Object.keys(result.payload).sort()).toEqual([
      'code',
      'event',
      'participant',
      'v',
    ])
  })
})

describe('privacy boundary (invariant E)', () => {
  it('carries no PII from a registration into the payload', () => {
    const registration = sampleRegistration()
    const serialized = serializeQrPayload(qrPayloadForRegistration(registration))

    for (const secret of [
      registration.name,
      registration.phone,
      registration.email,
      'Ada',
      'Lovelace',
      'example.com',
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('copies only the three identity fields, whatever else the record holds', () => {
    const registration = sampleRegistration()
    const payload = qrPayloadForRegistration(registration)

    expect(payload).toEqual({
      v: QR_PAYLOAD_VERSION,
      event: registration.eventId,
      participant: registration.participantId,
      code: registration.publicCode,
    })
  })
})
