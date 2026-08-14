import Dexie, { type Table } from 'dexie'
import type { FeedbackRecord, RegistrationRecord } from '../../types'

/*
 * On-device durable storage.
 *
 * IndexedDB via Dexie. IndexedDB because it is the only browser store that is
 * durable, transactional and large enough for ~10,000 registrations; Dexie
 * because raw IndexedDB's request/event API makes transaction boundaries easy
 * to get subtly wrong, and transaction correctness is exactly what the code
 * sequence depends on.
 *
 * Schema evolution: every change ships as a new `version(n).stores({...})`
 * block below, keeping the earlier blocks intact. Dexie replays them in order,
 * so an installed device upgrades in place. Existing data is never dropped and
 * migrations that need to rewrite rows attach an `.upgrade()` to their version.
 */

export const DB_NAME = 'offline-event-feedback'

/** Bump only alongside a new `version(n)` block. */
export const DB_VERSION = 1

/** Single-row-per-key store for values that belong to this browser install. */
export interface DeviceConfigRow {
  readonly key: string
  readonly value: string
  readonly updatedAt: string
}

/** Monotonic counters, one row per issuing scope. */
export interface SequenceRow {
  readonly key: string
  /** The most recently issued value; 0 means nothing issued yet. */
  readonly value: number
}

export class OfflineEventDb extends Dexie {
  declare registrations: Table<RegistrationRecord, string>
  declare feedback: Table<FeedbackRecord, string>
  declare deviceConfig: Table<DeviceConfigRow, string>
  declare sequences: Table<SequenceRow, string>

  constructor(name: string = DB_NAME) {
    super(name)

    /*
     * v1 indexes:
     *   registrations, `&participantId` and `&publicCode` are unique, so a
     *     duplicate identity is refused by the database itself rather than by
     *     application code that might not run. `syncStatus` and `createdAt`
     *     serve the future outbox.
     *   feedback, `publicCode` is indexed but NOT unique: a participant could
     *     legitimately be recorded twice, and Point B has no basis to decide
     *     otherwise offline. `participantId` is a sparse index; manual-entry
     *     records simply omit the field.
     */
    this.version(1).stores({
      registrations:
        'recordId, &participantId, &publicCode, syncStatus, createdAt',
      feedback: 'recordId, publicCode, participantId, syncStatus, createdAt',
      deviceConfig: 'key',
      sequences: 'key',
    })
  }
}

/** The application-wide database. Tests construct their own named instances. */
export const db = new OfflineEventDb()
