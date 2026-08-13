import { useState } from 'react'
import { describeAppVersion } from '../../lib/pwa/appVersion'
import { describeReadiness } from '../../lib/pwa/offlineShell'
import {
  applyPendingUpdate,
  useOfflineShellState,
} from '../../lib/pwa/useOfflineShell'

/**
 * Device preparation: is this terminal safe to take into the field, and is
 * there a newer build waiting?
 *
 * This is the only place in the application that mentions updates. Point A and
 * Point B never do — an operator mid-registration must not be offered a button
 * that reloads the page.
 */
export function OfflineReadinessPanel() {
  const { readiness, updateAvailable, errorMessage, applyingUpdate } =
    useOfflineShellState()
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
    <section aria-labelledby="readiness-heading">
      <h2 id="readiness-heading" className="pending__title">
        Device preparation
      </h2>

      <dl className="station-badge">
        <div>
          <dt>Offline readiness</dt>
          <dd data-testid="offline-readiness">
            {describeReadiness(readiness)}
          </dd>
        </div>
        <div>
          <dt>Application version</dt>
          <dd data-testid="app-version">{describeAppVersion()}</dd>
        </div>
      </dl>

      {readiness === 'failed' && errorMessage !== null && (
        <p className="notice notice--error" role="alert">
          This device could not be prepared for offline use: {errorMessage}.
          Connect it to the Internet and reload before the event.
        </p>
      )}

      {updateAvailable ? (
        <div className="notice" data-testid="update-available">
          <p>
            <strong>Application update available.</strong> The running version
            keeps working until you apply it. Apply it between participants, or
            before a shift — applying reloads this terminal.
          </p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void handleApply()}
            disabled={applyingUpdate}
          >
            {applyingUpdate ? 'Applying…' : 'Apply update'}
          </button>
          {applyError !== null && (
            <p className="field__error" role="alert">
              {applyError} The version already on this device is unaffected.
            </p>
          )}
        </div>
      ) : (
        <p className="screen__note" data-testid="update-status">
          Application update: up to date.
        </p>
      )}
    </section>
  )
}
