import { OfflineEventDb } from '../lib/storage/db'
import {
  eventDay,
  eventId,
  stationId,
  type DeviceId,
  type RecordContext,
} from '../types'
import { newDeviceId } from '../lib/identity/uuid'

let counter = 0

/**
 * A database with a name unique to this call, so tests never share state and
 * can run in any order.
 */
export function createTestDb(): OfflineEventDb {
  counter += 1
  return new OfflineEventDb(`test-db-${counter}-${newDeviceId()}`)
}

/** Closes and removes a test database. */
export async function destroyTestDb(database: OfflineEventDb): Promise<void> {
  database.close()
  await database.delete()
}

/** A record context for tests that do not care about specific provenance. */
export function testContext(
  overrides: Partial<RecordContext> = {},
): RecordContext {
  return {
    eventId: eventId('evt-test'),
    eventDay: eventDay('2026-01-01'),
    stationId: stationId('A1'),
    deviceId: newDeviceId() as DeviceId,
    ...overrides,
  }
}
