import { ChevronDownIcon } from 'lucide-react'
import { useState } from 'react'
import { EVENT_CONFIG } from '../../config/event'
import { describeAppVersion } from '../../lib/pwa/appVersion'
import type { DatabaseStatus } from '../../lib/storage'
import type { DeviceId } from '../../types'
import { cn } from '../../lib/ui/cn'

/**
 * The technical facts, last and collapsed.
 *
 * Valuable to whoever an event lead phones, and useless to the event lead. V1
 * put the device UUID above everything else on the screen, in the same
 * treatment as "Ready for offline use", which is how a support identifier came
 * to outrank the one line that decides whether the device can be used at all.
 *
 * Collapsed, not hidden: one tap, and every value is selectable so it can be
 * read out or pasted into a message.
 *
 * Counts and identifiers only. Nothing here names a participant.
 */
interface DeviceDetailsProps {
  readonly loading: boolean
  readonly deviceId: DeviceId | null
  readonly database: DatabaseStatus | null
}

export function DeviceDetails({
  loading,
  deviceId,
  database,
}: DeviceDetailsProps) {
  const [open, setOpen] = useState(false)

  const databaseLine =
    loading
      ? 'Checking…'
      : database === null
        ? 'Unknown'
        : `${database.name} v${database.openVersion ?? database.expectedVersion}: ${database.state}`

  return (
    <section aria-labelledby="details-heading" className="flex flex-col">
      <h2 id="details-heading" className="sr-only">
        Device details
      </h2>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex min-h-touch w-full items-center gap-3 border-t border-line px-1 py-3 text-left',
          'font-ui text-label font-semibold uppercase tracking-[0.16em] text-muted',
          'transition-colors hover:text-ink',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive',
        )}
      >
        <span className="min-w-0 flex-1">Device details</span>
        <span className="font-ui text-small font-normal normal-case tracking-normal text-faint">
          For support
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="grid gap-x-10 pb-2 md:grid-cols-2">
          <div className="flex flex-col">
            <DetailRow
              label="Device ID"
              value={loading ? 'Checking…' : (deviceId ?? 'Unavailable')}
            />
            <DetailRow label="Local database" value={databaseLine} />
          </div>
          <div className="flex flex-col">
            <DetailRow label="Event ID" value={EVENT_CONFIG.eventId} />
            <DetailRow label="Event day" value={EVENT_CONFIG.eventDay} />
            <DetailRow label="Application" value={describeAppVersion()} />
          </div>
        </div>
      )}
    </section>
  )
}

function DetailRow({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-line py-3">
      <span className="font-ui text-small text-muted">{label}</span>
      {/*
        `select-all` so one tap grabs the whole identifier: these get read down
        a phone or pasted into a message, and a half-selected UUID is worse than
        none. `break-all` because a UUID has nowhere polite to wrap.
      */}
      <span className="font-mono text-small break-all select-all text-ink">
        {value}
      </span>
    </div>
  )
}
