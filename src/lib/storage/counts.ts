import type { SyncStatus } from '../../types'
import type { OfflineEventDb } from './db'
import { partitionByEvent } from './eventScope'

/*
 * Operational counts for the Admin screen.
 *
 * Counts and nothing else. Admin never shows a participant's name, phone,
 * email or comment: an operator supporting a station needs to know how much
 * data is on the device and how much of it is unsynchronised, not who is in it.
 *
 * ## Scoped to one event, with the rest reported separately
 *
 * A browser can hold records from more than one event: a tablet that ran the
 * previous one and was re-used without being wiped. Two things must both be
 * true about how those are counted, and they pull in opposite directions:
 *
 *   - they must NOT be counted as this event's pending work. "3 pending" on a
 *     September device that has synced everything, where the 3 are August
 *     records nothing can deliver, sends an operator looking for a fault in
 *     September that is not there.
 *   - they must NOT be hidden. They are somebody's registrations and somebody's
 *     answers, and a device that still holds undelivered ones must not be wiped.
 *
 * So the headline figures are this event's, and the foreign records get their
 * own line that says what they are.
 */

export interface StoreCounts {
  readonly total: number
  readonly pending: number
  readonly synced: number
  readonly error: number
}

/**
 * Records on this browser belonging to some other event.
 *
 * Deliberately coarse. Admin does not need a per-status breakdown of data it
 * cannot act on; it needs to say that the records exist, how many cannot yet
 * have reached a server, and which events they came from so an operator knows
 * which build would collect them.
 */
export interface ForeignEventCounts {
  readonly registrations: number
  readonly feedback: number
  /**
   * Those still `pending` or in `error`, and therefore possibly not delivered.
   *
   * Both statuses together, because both mean the same thing to the person
   * deciding whether it is safe to clear this device: the server is not known
   * to hold them. A record already marked `error` is if anything the more
   * urgent of the two.
   */
  readonly undelivered: number
  /** The events they belong to, sorted, for an operator-facing message. */
  readonly eventIds: readonly string[]
}

export interface LocalCounts {
  /** This event's registrations. */
  readonly registrations: StoreCounts
  /** This event's feedback. */
  readonly feedback: StoreCounts
  /** Everything else on this browser. Never folded into the two above. */
  readonly otherEvents: ForeignEventCounts
}

function countByStatus(
  records: readonly { syncStatus: SyncStatus }[],
): StoreCounts {
  const of = (status: SyncStatus) =>
    records.filter((record) => record.syncStatus === status).length

  return {
    total: records.length,
    pending: of('pending'),
    synced: of('synced'),
    error: of('error'),
  }
}

/**
 * Reads every count in one transaction, so the figures agree with each other.
 *
 * `eventId` is required rather than defaulted. A default would make the
 * unscoped reading the easy one to write by accident, and the unscoped reading
 * is the bug: it is what lets another event's records be reported as this
 * event's outstanding work.
 *
 * The rows are read rather than counted by index. The partition needs each
 * record's `eventId`, which no index carries, so counting through Dexie would
 * mean one query per status per event anyway. At the scale this holds, an
 * event's worth of records on one tablet, reading them is simpler and is done
 * inside a single read transaction so nothing can move underneath it.
 */
export async function getLocalCounts(
  database: OfflineEventDb,
  eventId: string,
): Promise<LocalCounts> {
  return database.transaction(
    'r',
    database.registrations,
    database.feedback,
    async (): Promise<LocalCounts> => {
      const [allRegistrations, allFeedback] = await Promise.all([
        database.registrations.toArray(),
        database.feedback.toArray(),
      ])

      const registrations = partitionByEvent(allRegistrations, eventId)
      const feedback = partitionByEvent(allFeedback, eventId)

      const foreign = [...registrations.foreign, ...feedback.foreign]

      return {
        registrations: countByStatus(registrations.mine),
        feedback: countByStatus(feedback.mine),
        otherEvents: {
          registrations: registrations.foreign.length,
          feedback: feedback.foreign.length,
          undelivered: foreign.filter(
            (record) =>
              record.syncStatus === 'pending' || record.syncStatus === 'error',
          ).length,
          eventIds: [
            ...new Set(foreign.map((record) => record.eventId as string)),
          ].sort(),
        },
      }
    },
  )
}
