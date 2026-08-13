import { describe, expect, it } from 'vitest'
import {
  captureIdentityFromManualCode,
  captureIdentityFromQr,
} from './identityCapture'
import { EVENT_CONFIG } from '../../config/event'
import { deriveIssuerCode } from '../../lib/identity/issuerCode'
import { formatPublicCode } from '../../lib/identity/publicCode'
import {
  buildQrPayload,
  serializeQrPayload,
} from '../../lib/identity/qrPayload'
import { newParticipantId } from '../../lib/identity/uuid'
import { deviceId, eventId, stationId } from '../../types'

const A1 = {
  stationId: stationId('A1'),
  issuerCode: deriveIssuerCode(deviceId('11111111-2222-4333-8444-555555555555')),
}
const B1 = { ...A1, stationId: stationId('B1') }

function stickerPayload(overrides: { event?: ReturnType<typeof eventId> } = {}) {
  return serializeQrPayload(
    buildQrPayload({
      eventId: overrides.event ?? EVENT_CONFIG.eventId,
      participantId: newParticipantId(),
      publicCode: formatPublicCode(A1, 1),
    }),
  )
}

describe('captureIdentityFromQr', () => {
  it('accepts a sticker from this event and the registration desk', () => {
    const participantId = newParticipantId()
    const publicCode = formatPublicCode(A1, 42)
    const decoded = serializeQrPayload(
      buildQrPayload({
        eventId: EVENT_CONFIG.eventId,
        participantId,
        publicCode,
      }),
    )

    const result = captureIdentityFromQr(decoded)

    expect(result).toEqual({
      ok: true,
      identity: { captureMethod: 'qr', participantId, publicCode },
    })
  })

  it('captures both identifiers, because the QR carries both', () => {
    const result = captureIdentityFromQr(stickerPayload())

    expect(result.ok).toBe(true)
    if (result.ok && result.identity.captureMethod === 'qr') {
      expect(result.identity.participantId).toMatch(/^[0-9a-f-]{36}$/)
      expect(result.identity.publicCode).toMatch(
        /^A1-[0-9A-F]{6}-\d{5}-[0-9A-Z]$/,
      )
    }
  })

  it('rejects a QR that is not one of ours', () => {
    for (const decoded of [
      'https://example.com/promo',
      'WIFI:S:VenueGuest;T:WPA;P:hunter2;;',
      'not json at all',
      '{}',
      '[1,2,3]',
    ]) {
      const result = captureIdentityFromQr(decoded)
      expect(result.ok).toBe(false)
      expect(!result.ok && result.reason).toBe('not-a-participant-sticker')
    }
  })

  it('rejects an unsupported payload version', () => {
    const decoded = JSON.stringify({
      v: 99,
      event: EVENT_CONFIG.eventId,
      participant: newParticipantId(),
      code: formatPublicCode(A1, 1),
    })

    expect(captureIdentityFromQr(decoded).ok).toBe(false)
  })

  it('rejects a sticker from another event', () => {
    const result = captureIdentityFromQr(
      stickerPayload({ event: eventId('evt-last-year') }),
    )

    expect(!result.ok && result.reason).toBe('wrong-event')
  })

  it('rejects a code issued by another station', () => {
    const decoded = serializeQrPayload(
      buildQrPayload({
        eventId: EVENT_CONFIG.eventId,
        participantId: newParticipantId(),
        publicCode: formatPublicCode(B1, 1),
      }),
    )

    expect(!captureIdentityFromQr(decoded).ok).toBe(true)
  })

  it('rejects an invalid participant ID', () => {
    const decoded = JSON.stringify({
      v: 1,
      event: EVENT_CONFIG.eventId,
      participant: 'participant-7',
      code: formatPublicCode(A1, 1),
    })

    expect(captureIdentityFromQr(decoded).ok).toBe(false)
  })

  it('rejects a public code whose checksum does not hold', () => {
    const decoded = JSON.stringify({
      v: 1,
      event: EVENT_CONFIG.eventId,
      participant: newParticipantId(),
      code: 'A1-B8EFD9-00001-Z',
    })

    const result = captureIdentityFromQr(decoded)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('wrong-station')
  })

  it('never exposes a parser message to staff', () => {
    const result = captureIdentityFromQr('{"broken":')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe(
        'This QR is not a valid participant sticker for this event.',
      )
      expect(result.message).not.toMatch(/JSON|SyntaxError|undefined|parse/i)
    }
  })
})

describe('captureIdentityFromManualCode', () => {
  it('accepts a valid printed code', () => {
    const code = formatPublicCode(A1, 6)
    const result = captureIdentityFromManualCode(code)

    expect(result).toEqual({
      ok: true,
      identity: { captureMethod: 'manual', publicCode: code },
    })
  })

  it('deliberately has no participant ID', () => {
    // The printed code does not contain one, and Point B cannot look one up.
    // Inventing it would be fabricating data; reconciliation resolves it later.
    const result = captureIdentityFromManualCode(formatPublicCode(A1, 6))

    expect(result.ok).toBe(true)
    expect(result.ok && 'participantId' in result.identity).toBe(false)
  })

  it('keeps the identity layer’s entry tolerance', () => {
    const canonical = formatPublicCode(A1, 1)
    const [, issuer = ''] = /^A1-([0-9A-F]{6})-/.exec(canonical) ?? []
    const check = canonical.slice(-1)

    for (const typed of [
      canonical.toLowerCase(),
      canonical.replace(/-/g, ' '),
      `  ${canonical}  `,
      `a1.${issuer.toLowerCase()}.00001.${check.toLowerCase()}`,
      // Under-padded sequence, normalised by the identity layer.
      `A1-${issuer}-1-${check}`,
    ]) {
      const result = captureIdentityFromManualCode(typed)
      expect(result.ok).toBe(true)
      expect(result.ok && result.identity.publicCode).toBe(canonical)
    }
  })

  it('rejects a bad check character', () => {
    const result = captureIdentityFromManualCode('A1-B8EFD9-00001-Z')

    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('invalid-code')
  })

  it('rejects a code from the feedback station', () => {
    const result = captureIdentityFromManualCode(formatPublicCode(B1, 1))

    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('wrong-station')
  })

  it('rejects malformed input', () => {
    for (const typed of ['', 'hello', 'A1', 'A1-00001-O', '12345']) {
      expect(captureIdentityFromManualCode(typed).ok).toBe(false)
    }
  })
})
