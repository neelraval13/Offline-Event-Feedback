import type { Brand } from './brand'

/** Identifies one event. V1 runs exactly one, but records still carry it. */
export type EventId = Brand<string, 'EventId'>

/** A single operating day of an event, as an ISO calendar date (YYYY-MM-DD). */
export type EventDay = Brand<string, 'EventDay'>

/**
 * A physical post within an event, e.g. `A1` (registration) or `B1` (feedback).
 * V1 has exactly one of each; the type does not assume that.
 */
export type StationId = Brand<string, 'StationId'>

/** One physical device operating at a station. Several may share a station. */
export type DeviceId = Brand<string, 'DeviceId'>

/**
 * Internal, system-wide identity of a participant. Contains no PII and is the
 * value the QR sticker encodes.
 */
export type ParticipantId = Brand<string, 'ParticipantId'>

/**
 * Short, stable, printable identifier for the device that issued a public
 * code, derived deterministically from its `DeviceId`.
 *
 * It exists because IndexedDB is device-local: without it, two installations
 * working the same station would each start their counter at 1 and print the
 * same visible code for different people.
 */
export type IssuerCode = Brand<string, 'IssuerCode'>

/**
 * Short human-readable code printed under the QR, used when scanning fails.
 * Format: `<station>-<issuer>-<sequence>-<check>`, e.g. `A1-7F3C2A-00001-K`.
 */
export type PublicParticipantCode = Brand<string, 'PublicParticipantCode'>

/**
 * Client-generated identity of a single stored record. This is the idempotency
 * key that lets synchronisation run repeatedly and out of order without
 * creating duplicates (invariant 3).
 */
export type RecordId = Brand<string, 'RecordId'>

/** An ISO-8601 instant, recorded from the capturing device's clock. */
export type IsoTimestamp = Brand<string, 'IsoTimestamp'>

/*
 * Narrowing helpers.
 *
 * These only apply the brand; they intentionally do not validate. Format
 * rules (participant ID scheme, public-code checksum, date shape) are decided
 * in later phases, and the parsing/validation logic will land here so that
 * every branded value in the system has exactly one entry point.
 */

export const eventId = (value: string): EventId => value as EventId
export const eventDay = (value: string): EventDay => value as EventDay
export const stationId = (value: string): StationId => value as StationId
export const deviceId = (value: string): DeviceId => value as DeviceId
export const participantId = (value: string): ParticipantId =>
  value as ParticipantId
export const issuerCode = (value: string): IssuerCode => value as IssuerCode
export const publicParticipantCode = (value: string): PublicParticipantCode =>
  value as PublicParticipantCode
export const recordId = (value: string): RecordId => value as RecordId
export const isoTimestamp = (value: string): IsoTimestamp =>
  value as IsoTimestamp
