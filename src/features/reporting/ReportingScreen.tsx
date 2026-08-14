import { useCallback, useState } from 'react'
import { EVENT_CONFIG } from '../../config/event'
import { ReportingLogin } from './ReportingLogin'
import { ReportingWorkspace } from './ReportingWorkspace'
import { ReportingSessionProvider } from './session'

/*
 * Central reporting.
 *
 * The one screen in this application that shows other people's data. Point A
 * sees the participant in front of it, Point B sees a code; this sees the whole
 * event's names, phone numbers and email addresses at once, which is why it
 * needs its own credential and why nothing it loads is written to this device.
 *
 * This component holds the credential and nothing else. Everything that reads
 * central data lives in `ReportingWorkspace`, inside the session provider, so
 * that clearing the secret unmounts the data in the same render, whether the
 * operator signed out or the server rejected the credential mid-session.
 *
 * The secret lives in the state below and nowhere else: not in IndexedDB, not
 * in localStorage, not in a cookie, not in a URL. Closing the tab ends the
 * session.
 *
 * This screen is not in the shell navigation. A device on a desk should not
 * have a route to every participant's phone number one mis-tap away.
 */

export function ReportingScreen() {
  const [secret, setSecret] = useState<string | null>(null)
  /** True when the session ended because the server rejected the credential. */
  const [rejected, setRejected] = useState(false)

  /*
   * A 401 from any reporting request. The credential is no longer a credential
   * (rotated, revoked or mistyped), so nothing on screen is authorised any more.
   * Clearing the secret unmounts the workspace, and the participants it was
   * displaying go with it.
   */
  const handleUnauthorized = useCallback(() => {
    setSecret(null)
    setRejected(true)
  }, [])

  if (secret === null) {
    return (
      <article className="screen">
        <h1>Central reporting</h1>
        {rejected && (
          <p className="notice notice--error" role="alert">
            The reporting secret was rejected, so this session has ended and the
            data has been cleared. If it was rotated on the server, sign in with
            the new one.
          </p>
        )}
        <ReportingLogin
          eventId={EVENT_CONFIG.eventId}
          onAuthenticated={(value) => {
            setRejected(false)
            setSecret(value)
          }}
        />
      </article>
    )
  }

  return (
    <ReportingSessionProvider secret={secret} onUnauthorized={handleUnauthorized}>
      <ReportingWorkspace
        eventId={EVENT_CONFIG.eventId}
        eventName={EVENT_CONFIG.eventName}
        onSignOut={() => {
          setRejected(false)
          setSecret(null)
        }}
      />
    </ReportingSessionProvider>
  )
}
