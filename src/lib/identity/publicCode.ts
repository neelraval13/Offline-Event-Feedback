import {
  publicParticipantCode,
  type IssuerCode,
  type PublicParticipantCode,
  type StationId,
} from '../../types'
import { ISSUER_CODE_PATTERN } from './issuerCode'

/*
 * The human-readable fallback identity printed under the QR sticker.
 *
 *   A1-7F3C2A-00001-K
 *   ^^ ^^^^^^ ^^^^^ ^
 *   |  |      |     check character
 *   |  |      device-local registration sequence, zero-padded to 5+ digits
 *   |  issuing device (see issuerCode.ts)
 *   issuing station
 *
 * Properties this format is required to have:
 *
 * - unique across every device at the event, without any coordination between
 *   them: the issuer segment is what makes device-local counters safe
 * - readable and dictatable by staff under event conditions
 * - case-insensitive on entry, with one canonical stored form
 * - a check character that catches ordinary transcription slips
 * - validated deterministically and entirely offline (invariant 2)
 * - free of PII (invariant E); it carries a station, a device namespace and a
 *   counter, nothing else
 *
 * The check character is emphatically NOT a signature. It detects typing
 * mistakes. It does not authenticate anything, and anyone can compute one.
 */

/** Character values 0..35. Value 36 exists in the arithmetic but is never printed. */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const MODULUS = 37

/**
 * The check value that has no printable character. Sequences that produce it
 * are skipped at issue time rather than printed; see {@link isIssuableSequence}.
 */
const UNPRINTABLE_CHECK_VALUE = 36

/** Minimum width of the sequence segment; longer sequences are not truncated. */
export const SEQUENCE_PAD_WIDTH = 5

/** Sequences are 1-based; 0 is not a valid registration number. */
export const MIN_SEQUENCE = 1

/** Twelve digits: far beyond V1's ~10,000, and still comfortably readable. */
export const MAX_SEQUENCE = 999_999_999_999

const STATION_PATTERN = /^[0-9A-Z]{1,8}$/
const CODE_PATTERN = /^([0-9A-Z]{1,8})-([0-9A-F]{6})-([0-9]{1,12})-([0-9A-Z])$/

/** The device and station a code is issued by. */
export interface CodeIssuer {
  readonly stationId: StationId
  readonly issuerCode: IssuerCode
}

/**
 * ISO 7064 MOD 37-2: the pure check-character system with prime modulus 37,
 * computed over the alphabet 0-9A-Z.
 *
 *   P = 0
 *   for each character with value a:
 *     P = ((P + a) mod 37) * 2 mod 37
 *   check = (38 - P) mod 37
 *
 * Why this and not something else:
 *
 * - Damm and Verhoeff are defined for decimal input; our payload contains the
 *   station and issuer characters, so they do not apply without mangling the
 *   format.
 * - The obvious alternative, ISO 7064 MOD 37,36 (hybrid), needs no skipping,
 *   but measurement showed it misses a small class of adjacent transpositions,
 *   those where the two characters differ by exactly 1 in value. In a
 *   zero-padded numeric sequence that class is dominated by `0`<->`1` swaps,
 *   which is precisely the typo we most expect from manual entry, so the trade
 *   was not worth taking.
 * - A prime modulus buys total detection instead: every single-character
 *   substitution, every adjacent transposition and every jump transposition is
 *   caught. The price is that 1 in 37 payloads yields check value 36, which has
 *   no character in a 36-symbol alphabet. Those sequence numbers are skipped at
 *   issue time (~2.8% of the counter), which costs nothing: the sequence is a
 *   counter, not a census.
 *
 * These properties are pinned by exhaustive tests in `publicCode.test.ts`
 * rather than taken on trust.
 *
 * @param payload canonical station + issuer + padded sequence, e.g. `A17F3C2A00001`
 */
export function computeCheckCharacter(payload: string): string | null {
  let p = 0

  for (const character of payload) {
    const value = ALPHABET.indexOf(character)
    if (value < 0) {
      throw new Error(
        `Public code payload contains an unsupported character: ${character}`,
      )
    }
    p = (((p + value) % MODULUS) * 2) % MODULUS
  }

  const checkValue = (MODULUS + 1 - p) % MODULUS
  return checkValue === UNPRINTABLE_CHECK_VALUE
    ? null
    : (ALPHABET[checkValue] as string)
}

/**
 * The string the check character is computed over.
 *
 * The issuer is inside the payload, so a mistyped issuer segment fails the
 * checksum exactly like a mistyped sequence would. A code is validated as one
 * unit, not as segments that happen to sit next to each other.
 */
function checkPayload(issuer: CodeIssuer, sequence: number): string {
  return `${issuer.stationId}${issuer.issuerCode}${String(sequence).padStart(
    SEQUENCE_PAD_WIDTH,
    '0',
  )}`
}

function assertValidIssuer(issuer: CodeIssuer): CodeIssuer {
  const stationId = issuer.stationId.toUpperCase() as StationId
  const issuerCode = issuer.issuerCode.toUpperCase() as IssuerCode

  if (!STATION_PATTERN.test(stationId)) {
    throw new Error(`Invalid public code station: ${issuer.stationId}`)
  }
  if (!ISSUER_CODE_PATTERN.test(issuerCode)) {
    throw new Error(`Invalid public code issuer: ${issuer.issuerCode}`)
  }

  return { stationId, issuerCode }
}

function isSequenceInRange(sequence: number): boolean {
  return (
    Number.isInteger(sequence) &&
    sequence >= MIN_SEQUENCE &&
    sequence <= MAX_SEQUENCE
  )
}

/**
 * Whether a sequence number yields a printable code for this issuer.
 *
 * Roughly 1 in 37 does not. Callers allocating codes should use
 * {@link nextIssuableSequence} rather than testing this themselves.
 */
export function isIssuableSequence(
  issuer: CodeIssuer,
  sequence: number,
): boolean {
  if (!isSequenceInRange(sequence)) {
    return false
  }
  return (
    computeCheckCharacter(checkPayload(assertValidIssuer(issuer), sequence)) !==
    null
  )
}

/**
 * The first issuable sequence at or after `candidate`.
 *
 * Deterministic and pure, so the storage-backed allocator stays a plain counter
 * and the skipping rule lives here with the format it belongs to.
 */
export function nextIssuableSequence(
  issuer: CodeIssuer,
  candidate: number,
): number {
  const validated = assertValidIssuer(issuer)
  let sequence = Math.max(candidate, MIN_SEQUENCE)

  while (sequence <= MAX_SEQUENCE) {
    if (computeCheckCharacter(checkPayload(validated, sequence)) !== null) {
      return sequence
    }
    sequence += 1
  }

  throw new Error(
    `Public code sequence space exhausted for ${issuer.stationId}-${issuer.issuerCode}`,
  )
}

/**
 * Builds the canonical code for an issuer and a sequence number.
 *
 * Throws on invalid input: a bad station or issuer, an out-of-range sequence,
 * or a sequence that is not issuable is a programming error rather than a
 * user-entry error. Allocate through {@link nextIssuableSequence} first.
 */
export function formatPublicCode(
  issuer: CodeIssuer,
  sequence: number,
): PublicParticipantCode {
  const validated = assertValidIssuer(issuer)

  if (!isSequenceInRange(sequence)) {
    throw new Error(`Public code sequence out of range: ${sequence}`)
  }

  const checkCharacter = computeCheckCharacter(checkPayload(validated, sequence))
  if (checkCharacter === null) {
    throw new Error(
      `Sequence ${sequence} is not issuable for ${validated.stationId}-${validated.issuerCode}`,
    )
  }

  const padded = String(sequence).padStart(SEQUENCE_PAD_WIDTH, '0')
  return publicParticipantCode(
    `${validated.stationId}-${validated.issuerCode}-${padded}-${checkCharacter}`,
  )
}

/**
 * Reduces anything staff might type to a comparable form: upper-cased, with
 * any run of separators (spaces, dashes, dots, slashes) collapsed to a single
 * dash and stripped from the ends.
 *
 * Deliberately does NOT fold visually similar characters (O/0, I/1): the check
 * character is drawn from the full 0-9A-Z alphabet, so folding would corrupt
 * legitimate codes. The issuer segment is hexadecimal precisely so that it
 * cannot contribute to this problem.
 */
export function normalizePublicCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export type PublicCodeRejection =
  | 'malformed'
  | 'sequence-out-of-range'
  | 'unexpected-station'
  | 'invalid-check-character'

export type PublicCodeParseResult =
  | {
      readonly ok: true
      /** The canonical form, regardless of how it was typed. */
      readonly code: PublicParticipantCode
      readonly stationId: StationId
      readonly issuerCode: IssuerCode
      readonly sequence: number
      readonly checkCharacter: string
    }
  | { readonly ok: false; readonly reason: PublicCodeRejection }

export interface ParsePublicCodeOptions {
  /**
   * When given, the code must have been issued at this station.
   *
   * There is deliberately no matching `expectedIssuer`. Point B receives
   * stickers from every device that registered participants, so constraining
   * the issuer would reject legitimate codes. The issuer is a namespace, not
   * an access check.
   */
  readonly expectedStation?: string
}

/**
 * Parses and validates a code as typed by staff.
 *
 * Tolerates casing, separator style and short-form sequences (`A1-7F3C2A-1-K`
 * is accepted as `A1-7F3C2A-00001-K`, because the check character is computed
 * over the canonical padded payload rather than over the typed characters).
 */
export function parsePublicCode(
  raw: string,
  options: ParsePublicCodeOptions = {},
): PublicCodeParseResult {
  const match = CODE_PATTERN.exec(normalizePublicCode(raw))
  if (!match) {
    return { ok: false, reason: 'malformed' }
  }

  const [, station = '', issuer = '', digits = '', checkCharacter = ''] = match
  const sequence = Number.parseInt(digits, 10)

  if (!isSequenceInRange(sequence)) {
    return { ok: false, reason: 'sequence-out-of-range' }
  }

  if (
    options.expectedStation !== undefined &&
    station !== options.expectedStation.toUpperCase()
  ) {
    return { ok: false, reason: 'unexpected-station' }
  }

  const issued: CodeIssuer = {
    stationId: station as StationId,
    issuerCode: issuer as IssuerCode,
  }

  if (computeCheckCharacter(checkPayload(issued, sequence)) !== checkCharacter) {
    return { ok: false, reason: 'invalid-check-character' }
  }

  return {
    ok: true,
    code: publicParticipantCode(
      `${station}-${issuer}-${String(sequence).padStart(
        SEQUENCE_PAD_WIDTH,
        '0',
      )}-${checkCharacter}`,
    ),
    stationId: issued.stationId,
    issuerCode: issued.issuerCode,
    sequence,
    checkCharacter,
  }
}

/** Convenience predicate over {@link parsePublicCode}. */
export function isValidPublicCode(
  raw: string,
  options: ParsePublicCodeOptions = {},
): boolean {
  return parsePublicCode(raw, options).ok
}
