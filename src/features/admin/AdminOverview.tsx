import type { ReactNode } from 'react'
import { StatusPill } from '../../components/design-system'
import type { StatusKey } from '../../components/design-system/status'
import { describeAppVersion } from '../../lib/pwa/appVersion'
import type { OfflineReadiness } from '../../lib/pwa/offlineShell'
import type { LocalCounts } from '../../lib/storage'
import type { SyncActivity } from '../../lib/sync'
import { cn } from '../../lib/ui/cn'
import { Figure, formatMoment, SectionHead } from './console'

/*
 * The first viewport, and the whole point of the screen.
 *
 * Five facts, one line each, in the order an event lead worries about them. No
 * "Event ready" or "Device healthy" boolean is invented: the application has no
 * truthful definition of one, and a single green tick averaging five different
 * facts would be the most dangerous thing on this page. These are the actual
 * underlying states, side by side, and the reader does the combining.
 *
 * Not five stat cards. A `0` in a bordered tile reads as a metric somebody is
 * meant to grow; `Errors 0` on a rule reads as a fact that is currently fine,
 * which is what it is.
 */

/**
 * Whether this device can write to its own store.
 *
 * A different question from offline readiness, answered by a different system.
 * See `readinessStatus` below.
 */
export type StorageHealth = 'checking' | 'ok' | 'failed'

/**
 * What the offline shell says about itself, and nothing else.
 *
 * Takes a readiness value and only a readiness value. That signature is the
 * guarantee: this function cannot consult local-storage health because it is
 * never given it, so no later edit can quietly make a broken database report
 * "Offline readiness: Unknown".
 *
 * The two facts come from different systems. Readiness is the service worker's
 * answer about whether the application shell is precached; storage health is
 * IndexedDB's answer about whether a write lands. Either can be fine while the
 * other is not, and the combination that matters most is a perfectly prepared
 * shell on a device that cannot persist a record: it is ready to run offline
 * and has nowhere to put what it collects.
 *
 * `unknown` is reserved for readiness being genuinely unknowable: a browser
 * without service workers, or a dev build with none registered.
 */
export function readinessStatus(readiness: OfflineReadiness): StatusKey {
  switch (readiness) {
    case 'ready':
      return 'offline-ready'
    case 'preparing':
      return 'offline-preparing'
    case 'failed':
      return 'offline-failed'
    case 'unsupported':
      return 'unknown'
  }
}

/** What sync is doing, from the facts the panel already has. */
export type SyncSummary =
  | 'checking'
  | 'not-configured'
  | 'not-enrolled'
  | 'enrolled'
  | 'syncing'
  | 'unreachable'
  | 'unauthorized'
  | 'record-errors'
  /** The store would not answer, so the enrolment state is not knowable. */
  | 'unavailable'

export function syncStatus(summary: SyncSummary): StatusKey {
  switch (summary) {
    case 'checking':
    case 'unavailable':
      return 'unknown'
    case 'not-configured':
      return 'offline-unsupported'
    case 'not-enrolled':
      return 'not-enrolled'
    case 'syncing':
      return 'syncing'
    /*
     * Amber, never red. The server was not reachable; nothing failed and
     * nothing was lost, the records are exactly where they were and the device
     * carries on collecting. Red here would teach an operator to ignore red by
     * the third time a venue's wifi dropped.
     */
    case 'unreachable':
      return 'pending'
    case 'unauthorized':
    case 'record-errors':
      return 'sync-error'
    case 'enrolled':
      return 'enrolled'
  }
}

export function syncLabel(summary: SyncSummary): string | undefined {
  switch (summary) {
    case 'checking':
      return 'Checking'
    case 'unavailable':
      return 'Unavailable'
    case 'not-configured':
      return 'Not configured'
    case 'unreachable':
      return 'Server unreachable'
    case 'unauthorized':
      return 'Re-enrolment needed'
    case 'record-errors':
      return 'Records refused'
    default:
      return undefined
  }
}

interface AdminOverviewProps {
  readonly readiness: OfflineReadiness
  readonly storage: StorageHealth
  readonly sync: SyncSummary
  readonly counts: LocalCounts | null
  /** True when the counts could not be read, rather than not read yet. */
  readonly countsUnavailable: boolean
  readonly activity: SyncActivity | null
  readonly lastBackupVerifiedAt: string | null
}

export function AdminOverview({
  readiness,
  storage,
  sync,
  counts,
  countsUnavailable,
  activity,
  lastBackupVerifiedAt,
}: AdminOverviewProps) {
  const pending =
    counts === null
      ? null
      : counts.registrations.pending + counts.feedback.pending
  const errors =
    counts === null ? null : counts.registrations.error + counts.feedback.error

  return (
    <section aria-labelledby="overview-heading" className="flex flex-col gap-3">
      <SectionHead title="Operational overview" />
      <h2 id="overview-heading" className="sr-only">
        Operational overview
      </h2>

      <div
        className={cn(
          'grid gap-x-8 rounded-card border px-5 py-1',
          /*
           * Five across where five fit, and fewer where they do not, decided
           * by the content rather than by a breakpoint. "Ready for offline
           * use" is a wide pill and a badge does not wrap, so equal fifths of
           * a 1024 workspace put the readiness and sync pills on top of each
           * other. 14rem is the floor that keeps the widest of them intact
           * with room to spare: five columns on a 1440 console, three on a
           * 1024 tablet, two on a narrow one, one on a phone.
           */
          'grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]',
          /*
           * The panel's own alarm follows the store, not the shell: a device
           * that cannot write is the one that must stop, whatever its
           * readiness says.
           */
          storage === 'failed'
            ? 'border-danger-line bg-danger-soft/40'
            : 'border-line bg-surface',
        )}
      >
        <Cell label="Offline readiness" testId="overview-readiness">
          <StatusPill status={readinessStatus(readiness)} />
        </Cell>

        <Cell label="Central sync" testId="overview-sync">
          <StatusPill
            status={syncStatus(sync)}
            {...labelFor(syncLabel(sync))}
          />
        </Cell>

        {/*
          Local storage, beside readiness rather than instead of it. Healthy,
          this is one more quiet green row; failed, it is the only red thing in
          the panel and readiness is still telling the truth next to it.
        */}
        <Cell label="Local storage" testId="overview-storage">
          <StatusPill
            status={storageStatus(storage)}
            label={storageLabel(storage)}
          />
        </Cell>

        <Cell label="Pending records" testId="overview-pending">
          {pending === null ? (
            <Waiting unavailable={countsUnavailable} />
          ) : (
            <Figure value={pending} tone={pending > 0 ? 'warn' : 'plain'} />
          )}
        </Cell>

        <Cell label="Errors" testId="overview-errors">
          {errors === null ? (
            <Waiting unavailable={countsUnavailable} />
          ) : (
            <Figure value={errors} tone={errors > 0 ? 'danger' : 'plain'} />
          )}
        </Cell>
      </div>

      {/*
        Supporting facts, one quiet line. Useful the moment somebody asks "when
        did this last work", and never the first thing read.
      */}
      <p className="flex flex-wrap gap-x-6 gap-y-1 font-ui text-small text-faint">
        <span>
          Last successful sync · {formatMoment(activity?.lastSuccessAt ?? null)}
        </span>
        <span>Last verified backup · {formatMoment(lastBackupVerifiedAt)}</span>
        <span>Version · {describeAppVersion()}</span>
      </p>
    </section>
  )
}

function Cell({
  label,
  testId,
  children,
}: {
  readonly label: string
  readonly testId: string
  readonly children: ReactNode
}) {
  return (
    <div
      data-testid={testId}
      className="flex min-w-0 flex-col gap-1.5 border-b border-line py-4 last:border-b-0 lg:border-b-0"
    >
      <span className="font-ui text-label font-semibold uppercase tracking-[0.1em] text-muted">
        {label}
      </span>
      {children}
    </div>
  )
}

/**
 * A figure that is not here.
 *
 * "Counting…" is a promise that a number is on its way. When the store refused
 * to answer, no number is coming, and leaving the ellipsis up tells an operator
 * to keep waiting instead of to stop taking registrations.
 */
function Waiting({ unavailable }: { readonly unavailable: boolean }) {
  return (
    <span className="font-ui text-base text-faint">
      {unavailable ? 'Unavailable' : 'Counting…'}
    </span>
  )
}

function storageStatus(storage: StorageHealth): StatusKey {
  switch (storage) {
    case 'checking':
      return 'unknown'
    case 'failed':
      return 'sync-error'
    case 'ok':
      return 'synced'
  }
}

function storageLabel(storage: StorageHealth): string {
  switch (storage) {
    case 'checking':
      return 'Checking'
    case 'failed':
      return 'Cannot write'
    case 'ok':
      return 'Healthy'
  }
}

/** Spreads a `label` override only when there is one to give. */
function labelFor(label: string | undefined) {
  return label === undefined ? {} : { label }
}
