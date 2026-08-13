import { newRecordId } from '../identity/uuid'
import {
  isoTimestamp,
  type IsoTimestamp,
  type OfflineRecordMetadata,
  type RecordContext,
} from '../../types'

/** Device-clock timestamp. Devices are offline, so clocks may drift. */
export function now(): IsoTimestamp {
  return isoTimestamp(new Date().toISOString())
}

/**
 * Metadata for a freshly captured record.
 *
 * `syncStatus` starts at `pending` and nothing in this phase moves it. The
 * `recordId` is generated here and never regenerated: it is the value that will
 * make upload idempotent, so a retried upload of the same record must carry the
 * same one (invariant 3).
 */
export function newRecordMetadata(
  context: RecordContext,
): OfflineRecordMetadata {
  const timestamp = now()

  return {
    recordId: newRecordId(),
    eventId: context.eventId,
    eventDay: context.eventDay,
    stationId: context.stationId,
    deviceId: context.deviceId,
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 1,
    syncStatus: 'pending',
  }
}
