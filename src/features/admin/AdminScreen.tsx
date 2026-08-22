import { OctagonAlertIcon } from 'lucide-react'
import { useCallback, useState } from 'react'
import { AppSurface } from '../../components/design-system'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { EVENT_CONFIG } from '../../config/event'
import { formatEventDay } from '../../config/eventTime'
import { useOfflineShellState } from '../../lib/pwa/useOfflineShell'
import type { BackupMetadata } from '../../lib/backup/backupMetadata'
import { AdminOverview, type StorageHealth, type SyncSummary } from './AdminOverview'
import { BackupPanel } from './BackupPanel'
import { DeviceDetails } from './DeviceDetails'
import { LocalDataPanel } from './LocalDataPanel'
import { OfflineReadinessPanel } from './OfflineReadinessPanel'
import { SyncPanel } from './SyncPanel'
import { useAdminFacts } from './useAdminFacts'
import { useDeviceDiagnostics } from './useDeviceDiagnostics'

/**
 * Device Admin: the operational console for the tablet this is running on.
 *
 * It answers four questions, in this order:
 *
 *   1. Is this device ready to work offline?
 *   2. Is its data safe, and has it left this machine?
 *   3. Can we recover it if something happens?
 *   4. What does support need to know?
 *
 * The first three belong to an event lead who has never heard of IndexedDB. The
 * fourth belongs to whoever they phone, and goes last and collapsed. V1
 * answered all four in one voice, as five `<dl>` blocks of monospace pairs with
 * the device UUID above everything else.
 *
 * ## Offline readiness and local storage are independent
 *
 * This is the rule the screen is built around and the one easiest to break by
 * accident. Readiness is the offline shell's answer about whether the
 * application is precached; storage health is `useDeviceDiagnostics`'s answer
 * about whether IndexedDB will open. They come from different systems, and
 * neither is derived from the other anywhere in this tree.
 *
 * The combination that matters is a perfectly prepared shell on a device that
 * cannot persist a record: readiness stays green and truthful, local storage
 * goes red, and the blocking banner says the station must stop. Reporting that
 * as "Offline readiness: Unknown" would be untrue about the shell and the wrong
 * alarm about the store. `readinessStatus` takes a readiness value and nothing
 * else, which is what makes the coupling unexpressible rather than merely
 * absent.
 *
 * ## Where the reads live
 *
 * Counts, the sync credential and sync activity are read once here and handed
 * down, so the overview and the sections below cannot disagree about them. That
 * is a consolidation of reads only: sync's own behaviour, the opportunistic
 * attempt on open and on `online`, stays in `SyncPanel`.
 */
export function AdminScreen() {
  const { loading, deviceId, database, error } = useDeviceDiagnostics()
  const shell = useOfflineShellState()

  // Bumped after a restore or a sync so the counts below reflect the change.
  const [dataGeneration, setDataGeneration] = useState(0)
  const facts = useAdminFacts(dataGeneration)

  const [syncSummary, setSyncSummary] = useState<SyncSummary>('checking')
  const [backupMetadata, setBackupMetadata] = useState<BackupMetadata | null>(
    null,
  )

  const onDataChanged = useCallback(() => {
    setDataGeneration((generation) => generation + 1)
  }, [])

  /*
   * Storage health, from diagnostics and from nothing else. `error` is set when
   * the store would not open or the device identity could not be established;
   * either way this device cannot be trusted to keep a record.
   */
  const storage: StorageHealth = loading
    ? 'checking'
    : error !== null
      ? 'failed'
      : 'ok'

  return (
    <AppSurface width="wide" className="flex flex-col gap-page">
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
        Everything here is about the device you are holding. No participant
        details are shown on this screen.
      </p>

      {/*
        The one blocking state, above everything. No network is normal here and
        gets no banner at all; a store that will not open stops the station.
      */}
      {error !== null && (
        <Alert tone="danger">
          <OctagonAlertIcon aria-hidden="true" />
          <AlertTitle className="font-display text-title tracking-wide">
            Local storage problem
          </AlertTitle>
          <AlertDescription>
            This device cannot write to its own database: {error}. It must not
            take registrations or feedback, because new records cannot be
            persisted: everything captured at Point A or Point B would be lost.
            Move the station to another tablet and tell whoever is running the
            event.
            <br />
            <br />
            This is separate from offline readiness above. The application may be
            perfectly prepared to run without a network; the problem is that
            there is nowhere to put what it collects.
          </AlertDescription>
        </Alert>
      )}

      <AdminOverview
        readiness={shell.readiness}
        storage={storage}
        sync={syncSummary}
        counts={facts.counts}
        countsUnavailable={facts.countsError !== null}
        activity={facts.activity}
        lastBackupVerifiedAt={backupMetadata?.lastBackupVerifiedAt ?? null}
      />

      {/*
        Readiness and sync side by side above `lg`: two halves of "is this
        device fit to work", read together. On a 1440 console, stacking them
        wastes the width the wide measure exists to provide.
      */}
      <div className="grid gap-page lg:grid-cols-2">
        <OfflineReadinessPanel shell={shell} storage={storage} />
        <SyncPanel
          counts={facts.counts}
          countsUnavailable={facts.countsError !== null}
          credentialPresent={facts.credentialPresent}
          credentialError={facts.credentialError}
          activity={facts.activity}
          onRefresh={facts.refresh}
          onDataChanged={onDataChanged}
          onSummaryChange={setSyncSummary}
        />
      </div>

      <LocalDataPanel counts={facts.counts} error={facts.countsError} />

      <BackupPanel
        onDataChanged={onDataChanged}
        onMetadataChange={setBackupMetadata}
      />

      <DeviceDetails loading={loading} deviceId={deviceId} database={database} />
    </AppSurface>
  )
}
