import {
  MAX_BATCH_RECORDS,
  SYNC_PROTOCOL_VERSION,
  type SyncBatch,
  type SyncRecord,
  type SyncRecordResult,
} from '../../../shared/sync/protocol'
import { EVENT_CONFIG } from '../../config/event'
import { newRecordId } from '../identity/uuid'
import {
  db,
  listFeedbackBySyncStatus,
  listRegistrationsBySyncStatus,
  markFeedbackSyncError,
  markFeedbackSynced,
  markRegistrationSyncError,
  markRegistrationSynced,
  peekDeviceId,
  type OfflineEventDb,
} from '../storage'
import { partitionByEvent } from '../storage/eventScope'
import { postBatch, type SyncTransportResult } from './syncClient'
import type { SyncBatchResponse } from '../../../shared/sync/protocol'
import { readSyncCredential, recordSyncActivity } from './syncCredentials'
import { toFeedbackWire, toRegistrationWire } from './wire'
import type { RecordId } from '../../types'

/*
 * The outbox.
 *
 *   pending records -> wire DTOs -> batches of 100 -> POST -> per-record result
 *
 * Records stay `pending` while a request is in flight. There is deliberately no
 * persisted `syncing` state: a browser closed mid-request would strand every
 * record in it forever, and since ingest is idempotent there is nothing to gain
 * from marking them. A record leaves `pending` only when the server has
 * actually said something about it.
 */

export interface SyncOutcome {
  readonly attempted: number
  readonly synced: number
  readonly failed: number
  readonly batches: number
  /** Set when the run stopped without a server answer. Records stay pending. */
  readonly transportFailure?: string
  readonly enrolled: boolean
  /**
   * Records on this device belonging to a different event.
   *
   * Never attempted, never marked, never counted as this event's work. Reported
   * so the operator learns they exist rather than discovering it by wiping the
   * device. Zero on any device that has only ever run one event.
   */
  readonly foreignEventRecords: number
}

/** An outcome that attempted nothing. Spelled once so no field is forgotten. */
function nothingAttempted(
  extra: Partial<SyncOutcome> & { enrolled: boolean },
): SyncOutcome {
  return {
    attempted: 0,
    synced: 0,
    failed: 0,
    batches: 0,
    foreignEventRecords: 0,
    ...extra,
  }
}

/** Groups records into batches the server will accept. */
export function chunkRecords<T>(
  records: readonly T[],
  size: number = MAX_BATCH_RECORDS,
): T[][] {
  const batches: T[][] = []

  for (let index = 0; index < records.length; index += size) {
    batches.push(records.slice(index, index + size))
  }

  return batches
}

interface Eligible {
  readonly kind: 'registration' | 'feedback'
  readonly recordId: RecordId
  readonly wire: SyncRecord
}

export interface EligibleRecords {
  /** Pending records for the event being synced, oldest first. */
  readonly eligible: Eligible[]
  /**
   * How many pending records belong to some other event.
   *
   * Counted, not collected: nothing downstream may act on them, and a count is
   * all the operator needs to be told they are there.
   */
  readonly foreignEventRecords: number
}

/**
 * Everything waiting to be delivered **for one event**, oldest first.
 *
 * The event is a required argument rather than a default, and that is the point
 * of the signature. A caller that forgot it would collect every pending record
 * on the device, which is exactly the bug this guards: August's records handed
 * to a September batch, refused per record with `wrongEvent`, and parked in an
 * error state a September build can never clear.
 *
 * Foreign records are filtered out here, at the single funnel every sync run
 * passes through, rather than at each of the two store queries. One filter is
 * one thing to keep correct, and the partition also yields the count Admin and
 * the outcome both report.
 */
export async function collectEligible(
  database: OfflineEventDb,
  eventId: string,
): Promise<EligibleRecords> {
  const [allRegistrations, allFeedback] = await Promise.all([
    listRegistrationsBySyncStatus(database, 'pending'),
    listFeedbackBySyncStatus(database, 'pending'),
  ])

  const registrations = partitionByEvent(allRegistrations, eventId)
  const feedback = partitionByEvent(allFeedback, eventId)

  const byCreation = (left: { createdAt: string }, right: { createdAt: string }) =>
    left.createdAt.localeCompare(right.createdAt)

  return {
    eligible: [
      ...[...registrations.mine].sort(byCreation).map(
        (record): Eligible => ({
          kind: 'registration',
          recordId: record.recordId,
          wire: toRegistrationWire(record),
        }),
      ),
      ...[...feedback.mine].sort(byCreation).map(
        (record): Eligible => ({
          kind: 'feedback',
          recordId: record.recordId,
          wire: toFeedbackWire(record),
        }),
      ),
    ],
    foreignEventRecords: registrations.foreign.length + feedback.foreign.length,
  }
}

/** Statuses that mean the server holds this record and the device can stop. */
const SETTLED: ReadonlySet<SyncRecordResult['status']> = new Set([
  'accepted',
  'already_current',
])

async function applyResults(
  database: OfflineEventDb,
  batch: readonly Eligible[],
  results: readonly SyncRecordResult[],
): Promise<{ synced: number; failed: number }> {
  const byRecordId = new Map(results.map((result) => [result.recordId, result]))
  let synced = 0
  let failed = 0

  for (const entry of batch) {
    const result = byRecordId.get(entry.recordId)

    if (result === undefined) {
      // No answer for this record: leave it pending and try again later.
      continue
    }

    if (SETTLED.has(result.status)) {
      /*
       * `already_current` is as good as `accepted`. It is what a retry of a
       * request whose response was lost looks like, and treating it as success
       * is what stops that record cycling forever.
       */
      if (entry.kind === 'registration') {
        await markRegistrationSynced(database, entry.recordId)
      } else {
        await markFeedbackSynced(database, entry.recordId)
      }
      synced += 1
      continue
    }

    /*
     * A hard outcome. Resending would produce the same answer, so the record is
     * parked with a non-PII code for an operator to look at rather than retried
     * on every sync.
     */
    const code = result.code ?? result.status.toUpperCase()
    if (entry.kind === 'registration') {
      await markRegistrationSyncError(database, entry.recordId, code)
    } else {
      await markFeedbackSyncError(database, entry.recordId, code)
    }
    failed += 1
  }

  return { synced, failed }
}

export interface RunSyncOptions {
  readonly database?: OfflineEventDb
  /** Injected in tests. */
  readonly send?: (
    batch: SyncBatch,
    token: string,
  ) => Promise<SyncTransportResult<SyncBatchResponse>>
}

/**
 * Uploads everything pending, in batches, until nothing eligible remains.
 *
 * Returns rather than throws: a failed sync is an ordinary operational state,
 * not an exception. Point A and Point B are unaffected either way.
 */
export async function runSync(options: RunSyncOptions = {}): Promise<SyncOutcome> {
  const database = options.database ?? db
  const send = options.send ?? postBatch

  const credential = await readSyncCredential(database)
  if (credential === null) {
    return nothingAttempted({ enrolled: false })
  }

  /*
   * The credential names the event this run may touch, and it must agree with
   * the build's own event before anything is collected or sent.
   *
   * A credential for another event cannot upload anything: the server
   * authenticates the token against the event in the batch. Attempting it would
   * produce a guaranteed rejection, and the only thing the operator would see
   * is a failure on a screen where nothing is actually broken yet. The Admin
   * panel already withholds the button in this state; this is the same refusal
   * one layer down, where it also covers any other caller.
   *
   * Nothing is marked and no activity error is recorded: the device has not
   * failed to sync, it is not enrolled for this event.
   */
  if (credential.eventId !== EVENT_CONFIG.eventId) {
    return nothingAttempted({
      enrolled: false,
      transportFailure: 'event_mismatch',
    })
  }

  const uploaderDeviceId = await peekDeviceId(database)
  if (uploaderDeviceId === undefined) {
    return nothingAttempted({ enrolled: false })
  }

  const attemptAt = new Date().toISOString()
  await recordSyncActivity({ attemptAt }, database)

  /*
   * Scoped to the credential's event, which the check above has established is
   * this build's event. Records from any other event are counted and left
   * alone: not sent, not marked, not touched.
   */
  const { eligible, foreignEventRecords } = await collectEligible(
    database,
    credential.eventId,
  )

  if (eligible.length === 0) {
    await recordSyncActivity(
      { successAt: new Date().toISOString(), error: null },
      database,
    )
    return nothingAttempted({ enrolled: true, foreignEventRecords })
  }

  let synced = 0
  let failed = 0
  let batches = 0

  for (const group of chunkRecords(eligible)) {
    const batch: SyncBatch = {
      protocolVersion: SYNC_PROTOCOL_VERSION,
      batchId: newRecordId(),
      eventId: EVENT_CONFIG.eventId,
      uploaderDeviceId,
      records: group.map((entry) => entry.wire),
    }

    const response = await send(batch, credential.token)
    batches += 1

    if (!response.ok) {
      /*
       * No server answer. Every record in this batch, and every batch after
       * it, stays pending. Nothing is marked in error, because nothing is
       * known to be wrong with the records themselves.
       */
      await recordSyncActivity({ error: response.failure }, database)
      return {
        attempted: eligible.length,
        synced,
        failed,
        batches,
        transportFailure: response.failure,
        enrolled: true,
        foreignEventRecords,
      }
    }

    const applied = await applyResults(database, group, response.value.results)
    synced += applied.synced
    failed += applied.failed
  }

  await recordSyncActivity(
    { successAt: new Date().toISOString(), error: null },
    database,
  )

  return {
    attempted: eligible.length,
    synced,
    failed,
    batches,
    enrolled: true,
    foreignEventRecords,
  }
}
