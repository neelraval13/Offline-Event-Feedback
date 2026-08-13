import { useEffect, useState } from 'react'
import {
  db,
  getDatabaseStatus,
  getOrCreateDeviceId,
  type DatabaseStatus,
} from '../../lib/storage'
import type { DeviceId } from '../../types'

export interface DeviceDiagnostics {
  readonly loading: boolean
  readonly deviceId: DeviceId | null
  readonly database: DatabaseStatus | null
  /** Set when device identity could not be established at all. */
  readonly error: string | null
}

const INITIAL: DeviceDiagnostics = {
  loading: true,
  deviceId: null,
  database: null,
  error: null,
}

/**
 * Reads this installation's identity and the health of local storage.
 *
 * Provisioning the device ID on the admin screen is a side effect worth having:
 * opening admin once is how a device gets its identity before a shift starts.
 */
export function useDeviceDiagnostics(): DeviceDiagnostics {
  const [diagnostics, setDiagnostics] = useState<DeviceDiagnostics>(INITIAL)

  useEffect(() => {
    let active = true

    void (async () => {
      const database = await getDatabaseStatus(db)

      if (database.state !== 'ready') {
        if (active) {
          setDiagnostics({
            loading: false,
            deviceId: null,
            database,
            error: database.message ?? 'Local storage is unavailable.',
          })
        }
        return
      }

      try {
        const deviceId = await getOrCreateDeviceId(db)
        if (active) {
          setDiagnostics({ loading: false, deviceId, database, error: null })
        }
      } catch (error) {
        if (active) {
          setDiagnostics({
            loading: false,
            deviceId: null,
            database,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    })()

    return () => {
      active = false
    }
  }, [])

  return diagnostics
}
