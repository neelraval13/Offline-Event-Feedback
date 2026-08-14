import {
  eventId as toEventId,
  participantId as toParticipantId,
  publicParticipantCode as toPublicCode,
  type EventId,
  type ParticipantId,
  type PublicParticipantCode,
  type RegistrationRecord,
} from '../../types'
import { parsePublicCode } from './publicCode'
import { isUuid } from './uuid'

/*
 * The contract for what a QR sticker carries.
 *
 * Nothing renders or scans a QR code in this phase. The payload boundary is
 * locked now so that Point A and Point B agree on an identity contract before
 * either side is built, and so the contract has one versioned definition
 * instead of two implicit ones.
 *
 * Invariant E: the payload carries an event ID, a participant UUID and the
 * printed public code. It carries no name, phone, email, or anything else from
 * which a participant could be identified by a person holding the sticker.
 * `qrPayloadForRegistration` is the only bridge from a PII-bearing record to
 * this payload, and it copies fields explicitly, never by spreading.
 */

/** Incremented when the payload shape changes in a way old readers cannot handle. */
export const QR_PAYLOAD_VERSION = 1

export interface ParticipantQrPayload {
  /** Payload version. */
  readonly v: number
  readonly event: EventId
  readonly participant: ParticipantId
  readonly code: PublicParticipantCode
}

export interface QrPayloadInput {
  readonly eventId: EventId
  readonly participantId: ParticipantId
  readonly publicCode: PublicParticipantCode
}

/** Builds the payload object for a participant. */
export function buildQrPayload(input: QrPayloadInput): ParticipantQrPayload {
  return {
    v: QR_PAYLOAD_VERSION,
    event: input.eventId,
    participant: input.participantId,
    code: input.publicCode,
  }
}

/**
 * The only supported path from a stored registration to a QR payload.
 *
 * Fields are copied one by one on purpose: a spread would silently start
 * leaking PII into stickers the moment the registration record grows a field.
 */
export function qrPayloadForRegistration(
  record: RegistrationRecord,
): ParticipantQrPayload {
  return buildQrPayload({
    eventId: record.eventId,
    participantId: record.participantId,
    publicCode: record.publicCode,
  })
}

/** Serialises a payload to the string a QR module will later encode. */
export function serializeQrPayload(payload: ParticipantQrPayload): string {
  return JSON.stringify({
    v: payload.v,
    event: payload.event,
    participant: payload.participant,
    code: payload.code,
  })
}

export type QrPayloadRejection =
  | 'invalid-json'
  | 'not-an-object'
  | 'unsupported-version'
  | 'missing-field'
  | 'invalid-participant-id'
  | 'invalid-public-code'
  | 'event-mismatch'

export type QrPayloadParseResult =
  | { readonly ok: true; readonly payload: ParticipantQrPayload }
  | { readonly ok: false; readonly reason: QrPayloadRejection }

export interface ParseQrPayloadOptions {
  /** When given, the payload must belong to this event. */
  readonly expectedEventId?: EventId
  /** When given, the embedded public code must come from this station. */
  readonly expectedStation?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Parses a scanned string into a payload, rejecting anything unexpected.
 *
 * A QR code is untrusted input: it may be from another event, another system,
 * a future version of this app, a damaged scan, or a sticker someone printed
 * themselves. Parsing successfully as JSON means nothing on its own, so every
 * field is checked, and the public code is re-validated against its own check
 * character rather than trusted because it appeared inside a payload.
 */
export function parseQrPayload(
  raw: string,
  options: ParseQrPayloadOptions = {},
): QrPayloadParseResult {
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }

  if (!isRecord(decoded)) {
    return { ok: false, reason: 'not-an-object' }
  }

  if (decoded['v'] !== QR_PAYLOAD_VERSION) {
    return {
      ok: false,
      reason:
        typeof decoded['v'] === 'number' ? 'unsupported-version' : 'missing-field',
    }
  }

  const event = readString(decoded, 'event')
  const participant = readString(decoded, 'participant')
  const code = readString(decoded, 'code')

  if (event === null || participant === null || code === null) {
    return { ok: false, reason: 'missing-field' }
  }

  if (!isUuid(participant)) {
    return { ok: false, reason: 'invalid-participant-id' }
  }

  if (
    options.expectedEventId !== undefined &&
    event !== options.expectedEventId
  ) {
    return { ok: false, reason: 'event-mismatch' }
  }

  const parsedCode = parsePublicCode(
    code,
    options.expectedStation === undefined
      ? {}
      : { expectedStation: options.expectedStation },
  )
  if (!parsedCode.ok) {
    return { ok: false, reason: 'invalid-public-code' }
  }

  return {
    ok: true,
    payload: {
      v: QR_PAYLOAD_VERSION,
      event: toEventId(event),
      participant: toParticipantId(participant),
      code: toPublicCode(parsedCode.code),
    },
  }
}
