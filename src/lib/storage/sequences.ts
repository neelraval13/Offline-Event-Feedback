import {
  formatPublicCode,
  nextIssuableSequence,
  type CodeIssuer,
} from '../identity/publicCode'
import type {
  EventDay,
  EventId,
  IssuerCode,
  PublicParticipantCode,
  StationId,
} from '../../types'
import type { OfflineEventDb } from './db'

/*
 * The local registration sequence behind the printed public code.
 *
 * The counter is device-local and always was. IndexedDB has no other kind.
 * What changed in Phase 1.1 is that the code it feeds is namespaced by the
 * issuing device, so two installations at the same station counting 1, 2, 3
 * in parallel produce disjoint codes instead of identical ones. The scope key
 * carries the issuer for the same reason: one counter per device, not one per
 * station shared by devices that cannot see each other.
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
 * Gaps are expected and harmless: the counter is a ticket dispenser, not a
 * census, and ~1 in 37 values is skipped because it has no printable check
 * character.
 */

export interface SequenceScope {
  readonly eventId: EventId
  readonly eventDay: EventDay
  readonly stationId: StationId
  readonly issuerCode: IssuerCode
}

/** The `sequences` row key for an issuing scope. */
export function sequenceKeyFor(scope: SequenceScope): string {
  return `publicCode:${scope.eventId}:${scope.eventDay}:${scope.stationId}:${scope.issuerCode}`
}

function issuerFor(scope: SequenceScope): CodeIssuer {
  return { stationId: scope.stationId, issuerCode: scope.issuerCode }
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
  const next = nextIssuableSequence(issuerFor(scope), lastIssued + 1)

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
 * How many taken codes an allocation will step over before giving up.
 *
 * Only ever consumed on a device that already holds registrations whose codes
 * this scope would re-issue, which in practice means one previous event's worth.
 * The bound exists so a corrupted sequence row produces a legible error at the
 * desk rather than a loop that never returns.
 */
const MAX_SKIPPED_CODES = 50_000

/**
 * Allocates the next public code for a scope, skipping any already in use.
 *
 * Joins the caller's transaction when there is one: Dexie nests a transaction
 * into its parent when the scope is a subset, so allocation and the write that
 * consumes it commit or roll back together.
 *
 * **A surrounding transaction must therefore cover `registrations` as well as
 * `sequences`**, because the check below reads it. `createRegistration`, the
 * only production caller, has always opened exactly those two.
 *
 * ## Why it has to check, and not merely count
 *
 * The sequence is keyed by event, so a new event restarts at 1. The public code
 * is NOT: it is station, issuer, sequence and a check character, and the issuer
 * is derived from the device. A device that still holds a previous event's
 * registrations therefore regenerates that event's first code for this event's
 * first rider, and `registrations.publicCode` is a unique index.
 *
 * What that produced was not a near miss. The insert failed with a
 * `ConstraintError`, and because the sequence bump and the insert share one
 * transaction, the bump rolled back with it: the counter never advanced, so
 * every subsequent rider failed in exactly the same way. A tablet rolled over
 * without being wiped could not register anybody at all, and the operator saw
 * only "Could not save this registration".
 *
 * Stepping over a taken code fixes that without touching the parts that are
 * contracts: the code's structure is unchanged, the check character is still
 * computed the same way, and the sequence stays event-scoped. All that changes
 * is that an allocation will not hand back a code this database has already
 * issued. Skipping numbers is already normal here; `nextIssuableSequence` skips
 * every sequence whose check character cannot be formed.
 *
 * The scan is bounded by what is on the device and happens once per rollover:
 * after the first September rider takes 201 on a device holding 200 August
 * records, the counter holds 201 and the next allocation skips nothing.
 */
export async function allocatePublicCode(
  database: OfflineEventDb,
  scope: SequenceScope,
): Promise<AllocatedPublicCode> {
  return database.transaction(
    'rw',
    database.sequences,
    database.registrations,
    async () => {
      let skipped = 0

      for (;;) {
        const sequence = await reserveNextSequence(database, scope)
        const publicCode = formatPublicCode(issuerFor(scope), sequence)

        const taken = await database.registrations
          .where('publicCode')
          .equals(publicCode)
          .count()

        if (taken === 0) {
          return { sequence, publicCode }
        }

        skipped += 1
        if (skipped > MAX_SKIPPED_CODES) {
          throw new Error(
            `Could not allocate a public code: ${MAX_SKIPPED_CODES} consecutive codes for ` +
              `${scope.stationId}-${scope.issuerCode} are already in use on this device.`,
          )
        }
      }
    },
  )
}
