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
 *
 * ## Credentials are bound to one event, and this panel says so
 *
 * A device token is issued for a specific `eventId` and the server checks it:
 * `authenticate` in server/app.ts resolves the token against the event named in
 * the batch, and `ingestRecord` refuses any record whose own `eventId` differs
 * from the batch's, with `wrongEvent`.
 *
 * So a tablet that ran the August event and is opened on the September build is
 * holding a credential that cannot upload anything. Reporting that as
 * "Enrolled" was worse than useless: it is the one word that tells an operator
 * to stop worrying, and behind it the opportunistic sync below would fire on
 * every visit against an event the token does not cover. This panel therefore
 * compares the stored event with the configured one and reports the mismatch
 * explicitly, and the automatic attempts are gated on a credential for THIS
 * event rather than on a credential existing.
 *
 * Re-enrolling is offered rather than forced, and the old credential is never
 * discarded on this panel's own initiative. Pending records from the previous
 * event are the reason: they can only be uploaded by a build configured for
 * their event, and a client that quietly swapped the credential would leave
 * them to be marked `wrongEvent` and parked in error on the next sync. The
 * guard below states the count and requires the operator to acknowledge it.
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
  /*
   * Not a transport failure in the usual sense: nothing was sent. It travels on
   * the same channel because the operator-facing fact is identical, the run
   * stopped without the server saying anything, and the reason belongs in the
   * same sentence.
   */
  event_mismatch:
    'This device is enrolled for a different event, so nothing was sent. Enrol it for this event first.',
}

/**
 * What this browser's stored credential is good for.
 *
 * Three outcomes rather than a boolean, because "has a credential" and "can
 * sync this event" stopped being the same question the moment a second event
 * existed.
 */
type EnrolmentState =
  | { readonly status: 'checking' }
  | { readonly status: 'none' }
  /** Enrolled for the event this build is configured for. */
  | { readonly status: 'current' }
  /** Enrolled, but for a different event. Cannot upload anything here. */
  | { readonly status: 'other-event'; readonly eventId: string }

export function SyncPanel({ onDataChanged }: SyncPanelProps) {
  const [enrolment, setEnrolment] = useState<EnrolmentState>({
    status: 'checking',
  })
  const [acknowledgedStale, setAcknowledgedStale] = useState(false)
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
      getLocalCounts(db, EVENT_CONFIG.eventId),
    ])

    /*
     * The comparison, in the one place that reads the credential. Doing it here
     * rather than at each use means no caller can forget it.
     */
    setEnrolment(
      credential === null
        ? { status: 'none' }
        : credential.eventId === EVENT_CONFIG.eventId
          ? { status: 'current' }
          : { status: 'other-event', eventId: credential.eventId },
    )
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
  /*
   * Both automatic attempts are gated on `current`, not on "a credential
   * exists". With a stale credential every attempt is a guaranteed 401 against
   * an event the token does not cover, and the only visible result would be a
   * red banner on a screen where nothing is actually broken yet.
   */
  useEffect(() => {
    if (enrolment.status !== 'current' || openedRef.current) {
      return
    }
    openedRef.current = true
    void sync(false)
  }, [enrolment.status, sync])

  useEffect(() => {
    if (enrolment.status !== 'current') {
      return
    }

    const onOnline = () => void sync(false)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [enrolment.status, sync])

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
    setAcknowledgedStale(false)
    await refresh()
    setBusy(false)
  }

  const formatDate = (value: string | null) =>
    value === null ? 'Never' : new Date(value).toLocaleString()

  /*
   * Undelivered records belonging to ANOTHER event.
   *
   * This is the figure the re-enrolment guard is about, and it is deliberately
   * not "everything pending on the device". A September device holding
   * September records that have not synced yet is in a perfectly ordinary
   * state and enrolling changes nothing about them. A device holding August
   * records that have not reached a server is the dangerous case: this build
   * cannot deliver them at all, and the operator is about to be offered a
   * button that looks like it would help.
   *
   * `pending` and `error` together, not just `pending`: a record already parked
   * in error is equally undelivered and equally in need of the other build, and
   * counting only the optimistic half would understate what is at stake.
   */
  const foreignUndelivered = counts?.otherEvents.undelivered ?? 0
  const foreignEventIds = counts?.otherEvents.eventIds ?? []

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
            {enrolment.status === 'checking'
              ? 'Checking…'
              : enrolment.status === 'current'
                ? 'Enrolled'
                : enrolment.status === 'other-event'
                  ? 'Enrolled for a different event'
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

      {enrolment.status === 'other-event' && (
        <div
          className="notice notice--error"
          role="alert"
          data-testid="sync-event-mismatch"
        >
          <p>
            This device holds a sync credential for a different event. It cannot
            upload anything for {EVENT_CONFIG.eventId}, and the central server
            would refuse every record it sent.
          </p>
          {foreignUndelivered > 0 ? (
            /*
             * The dangerous case, stated in full.
             *
             * These records were captured for the previous event and carry its
             * event ID. A build configured for this event cannot upload them at
             * all: the server answers `wrongEvent` and the client parks each one
             * with a permanent error code. They are not lost, they are simply
             * unsendable from here, and the only ways out are the previous
             * build or an encrypted backup. The operator has to know that
             * before, not after.
             */
            <>
              <p data-testid="sync-stale-pending">
                <strong>
                  {foreignUndelivered} record(s) from{' '}
                  {foreignEventIds.join(', ')} have not reached the central
                  server
                </strong>{' '}
                and are still on this device. Enrolling for{' '}
                {EVENT_CONFIG.eventId} will not make them sendable: the server
                accepts a record only under the event it was captured for, and
                this build will never attempt them. Close the previous event
                first, or take an encrypted backup, before you continue.
              </p>
              <label className="field__checkbox">
                <input
                  type="checkbox"
                  checked={acknowledgedStale}
                  data-testid="sync-stale-acknowledge"
                  onChange={(event) =>
                    setAcknowledgedStale(event.target.checked)
                  }
                />{' '}
                I have dealt with those {foreignUndelivered} record(s) and
                understand they cannot be uploaded from this build.
              </label>
            </>
          ) : (
            <p data-testid="sync-stale-clean">
              No records from another event are waiting to be uploaded, so it is
              safe to enrol for this event.
            </p>
          )}
        </div>
      )}

      {(enrolment.status === 'none' ||
        (enrolment.status === 'other-event' &&
          (foreignUndelivered === 0 || acknowledgedStale))) && (
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

      {enrolment.status === 'current' && (
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
