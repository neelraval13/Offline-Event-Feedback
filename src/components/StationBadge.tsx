import type { StationConfig } from '../config/event'

/**
 * Shows which station and device this surface is acting as. Every record the
 * surface will eventually write is stamped with exactly these values.
 */
export function StationBadge({ station }: { readonly station: StationConfig }) {
  return (
    <dl className="station-badge">
      <div>
        <dt>Station</dt>
        <dd>{station.stationId}</dd>
      </div>
      <div>
        <dt>Device</dt>
        <dd>{station.deviceId}</dd>
      </div>
    </dl>
  )
}
