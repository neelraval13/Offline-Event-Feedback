import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { ReportingResult } from '../../lib/reporting/reportingClient'

/*
 * The reporting session.
 *
 * Two jobs, both of which have to be in one place to be correct.
 *
 * **It hands out the credential.** Panels never receive the secret as a prop;
 * they ask the session to make a call and it supplies the secret. There is one
 * copy, in `ReportingScreen`'s state, and it is never written anywhere.
 *
 * **It ends the session on a 401.** A rejected credential is not a per-panel
 * error message. The secret has been rotated, revoked or mistyped, so it is no
 * longer a credential — every panel's data is now unauthorised, and leaving names
 * and phone numbers on screen behind a "secret rejected" notice would be a
 * privileged view of an event with nothing authorising it. The session is torn
 * down, the data unmounts with it, and the operator is asked to sign in again.
 *
 * Doing this per call site would mean eight places to get right and one to
 * forget. Every reporting request in the app goes through `call`.
 */

export interface ReportingSession {
  /**
   * Runs a reporting request with the session's credential.
   *
   * On `unauthorized` the session is destroyed before the result is returned, so
   * a caller that forgets to check has already had its data unmounted.
   */
  readonly call: <T>(
    request: (secret: string) => Promise<ReportingResult<T>>,
  ) => Promise<ReportingResult<T>>
}

const ReportingSessionContext = createContext<ReportingSession | null>(null)

interface ReportingSessionProviderProps {
  readonly secret: string
  /** Clears the secret and returns the screen to the sign-in form. */
  readonly onUnauthorized: () => void
  readonly children: ReactNode
}

export function ReportingSessionProvider({
  secret,
  onUnauthorized,
  children,
}: ReportingSessionProviderProps) {
  const session = useMemo<ReportingSession>(
    () => ({
      async call(request) {
        const result = await request(secret)

        if (!result.ok && result.failure === 'unauthorized') {
          onUnauthorized()
        }

        return result
      },
    }),
    [secret, onUnauthorized],
  )

  return (
    <ReportingSessionContext.Provider value={session}>
      {children}
    </ReportingSessionContext.Provider>
  )
}

export function useReportingSession(): ReportingSession {
  const session = useContext(ReportingSessionContext)

  if (session === null) {
    // A panel rendered outside the provider would have no credential to use and
    // no way to end a session it is not part of.
    throw new Error('Reporting panels must be rendered inside a reporting session')
  }

  return session
}
