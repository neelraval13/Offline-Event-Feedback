import { useCallback, useEffect, useState } from 'react'
import { db, getLocalCounts, type LocalCounts } from '../../lib/storage'
import {
  readSyncActivity,
  readSyncCredential,
  type SyncActivity,
} from '../../lib/sync'

/*
 * The three reads the console's overview needs, done once.
 *
 * V1 read `getLocalCounts` twice on every open, because `LocalDataPanel` and
 * `SyncPanel` each wanted it and neither knew about the other. The V2 console
 * also needs those counts a third time, for the operational overview at the
 * top, and a third independent read would be three answers to one question
 * that could disagree with each other for a frame.
 *
 * So the reads live here and the sections are given the answers. This is a
 * read-only consolidation: nothing about what is read, or when, or what it
 * means, has changed. Sync's own behaviour, the opportunistic attempt on open
 * and on `online`, stays in `SyncPanel`, because that is behaviour rather than
 * a read.
 */

export interface AdminFacts {
  readonly counts: LocalCounts | null
  /** Set when the counts could not be read at all. */
  readonly countsError: string | null
  /** `null` until the first read finishes, or if it failed. */
  readonly credentialPresent: boolean | null
  /** Set when the sync facts could not be read at all. */
  readonly credentialError: boolean
  readonly activity: SyncActivity | null
  /** Re-reads everything. Called after a sync, an enrolment or a restore. */
  readonly refresh: () => Promise<void>
}

export function useAdminFacts(refreshToken: number): AdminFacts {
  const [counts, setCounts] = useState<LocalCounts | null>(null)
  const [countsError, setCountsError] = useState<string | null>(null)
  const [credentialPresent, setCredentialPresent] = useState<boolean | null>(null)
  const [credentialError, setCredentialError] = useState(false)
  const [activity, setActivity] = useState<SyncActivity | null>(null)

  const refresh = useCallback(async () => {
    /*
     * The counts are read separately from the sync facts, because a store that
     * will not answer a count must not also blank the enrolment status: those
     * come from different tables and an operator needs both answers, not one
     * failure standing in for two.
     */
    try {
      setCounts(await getLocalCounts(db))
      setCountsError(null)
    } catch (error) {
      setCountsError(
        error instanceof Error ? error.message : 'Local data is unreadable.',
      )
    }

    try {
      const [credential, syncActivity] = await Promise.all([
        readSyncCredential(db),
        readSyncActivity(db),
      ])
      setCredentialPresent(credential !== null)
      setActivity(syncActivity)
      setCredentialError(false)
    } catch {
      /*
       * Recorded rather than swallowed. The store is diagnosed by the banner
       * above, but "we could not find out" and "we have not found out yet" are
       * different answers, and a console that shows the second one forever is
       * telling an operator to keep waiting for something that is not coming.
       */
      setCredentialError(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  return { counts, countsError, credentialPresent, credentialError, activity, refresh }
}
