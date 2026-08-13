import { newDeviceId } from '../identity/uuid'
import { deviceId as toDeviceId, type DeviceId } from '../../types'
import type { OfflineEventDb } from './db'

/*
 * Device identity.
 *
 *   first use -> no stored deviceId -> generate -> persist
 *   later use -> load the same stored deviceId
 *
 * A `deviceId` identifies a physical browser installation. It is not a station:
 * `A1` and `B1` are operational posts named in configuration, and during
 * development one browser can visit both routes while remaining one device.
 * Conflating them would make every record's provenance a guess.
 *
 * Stored in IndexedDB rather than localStorage so that device identity shares
 * the lifetime of the records stamped with it: if a browser evicts the
 * database, the records go with it and a fresh identity is correct. It survives
 * refreshes and browser restarts, and is expected not to survive a deliberate
 * "clear site data".
 */

export const DEVICE_ID_KEY = 'deviceId'

/**
 * Returns this installation's device ID, generating and persisting one on
 * first use.
 *
 * Get-or-create runs inside a single readwrite transaction. IndexedDB
 * serialises readwrite transactions with overlapping scopes, so two tabs
 * racing on first launch cannot both observe an empty store and mint competing
 * identities — the second transaction sees the first one's committed write.
 */
export async function getOrCreateDeviceId(
  database: OfflineEventDb,
): Promise<DeviceId> {
  return database.transaction('rw', database.deviceConfig, async () => {
    const existing = await database.deviceConfig.get(DEVICE_ID_KEY)
    if (existing !== undefined) {
      return toDeviceId(existing.value)
    }

    const generated = newDeviceId()
    await database.deviceConfig.add({
      key: DEVICE_ID_KEY,
      value: generated,
      updatedAt: new Date().toISOString(),
    })
    return generated
  })
}

/** Reads the stored device ID without creating one. */
export async function peekDeviceId(
  database: OfflineEventDb,
): Promise<DeviceId | undefined> {
  const row = await database.deviceConfig.get(DEVICE_ID_KEY)
  return row === undefined ? undefined : toDeviceId(row.value)
}
