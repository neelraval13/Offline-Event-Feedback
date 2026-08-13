import type { SyncStatus } from '../../types'
import type { OfflineEventDb } from './db'

/*
 * Operational counts for the Admin screen.
 *
 * Counts and nothing else. Admin never shows a participant's name, phone,
 * email or comment — an operator supporting a station needs to know how much
 * data is on the device and how much of it is unsynchronised, not who is in it.
 */

export interface StoreCounts {
  readonly total: number
  readonly pending: number
  readonly synced: number
  readonly error: number
}

export interface LocalCounts {
  readonly registrations: StoreCounts
  readonly feedback: StoreCounts
}

async function countByStatus(
  count: (status: SyncStatus) => Promise<number>,
  total: number,
): Promise<StoreCounts> {
  const [pending, synced, error] = await Promise.all([
    count('pending'),
    count('synced'),
    count('error'),
  ])

  return { total, pending, synced, error }
}

/** Reads every count in one transaction, so the figures agree with each other. */
export async function getLocalCounts(
  database: OfflineEventDb,
): Promise<LocalCounts> {
  return database.transaction(
    'r',
    database.registrations,
    database.feedback,
    async (): Promise<LocalCounts> => {
      const [registrationTotal, feedbackTotal] = await Promise.all([
        database.registrations.count(),
        database.feedback.count(),
      ])

      const [registrations, feedback] = await Promise.all([
        countByStatus(
          (status) =>
            database.registrations.where('syncStatus').equals(status).count(),
          registrationTotal,
        ),
        countByStatus(
          (status) =>
            database.feedback.where('syncStatus').equals(status).count(),
          feedbackTotal,
        ),
      ])

      return { registrations, feedback }
    },
  )
}
