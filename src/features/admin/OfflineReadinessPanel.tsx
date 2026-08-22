import { DownloadIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { AppButton, StatusPill } from '../../components/design-system'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { describeAppVersion } from '../../lib/pwa/appVersion'
import {
  describeReadiness,
  type OfflineShellState,
} from '../../lib/pwa/offlineShell'
import { applyPendingUpdate } from '../../lib/pwa/useOfflineShell'
import { readinessStatus, type StorageHealth } from './AdminOverview'
import { FactRow, SectionHead } from './console'

/**
 * Device preparation: is this terminal safe to take into the field, and is
 * there a newer build waiting?
 *
 * This is the only place in the application that mentions updates. Point A and
 * Point B never do: an operator mid-registration must not be offered a button
 * that reloads the page.
 *
 * ## Readiness is not storage health
 *
 * The two are reported side by side and derived from nothing in common.
 * Readiness is the offline shell's answer about whether the application is
 * precached; whether IndexedDB accepts a write is `useDeviceDiagnostics`'s
 * answer and belongs to the storage banner. A device can hold a perfect
 * precache and be unable to persist a single record.
 *
 * `storage` reaches this section for one reason only: when the store is broken,
 * "this device can keep collecting" would read as permission. Readiness itself
 * is untouched by it.
 *
 * The shell state is passed in rather than subscribed to here, so the overview
 * above and this section cannot disagree about what the same store said.
 */
interface OfflineReadinessPanelProps {
  readonly shell: OfflineShellState
  readonly storage: StorageHealth
}

export function OfflineReadinessPanel({
  shell,
  storage,
}: OfflineReadinessPanelProps) {
  const { readiness, updateAvailable, errorMessage, applyingUpdate } = shell
  const [applyError, setApplyError] = useState<string | null>(null)

  async function handleApply() {
    setApplyError(null)
    try {
      await applyPendingUpdate()
    } catch (error) {
      // The running version is untouched and still working; only the switch to
      // the new one failed.
      setApplyError(
        error instanceof Error
          ? error.message
          : 'The update could not be applied.',
      )
    }
  }

  return (
    <section aria-labelledby="readiness-heading" className="flex flex-col">
      <SectionHead title="Device readiness" />
      <h2 id="readiness-heading" className="sr-only">
        Device readiness
      </h2>

      <FactRow label="Offline readiness">
        {/*
          The pill is the glance and the sentence is the answer, and the
          sentence is a superset of the pill: "Not ready" against "Not ready.
          Connect this device to the Internet before the event". So the pill is
          hidden from assistive technology here and the sentence is what gets
          announced, rather than a reader hearing the shorter version first and
          the fuller one immediately after. `contents` keeps the row's layout
          exactly as it is on screen.
        */}
        <span aria-hidden="true" className="contents">
          <StatusPill status={readinessStatus(readiness)} />
        </span>
        <span data-testid="offline-readiness" className="sr-only">
          {describeReadiness(readiness)}
        </span>
      </FactRow>

      <FactRow label="Application version">
        <span
          data-testid="app-version"
          className="font-mono text-small tabular-nums select-all"
        >
          {describeAppVersion()}
        </span>
      </FactRow>

      <FactRow label="Application update">
        {updateAvailable ? (
          <StatusPill status="pending" label="Update available" />
        ) : (
          <>
            <StatusPill status="synced" label="Up to date" />
            <span data-testid="update-status" className="sr-only">
              Application update: up to date.
            </span>
          </>
        )}
      </FactRow>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        {readiness === 'ready' && storage !== 'failed' && (
          <p className="max-w-measure font-body text-small text-muted">
            This device can keep collecting registrations and feedback with no
            network at all.
          </p>
        )}

        {/*
          Readiness is still reported truthfully above. What changes is the
          conclusion: a prepared shell with no writable store is prepared to do
          nothing useful, and the sentence above would read as permission.
        */}
        {readiness === 'ready' && storage === 'failed' && (
          <p className="max-w-measure font-body text-small text-muted">
            The application is prepared and would run without a network. It
            still must not be used: see the local storage problem above.
          </p>
        )}

        {readiness === 'preparing' && (
          <Alert tone="busy">
            <RefreshCwIcon aria-hidden="true" />
            <AlertTitle>Preparing for offline use</AlertTitle>
            <AlertDescription>
              Setup is still running. Keep this device on the Internet until it
              finishes; it is not ready to take to a venue yet.
            </AlertDescription>
          </Alert>
        )}

        {readiness === 'failed' && (
          <Alert tone="danger">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle className="font-display text-title tracking-wide">
              Not ready for offline use
            </AlertTitle>
            <AlertDescription>
              This device could not be prepared
              {errorMessage === null ? '' : `: ${errorMessage}`}. Connect it to
              the Internet and reload before the event: taken to a venue as it
              is, it will stop working the moment it loses the network.
            </AlertDescription>
          </Alert>
        )}

        {readiness === 'unsupported' && (
          <p className="max-w-measure font-body text-small text-muted">
            This browser or build cannot report offline readiness, so it is not
            being claimed either way. Do not rely on this device surviving a
            lost network until that is resolved.
          </p>
        )}

        {updateAvailable && (
          <Alert tone="info" data-testid="update-available">
            <DownloadIcon aria-hidden="true" />
            <AlertTitle>Application update available</AlertTitle>
            <AlertDescription>
              The running version keeps working until you apply it. Applying it
              reloads this terminal, so do it between participants or before a
              shift.
            </AlertDescription>
            <div className="col-start-2 flex flex-col gap-2 pt-2">
              <div>
                <AppButton
                  busy={applyingUpdate}
                  busyLabel="Applying…"
                  onClick={() => void handleApply()}
                >
                  Apply update
                </AppButton>
              </div>
              {applyError !== null && (
                <p role="alert" className="font-ui text-small font-medium text-danger">
                  {applyError} The version already on this device is unaffected.
                </p>
              )}
            </div>
          </Alert>
        )}
      </div>
    </section>
  )
}
