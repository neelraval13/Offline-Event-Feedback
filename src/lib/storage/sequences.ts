import {
  formatPublicCode,
  nextIssuableSequence,
} from '../identity/publicCode'
import type { EventDay, EventId, PublicParticipantCode, StationId } from '../../types'
import type { OfflineEventDb } from './db'

/*
 * The local registration sequence behind the printed public code.
 *
 * Transaction semantics matter here more than anywhere else in the codebase. A
 * read-modify-write on a counter is the textbook way to hand out duplicates, so
 * the increment never happens outside a readwrite transaction:
 *
 * - IndexedDB runs readwrite transactions with overlapping scopes strictly one
 *   at a time. Two allocations therefore cannot interleave their read and their
 *   write, whether they come from two rapid clicks in one tab or from two tabs
 *   open on the same device.
 * - Dexie's transaction callback must only await Dexie operations. Awaiting
 *   anything else lets the IndexedDB transaction auto-commit mid-flight and the
 *   guarantee evaporates. Everything inside these callbacks is either a Dexie
 *   call or synchronous arithmetic, deliberately.
 * - The caller's whole unit of work joins the same transaction (see
 *   `createRegistration`), so a failure after allocation rolls the counter back
 *   rather than burning a code.
 *
 * Sequence numbers are per issuing scope — event, day and station — so a second
 * day or a second desk later starts its own run rather than colliding with this
 * one. Gaps are expected and harmless: the counter is a ticket dispenser, not a
 * census, and ~1 in 37 values is skipped because it has no printable check
 * character.
 */

export interface SequenceScope {
  readonly eventId: EventId
  readonly eventDay: EventDay
  readonly stationId: StationId
}

/** The `sequences` row key for an issuing scope. */
export function sequenceKeyFor(scope: SequenceScope): string {
  return `publicCode:${scope.eventId}:${scope.eventDay}:${scope.stationId}`
}

/**
 * Reserves the next sequence number for a scope and returns it.
 *
 * Must be called inside a readwrite transaction covering `sequences`; callers
 * that are not already in one get their own via {@link allocatePublicCode}.
 */
async function reserveNextSequence(
  database: OfflineEventDb,
  scope: SequenceScope,
): Promise<number> {
  const key = sequenceKeyFor(scope)
  const row = await database.sequences.get(key)
  const lastIssued = row?.value ?? 0
  const next = nextIssuableSequence(scope.stationId, lastIssued + 1)

  await database.sequences.put({ key, value: next })
  return next
}

/** The most recently issued sequence number for a scope, or 0 if none. */
export async function readSequence(
  database: OfflineEventDb,
  scope: SequenceScope,
): Promise<number> {
  const row = await database.sequences.get(sequenceKeyFor(scope))
  return row?.value ?? 0
}

export interface AllocatedPublicCode {
  readonly publicCode: PublicParticipantCode
  readonly sequence: number
}

/**
 * Allocates the next public code for a scope.
 *
 * Joins the caller's transaction when there is one — Dexie nests a transaction
 * into its parent when the scope is a subset — so allocation and the write that
 * consumes it commit or roll back together.
 */
export async function allocatePublicCode(
  database: OfflineEventDb,
  scope: SequenceScope,
): Promise<AllocatedPublicCode> {
  return database.transaction('rw', database.sequences, async () => {
    const sequence = await reserveNextSequence(database, scope)
    return {
      sequence,
      publicCode: formatPublicCode(scope.stationId, sequence),
    }
  })
}
