import type { StationConfig } from '../config/event'

/**
 * Shows which station this surface is acting as. Every record the surface will
 * eventually write is stamped with this station ID.
 *
 * Device identity is deliberately not shown here: it belongs to the browser
 * installation rather than to the post, and it is diagnostic information for
 * the admin screen rather than something staff at a desk needs.
 */
export function StationBadge({ station }: { readonly station: StationConfig }) {
  return (
    <dl className="station-badge">
      <div>
        <dt>Station</dt>
        <dd>{station.stationId}</dd>
      </div>
      <div>
        <dt>Post</dt>
        <dd>{station.label}</dd>
      </div>
    </dl>
  )
}
