import { PendingCapabilities } from '../../components/PendingCapabilities'
import { EVENT_CONFIG } from '../../config/event'

/** Local device utilities for staff supporting a station. Phase 0 placeholder. */
export function AdminScreen() {
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
      <PendingCapabilities
        items={[
          'Local record counts',
          'Backup and export of local records',
          'Sync state and outbox inspection',
          'Diagnostic information',
        ]}
      />
    </article>
  )
}
