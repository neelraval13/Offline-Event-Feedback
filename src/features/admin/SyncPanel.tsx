import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { EVENT_CONFIG } from '../../config/event'
import { db, getLocalCounts, peekDeviceId, type LocalCounts } from '../../lib/storage'
import {
  enrollDevice,
  isSecureEndpoint,
  isSyncConfigured,
  readSyncActivity,
  readSyncCredential,
  runSync,
  storeSyncCredential,
  type SyncActivity,
  type SyncOutcome,
} from '../../lib/sync'

/*
 * Central synchronisation, from the operator's side.
 *
 * Everything here is diagnostic or deliberate. Point A and Point B show nothing
 * about sync at all: a failed upload is not a reason to interrupt somebody
 * registering a participant, and the records are safe locally either way.
 *
 * The device token is never displayed, and neither is the enrolment code; it
 * is cleared from component state the moment the attempt finishes.
 */

interface SyncPanelProps {
  readonly onDataChanged?: () => void
}

const FAILURE_MESSAGES: Record<string, string> = {
  unreachable:
    'Sync could not reach the central server. Your local records are safe and remain pending. Try again when connectivity is available.',
  timeout:
    'The central server did not respond in time. Your local records are safe and remain pending.',
  server_error:
    'The central server reported a problem. Your local records are safe and remain pending.',
  unauthorized:
    'This device is no longer authorised to sync. Enrol it again to continue.',
  rejected:
    'The central server refused the request. Your local records are safe and remain pending.',
  not_configured: 'This build has no central server configured.',
}

export function SyncPanel({ onDataChanged }: SyncPanelProps) {
  const [credentialPresent, setCredentialPresent] = useState<boolean | null>(null)
  const [activity, setActivity] = useState<SyncActivity | null>(null)
  const [counts, setCounts] = useState<LocalCounts | null>(null)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null)
  /* Guards the opportunistic attempt so it runs at most once per mount. */
  const openedRef = useRef(false)

  const refresh = useCallback(async () => {
    const [credential, syncActivity, localCounts] = await Promise.all([
      readSyncCredential(db),
      readSyncActivity(db),
      getLocalCounts(db),
    ])

    setCredentialPresent(credential !== null)
    setActivity(syncActivity)
    setCounts(localCounts)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const sync = useCallback(
    async (announce: boolean) => {
      setBusy(true)
      if (announce) {
        setMessage(null)
        setOutcome(null)
      }

      const result = await runSync({ database: db })
      setOutcome(result)

      if (result.transportFailure !== undefined) {
        // Never "sync failed": the records are safe, they simply have not
        // been delivered yet.
        setMessage(
          FAILURE_MESSAGES[result.transportFailure] ??
            FAILURE_MESSAGES['unreachable'] ??
            null,
        )
      } else if (announce) {
        setMessage(
          result.attempted === 0
            ? 'Everything on this device is already synced.'
            : `Synced ${result.synced} of ${result.attempted} record(s).`,
        )
      }

      await refresh()
      setBusy(false)
      onDataChanged?.()
    },
    [onDataChanged, refresh],
  )

  /*
   * Opportunistic attempts: once after the screen opens, and when the browser
   * says connectivity returned. `navigator.onLine` is only a hint: it reports
   * a link, not a reachable server, so a failure here is silent.
   */
  useEffect(() => {
    if (credentialPresent !== true || openedRef.current) {
      return
    }
    openedRef.current = true
    void sync(false)
  }, [credentialPresent, sync])

  useEffect(() => {
    if (credentialPresent !== true) {
      return
    }

    const onOnline = () => void sync(false)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [credentialPresent, sync])

  async function handleEnroll(event: FormEvent) {
    event.preventDefault()
    if (busy) {
      return
    }

    setBusy(true)
    setMessage(null)

    const deviceId = await peekDeviceId(db)
    if (deviceId === undefined) {
      setMessage('This device has no identity yet. Reload and try again.')
      setBusy(false)
      return
    }

    const response = await enrollDevice({
      eventId: EVENT_CONFIG.eventId,
      deviceId,
      enrollmentSecret: secret,
    })

    // Cleared regardless of outcome: the code is never persisted anywhere.
    setSecret('')

    if (!response.ok) {
      setMessage(
        response.failure === 'unauthorized'
          ? 'Device could not be enrolled. Check the enrollment code and try again.'
          : (FAILURE_MESSAGES[response.failure] ??
            'Device could not be enrolled.'),
      )
      setBusy(false)
      return
    }

    await storeSyncCredential({
      eventId: response.value.eventId,
      token: response.value.deviceToken,
    })

    setMessage('This device is enrolled for central sync.')
    await refresh()
    setBusy(false)
  }

  const formatDate = (value: string | null) =>
    value === null ? 'Never' : new Date(value).toLocaleString()

  if (!isSyncConfigured()) {
    return (
      <section aria-labelledby="sync-heading">
        <h2 id="sync-heading" className="pending__title">
          Central sync
        </h2>
        <p className="screen__note" data-testid="sync-status">
          Not configured in this build. Records stay on this device; keep an
          encrypted backup.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="sync-heading">
      <h2 id="sync-heading" className="pending__title">
        Central sync
      </h2>

      <dl className="station-badge">
        <div>
          <dt>Status</dt>
          <dd data-testid="sync-status">
            {credentialPresent === null
              ? 'Checking…'
              : credentialPresent
                ? 'Enrolled'
                : 'Not enrolled'}
          </dd>
        </div>
        <div>
          <dt>Sync errors</dt>
          <dd data-testid="sync-errors">
            {counts === null
              ? 'Counting…'
              : (counts.registrations.error + counts.feedback.error).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>Last sync attempt</dt>
          <dd data-testid="sync-last-attempt">
            {formatDate(activity?.lastAttemptAt ?? null)}
          </dd>
        </div>
        <div>
          <dt>Last successful sync</dt>
          <dd data-testid="sync-last-success">
            {formatDate(activity?.lastSuccessAt ?? null)}
          </dd>
        </div>
      </dl>

      {!isSecureEndpoint() && (
        <p className="notice notice--error" role="alert">
          The configured sync address is not secure. Registrations carry
          participant contact details and must only be sent over https.
        </p>
      )}

      {credentialPresent === false && (
        <form className="registration-form" onSubmit={(e) => void handleEnroll(e)}>
          <div className="field">
            <label className="field__label" htmlFor="enrollment-code">
              Enrollment code
            </label>
            <input
              id="enrollment-code"
              className="field__input"
              type="password"
              value={secret}
              autoComplete="off"
              onChange={(event) => setSecret(event.target.value)}
            />
          </div>
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? 'Enrolling…' : 'Enroll device'}
          </button>
        </form>
      )}

      {credentialPresent === true && (
        <div className="button-row">
          <button
            type="button"
            className="button button--primary"
            onClick={() => void sync(true)}
            disabled={busy}
          >
            {busy ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      )}

      {outcome !== null && outcome.failed > 0 && (
        <p className="screen__note" data-testid="sync-failed-count">
          {outcome.failed} record(s) could not be accepted by the central server
          and are marked with an error. Reconciliation is not available yet.
        </p>
      )}

      {message !== null && (
        <p
          className={
            message.startsWith('Sync could not') ||
            message.startsWith('Device could not') ||
            message.startsWith('This device is no longer')
              ? 'notice notice--error'
              : 'notice'
          }
          role="alert"
          data-testid="sync-message"
        >
          {message}
        </p>
      )}
    </section>
  )
}
