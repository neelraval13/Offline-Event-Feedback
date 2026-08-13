import {
  SYNC_CODES,
  type FeedbackWireRecord,
  type RegistrationWireRecord,
  type SyncRecord,
  type SyncRecordResult,
} from '../../shared/sync/protocol'
import type { CentralFeedback, CentralRegistration, SyncStore } from './store'

/*
 * Ingest semantics.
 *
 * Delivery is at-least-once, so the same record legitimately arrives once, or
 * ten times, or twice at the same instant from two devices. The central row for
 * a `recordId` must be the same either way, which is what makes a lost response
 * harmless: the client retries, the server says `already_current`, and nothing
 * is duplicated.
 *
 * `recordId` and `revision` come from the device that captured the record.
 * Nothing here mints a new identity — a server-side ID would break the link to
 * the sticker a participant is physically wearing.
 */

/**
 * Fields that must never change for a given `recordId`.
 *
 * A higher revision may correct a name or a phone number. It may not change who
 * the record is about or where it came from — those are printed on a sticker
 * and recorded as fact. Two copies disagreeing on any of them are not the same
 * record, and no revision rule can make them one.
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
  'captureMethod',
  'participantId',
  'eventId',
  'eventDay',
  'stationId',
  'deviceId',
  'createdAt',
] as const

/** Mutable domain contents, compared when revisions are equal. */
const REGISTRATION_MUTABLE = ['name', 'phone', 'email', 'updatedAt'] as const
const FEEDBACK_MUTABLE = ['formVersion', 'answers', 'updatedAt'] as const

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true
  }
  if (
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    left === null ||
    right === null
  ) {
    return false
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
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

function fieldsMatch(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every((field) => deepEqual(stored[field], incoming[field]))
}

function result(
  recordId: string,
  status: SyncRecordResult['status'],
  extra: { serverRevision?: number; code?: string } = {},
): SyncRecordResult {
  return {
    recordId,
    status,
    ...(extra.serverRevision === undefined
      ? {}
      : { serverRevision: extra.serverRevision }),
    ...(extra.code === undefined ? {} : { code: extra.code }),
  }
}

export interface IngestContext {
  readonly store: SyncStore
  readonly eventId: string
  readonly uploaderDeviceId: string
  readonly receivedAt: string
}

/**
 * Decides the outcome for a record the server already holds.
 *
 * Shared by both record kinds because the rule is the same one: identity is
 * fixed, the higher revision wins, and equal revisions with different contents
 * are a conflict rather than a race to overwrite.
 */
function decideAgainstStored(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
  immutable: readonly string[],
  mutable: readonly string[],
): 'update' | 'already_current' | 'server_newer' | 'immutable' | 'conflict' {
  if (!fieldsMatch(stored, incoming, immutable)) {
    return 'immutable'
  }

  const storedRevision = Number(stored['revision'])
  const incomingRevision = Number(incoming['revision'])

  if (incomingRevision > storedRevision) {
    return 'update'
  }
  if (incomingRevision < storedRevision) {
    return 'server_newer'
  }

  /*
   * Equal revisions. Identical contents means this is a retry — very often the
   * retry of a request whose response was lost — and must be acknowledged so
   * the device can stop resending it.
   */
  return fieldsMatch(stored, incoming, mutable) ? 'already_current' : 'conflict'
}

async function ingestRegistration(
  context: IngestContext,
  record: RegistrationWireRecord,
): Promise<SyncRecordResult> {
  const stored = await context.store.getRegistration(record.recordId)

  if (stored === null) {
    const inserted = await context.store.insertRegistration(
      record,
      context.receivedAt,
      context.uploaderDeviceId,
    )

    if (inserted.outcome === 'inserted') {
      return result(record.recordId, 'accepted', { serverRevision: record.revision })
    }

    if (inserted.outcome === 'claimed') {
      /*
       * A different record already owns this participant or public code. Two
       * devices independently registering one person, most likely. Never
       * overwrite either: both are somebody's real capture.
       */
      return result(record.recordId, 'conflict', {
        code:
          inserted.by === 'participant_id'
            ? SYNC_CODES.participantClaimed
            : SYNC_CODES.publicCodeClaimed,
      })
    }

    // Lost the insert race to a concurrent request; fall through and compare.
    const now = await context.store.getRegistration(record.recordId)
    if (now === null) {
      return result(record.recordId, 'conflict', {
        code: SYNC_CODES.revisionConflict,
      })
    }
    return compareRegistration(context, record, now)
  }

  return compareRegistration(context, record, stored)
}

async function compareRegistration(
  context: IngestContext,
  record: RegistrationWireRecord,
  stored: CentralRegistration,
): Promise<SyncRecordResult> {
  const decision = decideAgainstStored(
    stored as unknown as Record<string, unknown>,
    record as unknown as Record<string, unknown>,
    REGISTRATION_IMMUTABLE,
    REGISTRATION_MUTABLE,
  )

  switch (decision) {
    case 'immutable':
      return result(record.recordId, 'conflict', {
        code: SYNC_CODES.immutableMismatch,
        serverRevision: stored.revision,
      })

    case 'server_newer':
      return result(record.recordId, 'server_newer', {
        serverRevision: stored.revision,
      })

    case 'conflict':
      return result(record.recordId, 'conflict', {
        code: SYNC_CODES.revisionConflict,
        serverRevision: stored.revision,
      })

    case 'already_current':
      await context.store.touchRegistration(
        record.recordId,
        context.receivedAt,
        context.uploaderDeviceId,
      )
      return result(record.recordId, 'already_current', {
        serverRevision: stored.revision,
      })

    case 'update': {
      /*
       * Conditional on the revision that was read. If a concurrent request
       * moved it first, this update does nothing and the record is re-examined
       * — the outcome stays deterministic either way.
       */
      const updated = await context.store.updateRegistration(
        record,
        stored.revision,
        context.receivedAt,
        context.uploaderDeviceId,
      )

      if (updated) {
        return result(record.recordId, 'accepted', {
          serverRevision: record.revision,
        })
      }

      const latest = await context.store.getRegistration(record.recordId)
      if (latest === null) {
        return result(record.recordId, 'conflict', {
          code: SYNC_CODES.revisionConflict,
        })
      }
      return compareRegistration(context, record, latest)
    }
  }
}

async function ingestFeedback(
  context: IngestContext,
  record: FeedbackWireRecord,
): Promise<SyncRecordResult> {
  /*
   * No registration lookup, and no foreign key. Feedback may legitimately reach
   * the server before the registration it refers to — the two devices upload
   * independently, whenever each finds a connection.
   */
  const stored = await context.store.getFeedback(record.recordId)

  if (stored === null) {
    const inserted = await context.store.insertFeedback(
      record,
      context.receivedAt,
      context.uploaderDeviceId,
    )

    if (inserted.outcome === 'inserted') {
      return result(record.recordId, 'accepted', { serverRevision: record.revision })
    }

    const now = await context.store.getFeedback(record.recordId)
    if (now === null) {
      return result(record.recordId, 'conflict', {
        code: SYNC_CODES.revisionConflict,
      })
    }
    return compareFeedback(context, record, now)
  }

  return compareFeedback(context, record, stored)
}

async function compareFeedback(
  context: IngestContext,
  record: FeedbackWireRecord,
  stored: CentralFeedback,
): Promise<SyncRecordResult> {
  const decision = decideAgainstStored(
    stored as unknown as Record<string, unknown>,
    record as unknown as Record<string, unknown>,
    FEEDBACK_IMMUTABLE,
    FEEDBACK_MUTABLE,
  )

  switch (decision) {
    case 'immutable':
      return result(record.recordId, 'conflict', {
        code: SYNC_CODES.immutableMismatch,
        serverRevision: stored.revision,
      })

    case 'server_newer':
      return result(record.recordId, 'server_newer', {
        serverRevision: stored.revision,
      })

    case 'conflict':
      return result(record.recordId, 'conflict', {
        code: SYNC_CODES.revisionConflict,
        serverRevision: stored.revision,
      })

    case 'already_current':
      await context.store.touchFeedback(
        record.recordId,
        context.receivedAt,
        context.uploaderDeviceId,
      )
      return result(record.recordId, 'already_current', {
        serverRevision: stored.revision,
      })

    case 'update': {
      const updated = await context.store.updateFeedback(
        record,
        stored.revision,
        context.receivedAt,
        context.uploaderDeviceId,
      )

      if (updated) {
        return result(record.recordId, 'accepted', {
          serverRevision: record.revision,
        })
      }

      const latest = await context.store.getFeedback(record.recordId)
      if (latest === null) {
        return result(record.recordId, 'conflict', {
          code: SYNC_CODES.revisionConflict,
        })
      }
      return compareFeedback(context, record, latest)
    }
  }
}

/**
 * Ingests one record.
 *
 * Note what is *not* checked: that `record.deviceId` matches the uploader. A
 * device restored from another device's backup uploads records captured
 * elsewhere, and requiring them to match would make recovery unsyncable.
 * Provenance and delivery are separate facts.
 */
export async function ingestRecord(
  context: IngestContext,
  record: SyncRecord,
): Promise<SyncRecordResult> {
  if (record.eventId !== context.eventId) {
    // A device enrolled for one event may not upload another's records.
    return result(record.recordId, 'invalid', { code: SYNC_CODES.wrongEvent })
  }

  return record.kind === 'registration'
    ? ingestRegistration(context, record)
    : ingestFeedback(context, record)
}

/**
 * Ingests a batch, one record at a time.
 *
 * Deliberately not one big transaction. A single conflicting record must not
 * strand the other ninety-nine — those are real captures sitting on one device,
 * and the whole point of syncing is to get them somewhere safe. Each record
 * commits on its own and returns its own outcome.
 */
export async function ingestBatch(
  context: IngestContext,
  records: readonly SyncRecord[],
): Promise<SyncRecordResult[]> {
  const results: SyncRecordResult[] = []

  for (const record of records) {
    results.push(await ingestRecord(context, record))
  }

  return results
}
