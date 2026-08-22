import { useState } from 'react'
import { AppSurface } from '@/components/design-system'
import { EVENT_CONFIG } from '@/config/event'
import { formatEventDay } from '@/config/eventTime'
import {
  DeviceDetails,
  LocalDataSection,
  OverviewBanner,
  ReadinessSection,
  StorageFailureBanner,
  SyncSection,
} from './AdminSections'
import { BackupSection } from './BackupSection'
import {
  ConceptStateBar,
  type BackupState,
  type HealthState,
  type StorageState,
  type SyncState,
} from './ConceptStateBar'
import {
  ERROR_COUNTS,
  HEALTHY_COUNTS,
  PENDING_COUNTS,
  type ConceptCounts,
} from './fixtures'

/*
 * Device Admin, V2: a concept.
 *
 * ## What this is not
 *
 * It is not the admin screen. `/#/admin` still renders `AdminScreen` exactly as
 * it did, and nothing in this directory is imported by it. This file opens no
 * database, runs no sync, enrols nothing, applies no application update, and
 * creates, verifies and restores no backups. Every value on screen comes from
 * `fixtures.ts`. Opening this route on a machine holding real event data cannot
 * change one byte of it.
 *
 * ## What the real Admin knows, and what this reproduces
 *
 * Read off the five production panels:
 *
 *   `useDeviceDiagnostics`  opens the store, and if it will not open reports an
 *                           error and no device id. Opening Admin is also how a
 *                           device acquires its identity before a shift.
 *   `OfflineReadinessPanel` readiness (unsupported / preparing / ready /
 *                           failed), the application version, and whether an
 *                           update is waiting. The only place in the product
 *                           that mentions updates.
 *   `LocalDataPanel`        six counts: totals, pending and errors, per store.
 *   `SyncPanel`             configured, secure, enrolled; last attempt and last
 *                           success; a manual run; and per-kind transport
 *                           failures that deliberately never say "sync failed".
 *   `BackupPanel`           create, verify, and a two-stage restore that
 *                           decrypts and shows a summary before it writes.
 *
 * ## The four questions, in order
 *
 * Is this device ready to work offline? Is its data safe and has it left this
 * machine? Can we recover it? And what does support need? The first three
 * belong to an event lead who has never heard of IndexedDB; the fourth belongs
 * to whoever they phone, and goes last and collapsed.
 *
 * V1 answered all four in the same voice, as five `<dl>` blocks of monospace
 * pairs, with the device UUID above everything else. That is the thing this
 * redesign is arguing with.
 */

export function AdminConcept() {
  const [health, setHealth] = useState<HealthState>('healthy')
  /*
   * Its own axis, and deliberately not derived from `health`.
   *
   * Offline readiness is the service worker's answer about the precached
   * shell; local-storage health is IndexedDB's answer about whether a write
   * lands. Either can be fine while the other is not, and an earlier draft of
   * this concept collapsed the two, which made a broken database report
   * "Offline readiness: Unknown". That was untrue and it was the wrong alarm.
   */
  const [storage, setStorage] = useState<StorageState>('ok')
  const [sync, setSync] = useState<SyncState>('enrolled')
  const [backup, setBackup] = useState<BackupState>('idle')

  /* The counts follow the sync story, because in reality they are the same
   * story: pending records exist because something has not been delivered. */
  const counts: ConceptCounts =
    sync === 'record-errors'
      ? ERROR_COUNTS
      : sync === 'enrolled' || sync === 'not-configured'
        ? HEALTHY_COUNTS
        : PENDING_COUNTS

  const blocked = storage === 'failed'

  return (
    <AppSurface width="wide" className="flex flex-col gap-page">
      <ConceptStateBar
        health={health}
        onHealth={setHealth}
        storage={storage}
        onStorage={setStorage}
        sync={sync}
        onSync={setSync}
        backup={backup}
        onBackup={setBackup}
      />

      {/*
        Deliberately not `PageHeader`. Its description sits at reading size and
        its status row is a second band, which together pushed the operational
        overview below the fold on a 1024 console: the one thing this screen
        exists to answer was the one thing not on screen when it opened.

        The event id is also not a `StatusPill` here. A pill means a state, and
        an identifier dressed as one reads as though the event were healthy or
        unhealthy. It is a fact, so it is set as a fact.
      */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-accent">
            Device Admin
          </span>
          <h1 className="font-display text-page leading-none tracking-wide text-ink">
            This device
          </h1>
        </div>

        <p className="flex flex-col text-right font-ui text-small leading-tight text-muted">
          <span className="font-mono">{EVENT_CONFIG.eventId}</span>
          <span className="text-faint">
            {formatEventDay(EVENT_CONFIG.eventDay)}
          </span>
        </p>
      </header>

      <p className="-mt-4 max-w-measure font-body text-small text-muted">
        Everything here is about the tablet you are holding. Nothing on this
        screen reaches another device, and nothing shows participant details.
      </p>

      {/*
        The one blocking state, above everything. No network is normal here and
        gets no banner at all; a store that will not open stops the station.
      */}
      {blocked && <StorageFailureBanner />}

      <OverviewBanner
        health={health}
        storage={storage}
        sync={sync}
        counts={counts}
      />

      {/*
        Readiness and sync side by side above `lg`: they are the two halves of
        "is this device fit to work", read together, and on a 1440 console
        stacking them wastes the width the wide measure exists to provide.
      */}
      <div className="grid gap-page lg:grid-cols-2">
        <ReadinessSection health={health} storage={storage} />
        <SyncSection sync={sync} counts={counts} />
      </div>

      <LocalDataSection counts={counts} />

      <BackupSection state={backup} onState={setBackup} />

      <DeviceDetails />
    </AppSurface>
  )
}
