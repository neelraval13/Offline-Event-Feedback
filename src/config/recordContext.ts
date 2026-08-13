import type { DeviceId, RecordContext } from '../types'
import { EVENT_CONFIG, stationFor, type StationRole } from './event'

/**
 * Combines the configured event/station with this installation's device
 * identity to produce the provenance stamped on records.
 *
 * The two halves come from different places on purpose: event and station are
 * operational configuration, while the device ID is discovered at runtime from
 * local storage.
 */
export function recordContextFor(
  role: StationRole,
  deviceId: DeviceId,
): RecordContext {
  return {
    eventId: EVENT_CONFIG.eventId,
    eventDay: EVENT_CONFIG.eventDay,
    stationId: stationFor(role).stationId,
    deviceId,
  }
}
