/*
 * Which event a stored record belongs to.
 *
 * One rule, in one place, because the consequence of two copies disagreeing is
 * data that is silently unrecoverable.
 *
 * ## The failure this exists to prevent
 *
 * Every record carries the `eventId` it was captured under, and the central
 * server enforces that: a batch is authenticated against one event, and
 * `ingestRecord` refuses any record whose own event differs, answering
 * `wrongEvent`. The client then parks that record with a permanent error code.
 *
 * So a tablet that ran August, was enrolled for September without its pending
 * records being delivered first, and then synced would hand August's records to
 * a September batch, have every one of them refused, and mark them all in
 * error. Nothing is deleted, but the records are now sitting behind an error
 * state that the September build can never clear, and the operator has been
 * shown a failure that looks like a fault rather than like a rollover they
 * skipped.
 *
 * The operational answer is the rollover runbook. This is the answer that does
 * not depend on anybody reading it: records from another event are simply not
 * eligible for this event's sync, so they are never sent, never refused and
 * never marked. They stay exactly as they are until a build configured for
 * their event collects them.
 *
 * ## What this deliberately does not do
 *
 * It does not delete, rewrite, hide or reclassify a foreign record. Those rows
 * are somebody's registrations and somebody's answers, and the only safe thing
 * to do with them on a device configured for a different event is nothing.
 * Admin reports that they are there; see `getLocalCounts`.
 *
 * It is also not a replacement for the server's check. The server still refuses
 * a mixed batch, and must: this is a second line, on the side that knows which
 * event it is configured for before it sends anything.
 */

/** Any stored record. Narrowed to the one field this module reads. */
interface EventScoped {
  readonly eventId: string
}

/** Whether a record was captured under the given event. */
export function belongsToEvent(
  record: EventScoped,
  eventId: string,
): boolean {
  return record.eventId === eventId
}

export interface EventPartition<T> {
  /** Records captured under the event asked about. */
  readonly mine: T[]
  /**
   * Records captured under any other event.
   *
   * Returned rather than discarded, because every caller needs to say
   * something about them: the sync worker counts them so the operator learns
   * they were skipped, and Admin reports them so nobody wipes a device that
   * still holds undelivered data.
   */
  readonly foreign: T[]
}

/** Splits records into this event's and everything else's. */
export function partitionByEvent<T extends EventScoped>(
  records: readonly T[],
  eventId: string,
): EventPartition<T> {
  const mine: T[] = []
  const foreign: T[] = []

  for (const record of records) {
    if (belongsToEvent(record, eventId)) {
      mine.push(record)
    } else {
      foreign.push(record)
    }
  }

  return { mine, foreign }
}
