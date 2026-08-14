import { useState } from 'react'
import { PendingCapabilities } from '../../components/PendingCapabilities'
import { EVENT_CONFIG } from '../../config/event'
import { BackupPanel } from './BackupPanel'
import { LocalDataPanel } from './LocalDataPanel'
import { OfflineReadinessPanel } from './OfflineReadinessPanel'
import { SyncPanel } from './SyncPanel'
import { useDeviceDiagnostics } from './useDeviceDiagnostics'

/** Local device utilities for staff supporting a station. */
export function AdminScreen() {
  const { loading, deviceId, database, error } = useDeviceDiagnostics()
  // Bumped after a restore so the counts above reflect the merged data.
  const [dataGeneration, setDataGeneration] = useState(0)

  return (
    <article className="screen">
      <h1>Device Admin</h1>
      <p className="screen__lede">
        Local utilities for the device this app is running on. Nothing here
        reaches another device or a server.
      </p>

      <dl className="station-badge">
        <div>
          <dt>Event</dt>
          <dd>{EVENT_CONFIG.eventId}</dd>
        </div>
        <div>
          <dt>Day</dt>
          <dd>{EVENT_CONFIG.eventDay}</dd>
        </div>
      </dl>

      <section>
        <h2 className="pending__title">Diagnostics</h2>
        <dl className="station-badge">
          <div>
            <dt>Device ID</dt>
            <dd>{loading ? 'Checking…' : (deviceId ?? 'Unavailable')}</dd>
          </div>
          <div>
            <dt>Local database</dt>
            <dd>
              {loading
                ? 'Checking…'
                : database === null
                  ? 'Unknown'
                  : `${database.name} v${database.openVersion ?? database.expectedVersion}: ${database.state}`}
            </dd>
          </div>
        </dl>
        {error !== null && (
          <p role="alert" className="screen__note">
            Local storage problem: {error}. This device cannot safely take
            registrations until it is resolved.
          </p>
        )}
      </section>

      <OfflineReadinessPanel />

      <LocalDataPanel refreshToken={dataGeneration} />

      <BackupPanel onDataChanged={() => setDataGeneration((n) => n + 1)} />

      <SyncPanel onDataChanged={() => setDataGeneration((n) => n + 1)} />

      <PendingCapabilities
        items={['Reconciliation of conflicting records', 'Central reporting']}
      />
    </article>
  )
}
