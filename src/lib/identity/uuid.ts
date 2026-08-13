import { v4 as uuidv4, v7 as uuidv7, validate as uuidValidate } from 'uuid'
import {
  deviceId,
  participantId,
  recordId,
  type DeviceId,
  type ParticipantId,
  type RecordId,
} from '../../types'

/*
 * Identifier generation.
 *
 * Why the `uuid` package rather than `crypto.randomUUID()`:
 *
 * 1. `crypto.randomUUID()` is restricted to secure contexts. This app is
 *    expected to be served at a venue, possibly from a laptop over plain HTTP
 *    on a LAN address, where it is simply `undefined`. `crypto.getRandomValues`
 *    — which this package uses — has no such restriction. Discovering that at
 *    the event would be unrecoverable.
 * 2. UUIDv7 is time-ordered. Sequentially increasing primary keys keep
 *    IndexedDB's B-tree inserts local rather than scattered across the
 *    keyspace over ~10,000 registrations, records sort chronologically for
 *    free, and future sync batches upload in creation order.
 *
 * Randomness still comes from a CSPRNG: v7 carries 74 random bits, which over
 * 10,000 IDs generated inside the same millisecond-ordered space leaves
 * collision probability far below any operational concern.
 */

/** Canonical UUID shape, any version. */
export function isUuid(value: string): boolean {
  return uuidValidate(value)
}

/** Machine identity of a participant (invariant A). Time-ordered. */
export function newParticipantId(): ParticipantId {
  return participantId(uuidv7())
}

/** Identity of a stored record; the future sync idempotency key. */
export function newRecordId(): RecordId {
  return recordId(uuidv7())
}

/**
 * Identity of a physical browser installation.
 *
 * v4 rather than v7: a device ID gains nothing from being sortable, and there
 * is no reason to embed the moment a device was first provisioned.
 */
export function newDeviceId(): DeviceId {
  return deviceId(uuidv4())
}
