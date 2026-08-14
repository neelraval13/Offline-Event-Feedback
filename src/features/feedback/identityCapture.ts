import { EVENT_CONFIG, stationFor } from '../../config/event'
import { parsePublicCode } from '../../lib/identity/publicCode'
import { parseQrPayload } from '../../lib/identity/qrPayload'
import type { CapturedParticipantIdentity } from '../../types'

/*
 * Turning what is physically on the sticker into an identity Point B will
 * record.
 *
 * Both paths are pure functions over the existing identity layer. Nothing here
 * reads storage, and in particular nothing reads Point A's registrations.
 * Point B has no copy of them and must not need one (invariant 2). A scan is
 * accepted or rejected on the strength of the sticker alone.
 */

/** The station whose stickers Point B accepts: the registration desk, A1. */
const ISSUING_STATION = stationFor('registration').stationId

/** Why a scanned or typed identity was refused. */
export type IdentityRejectionReason =
  | 'not-a-participant-sticker'
  | 'wrong-event'
  | 'wrong-station'
  | 'invalid-code'

export type IdentityCaptureResult =
  | { readonly ok: true; readonly identity: CapturedParticipantIdentity }
  | {
      readonly ok: false
      readonly reason: IdentityRejectionReason
      /** Wording for staff, concise, non-technical, never a parser message. */
      readonly message: string
    }

const MESSAGES: Record<IdentityRejectionReason, string> = {
  'not-a-participant-sticker':
    'This QR is not a valid participant sticker for this event.',
  'wrong-event': 'This sticker belongs to a different event.',
  'wrong-station': 'This code was not issued by the registration desk.',
  'invalid-code': 'That code is not valid. Check it and type it again.',
}

function reject(reason: IdentityRejectionReason): IdentityCaptureResult {
  return { ok: false, reason, message: MESSAGES[reason] }
}

/**
 * Validates a decoded QR string.
 *
 * The camera will happily decode a conference badge, a Wi-Fi QR, a URL on a
 * poster, or a sticker from last year's event. Every one of those parses as
 * *something*, so the payload is checked against this event and this issuing
 * station, and the embedded public code is re-validated against its own check
 * character rather than trusted for having arrived inside a payload.
 *
 * A QR carries both identifiers, so the result is a complete identity.
 */
export function captureIdentityFromQr(decoded: string): IdentityCaptureResult {
  const parsed = parseQrPayload(decoded, {
    expectedEventId: EVENT_CONFIG.eventId,
    expectedStation: ISSUING_STATION,
  })

  if (!parsed.ok) {
    switch (parsed.reason) {
      case 'event-mismatch':
        return reject('wrong-event')
      case 'invalid-public-code':
        // Either a bad checksum or a code from another station; both mean this
        // sticker is not one of ours.
        return reject('wrong-station')
      default:
        return reject('not-a-participant-sticker')
    }
  }

  return {
    ok: true,
    identity: {
      captureMethod: 'qr',
      participantId: parsed.payload.participant,
      publicCode: parsed.payload.code,
    },
  }
}

/**
 * Validates a public code typed by staff when scanning fails.
 *
 * Normalisation and checksum validation belong to the identity layer and are
 * not repeated here; this is a thin adapter over `parsePublicCode`, so the
 * tolerance already built in (case, separators, under-padded sequences) applies
 * exactly as it does everywhere else.
 *
 * The result deliberately has **no** `participantId`. The printed code does not
 * contain one and Point B cannot look one up, so inferring or fabricating one
 * would be inventing data. Re-joining it happens centrally after
 * synchronisation.
 */
export function captureIdentityFromManualCode(
  typed: string,
): IdentityCaptureResult {
  const parsed = parsePublicCode(typed, { expectedStation: ISSUING_STATION })

  if (!parsed.ok) {
    return reject(
      parsed.reason === 'unexpected-station' ? 'wrong-station' : 'invalid-code',
    )
  }

  return {
    ok: true,
    identity: { captureMethod: 'manual', publicCode: parsed.code },
  }
}
