import type { OfflineEventDb } from '../storage'
import type { FeedbackRecord, RegistrationRecord } from '../../types'
import type { BackupPayloadV1 } from './format'

/*
 * Restoring a backup.
 *
 * Restore is a **merge**, never a replace. The destination database is not
 * cleared, because the most likely restore is onto a device that has already
 * started working, and wiping it to make room for older data would destroy
 * exactly the records nobody has a copy of.
 *
 * The whole merge runs inside one readwrite transaction. Any conflict throws,
 * the transaction aborts, and nothing at all is committed. A half-restored
 * database is worse than a failed restore: it cannot be reasoned about and it
 * cannot be safely retried.
 */

export interface RestoreCounts {
  readonly registrationsAdded: number
  readonly registrationsUpdated: number
  readonly registrationsUnchanged: number
  readonly feedbackAdded: number
  readonly feedbackUpdated: number
  readonly feedbackUnchanged: number
  readonly sequencesMerged: number
}

export type RestoreResult =
  | { readonly ok: true; readonly counts: RestoreCounts }
  | { readonly ok: false; readonly conflicts: readonly string[] }

/** Thrown to abort the transaction. Messages are structural, never PII. */
class RestoreConflict extends Error {
  readonly conflicts: readonly string[]

  constructor(conflicts: readonly string[]) {
    super('restore-conflict')
    this.name = 'RestoreConflict'
    this.conflicts = conflicts
  }
}

/**
 * Fields that identify a record and where it came from.
 *
 * None of these may ever differ between two copies of the same `recordId`. A
 * participant ID or public code is printed on a sticker somebody is wearing;
 * provenance records what actually happened. If two copies disagree on any of
 * them, they are not the same record, and no merge rule can make them one.
 */
const REGISTRATION_IMMUTABLE = [
  'kind',
  'recordId',
  'participantId',
  'publicCode',
  'eventId',
  'eventDay',
  'stationId',
  'deviceId',
  'createdAt',
] as const

const FEEDBACK_IMMUTABLE = [
  'kind',
  'recordId',
  'publicCode',
  'participantId',
  'captureMethod',
  'eventId',
  'eventDay',
  'stationId',
  'deviceId',
  'createdAt',
] as const

/*
 * Transport state, excluded from every merge comparison.
 *
 * `syncStatus` and its companions describe whether a record reached the central
 * server *from this device*; they are not part of the record's contents. Two
 * copies of one registration will routinely disagree here: the source device
 * synced it, the replacement has not. Comparing them would report a conflict
 * for records that are in every meaningful sense identical, and abort a restore
 * that should have succeeded.
 *
 * Discovered when synchronisation began changing these fields in earnest.
 */
const TRANSPORT_FIELDS: readonly string[] = [
  'syncStatus',
  'lastSyncedAt',
  'syncErrorCode',
]

/** A record without its transport bookkeeping. */
function domainFieldsOf(record: object): Record<string, unknown> {
  const fields: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    if (!TRANSPORT_FIELDS.includes(key)) {
      fields[key] = value
    }
  }

  return fields
}

/** Key-order-independent structural comparison. */
function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true
  }
  if (typeof left !== typeof right || left === null || right === null) {
    return false
  }
  if (typeof left !== 'object') {
    return false
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false
    }
    return (
      left.length === right.length &&
      left.every((item, index) => deepEqual(item, right[index]))
    )
  }

  const leftKeys = Object.keys(left as Record<string, unknown>).sort()
  const rightKeys = Object.keys(right as Record<string, unknown>).sort()

  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index]) &&
    leftKeys.every((key) =>
      deepEqual(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ),
    )
  )
}

/**
 * Views a domain record as a field bag.
 *
 * The merge rules are field-name driven and shared by both record kinds, so
 * they read properties generically. The records themselves stay strongly typed
 * everywhere else.
 */
function fieldsOf(record: object): Record<string, unknown> {
  return record as Record<string, unknown>
}

function immutableFieldsMatch(
  local: Record<string, unknown>,
  incoming: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every((field) => deepEqual(local[field], incoming[field]))
}

type MergeOutcome = 'added' | 'updated' | 'unchanged'

/**
 * Decides what to do with one incoming record.
 *
 * The rule that matters most is the last one: equal revisions with different
 * contents is a genuine conflict, and guessing which side is authoritative
 * would silently discard somebody's data.
 */
function mergeDecision(
  local: object | undefined,
  incoming: object,
  immutable: readonly string[],
  label: string,
  index: number,
  conflicts: string[],
): MergeOutcome {
  if (local === undefined) {
    return 'added'
  }

  const localFields = fieldsOf(local)
  const incomingFields = fieldsOf(incoming)

  if (!immutableFieldsMatch(localFields, incomingFields, immutable)) {
    conflicts.push(
      `${label}[${index}]: the same record ID exists locally with different identity or provenance`,
    )
    return 'unchanged'
  }

  // Compared on domain contents only: a difference in delivery state is not a
  // difference in the record.
  if (deepEqual(domainFieldsOf(local), domainFieldsOf(incoming))) {
    return 'unchanged'
  }

  const localRevision = Number(localFields['revision'])
  const incomingRevision = Number(incomingFields['revision'])

  if (incomingRevision > localRevision) {
    return 'updated'
  }
  if (incomingRevision < localRevision) {
    // The local copy is newer; keep it and count the record as seen.
    return 'unchanged'
  }

  conflicts.push(
    `${label}[${index}]: the same record ID and revision exist locally with different contents`,
  )
  return 'unchanged'
}

/**
 * Merges a validated backup into the local database.
 *
 * The payload must already have been through `validatePayload`; this function
 * assumes shape and re-checks only what depends on local state.
 */
export async function restoreBackup(
  database: OfflineEventDb,
  payload: BackupPayloadV1,
): Promise<RestoreResult> {
  try {
    const counts = await database.transaction(
      'rw',
      database.registrations,
      database.feedback,
      database.sequences,
      async (): Promise<RestoreCounts> => {
        const conflicts: string[] = []

        const [localRegistrations, localFeedback, localSequences] =
          await Promise.all([
            database.registrations.toArray(),
            database.feedback.toArray(),
            database.sequences.toArray(),
          ])

        const registrationsById = new Map(
          localRegistrations.map((record) => [record.recordId, record]),
        )
        const feedbackById = new Map(
          localFeedback.map((record) => [record.recordId, record]),
        )
        const sequencesByKey = new Map(
          localSequences.map((row) => [row.key, row]),
        )

        /*
         * The unique indexes on `participantId` and `publicCode` would abort
         * the transaction anyway, but a raw ConstraintError tells an operator
         * nothing. These maps let the conflict be named.
         */
        const localByParticipant = new Map(
          localRegistrations.map((record) => [record.participantId, record.recordId]),
        )
        const localByPublicCode = new Map(
          localRegistrations.map((record) => [record.publicCode, record.recordId]),
        )

        const registrationsToWrite: RegistrationRecord[] = []
        let registrationsAdded = 0
        let registrationsUpdated = 0
        let registrationsUnchanged = 0

        payload.registrations.forEach((incoming, index) => {
          const claimedByParticipant = localByParticipant.get(incoming.participantId)
          if (
            claimedByParticipant !== undefined &&
            claimedByParticipant !== incoming.recordId
          ) {
            conflicts.push(
              `registrations[${index}]: this participant already exists locally under a different record`,
            )
            return
          }

          const claimedByCode = localByPublicCode.get(incoming.publicCode)
          if (claimedByCode !== undefined && claimedByCode !== incoming.recordId) {
            conflicts.push(
              `registrations[${index}]: this public code already exists locally under a different record`,
            )
            return
          }

          const outcome = mergeDecision(
            registrationsById.get(incoming.recordId),
            incoming,
            REGISTRATION_IMMUTABLE,
            'registrations',
            index,
            conflicts,
          )

          if (outcome === 'added') {
            registrationsToWrite.push(incoming)
            registrationsAdded += 1
          } else if (outcome === 'updated') {
            registrationsToWrite.push(incoming)
            registrationsUpdated += 1
          } else {
            registrationsUnchanged += 1
          }
        })

        const feedbackToWrite: FeedbackRecord[] = []
        let feedbackAdded = 0
        let feedbackUpdated = 0
        let feedbackUnchanged = 0

        payload.feedback.forEach((incoming, index) => {
          const outcome = mergeDecision(
            feedbackById.get(incoming.recordId),
            incoming,
            FEEDBACK_IMMUTABLE,
            'feedback',
            index,
            conflicts,
          )

          if (outcome === 'added') {
            feedbackToWrite.push(incoming)
            feedbackAdded += 1
          } else if (outcome === 'updated') {
            feedbackToWrite.push(incoming)
            feedbackUpdated += 1
          } else {
            feedbackUnchanged += 1
          }
        })

        /*
         * Sequences take the maximum, never the backup's value.
         *
         * Lowering a counter would reissue public codes that are already
         * printed and on participants: the collision Phase 1.1 exists to
         * prevent, reintroduced by a restore.
         */
        let sequencesMerged = 0
        const sequencesToWrite = payload.sequences.flatMap((incoming) => {
          const local = sequencesByKey.get(incoming.key)
          const merged = Math.max(local?.value ?? 0, incoming.value)

          if (local !== undefined && local.value === merged) {
            return []
          }
          sequencesMerged += 1
          return [{ key: incoming.key, value: merged }]
        })

        if (conflicts.length > 0) {
          // Aborts the transaction: nothing above is committed.
          throw new RestoreConflict(conflicts)
        }

        await database.registrations.bulkPut(registrationsToWrite)
        await database.feedback.bulkPut(feedbackToWrite)
        await database.sequences.bulkPut(sequencesToWrite)

        /*
         * `deviceConfig` is deliberately not imported, not one key.
         *
         * The destination keeps its own `deviceId`. Cloning the source's would
         * give two independent offline machines the same public-code issuer
         * namespace, which is precisely the collision the per-device issuer was
         * introduced to eliminate. Backup metadata (last backup, last verify)
         * describes *this* installation and would be a lie if imported.
         *
         * Restored records keep their original `deviceId`, so their provenance
         * and their printed stickers remain exactly as captured.
         */

        return {
          registrationsAdded,
          registrationsUpdated,
          registrationsUnchanged,
          feedbackAdded,
          feedbackUpdated,
          feedbackUnchanged,
          sequencesMerged,
        }
      },
    )

    return { ok: true, counts }
  } catch (error) {
    if (error instanceof RestoreConflict) {
      return { ok: false, conflicts: error.conflicts }
    }

    return {
      ok: false,
      conflicts: [
        error instanceof Error
          ? `The restore was stopped and nothing was imported: ${error.message}`
          : 'The restore was stopped and nothing was imported.',
      ],
    }
  }
}
