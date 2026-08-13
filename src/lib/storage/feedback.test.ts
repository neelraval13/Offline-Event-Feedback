import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, destroyTestDb, testContext } from '../../test/db'
import { OfflineEventDb } from './db'
import {
  countFeedback,
  createFeedback,
  getFeedbackByRecordId,
  listFeedbackByPublicCode,
  listFeedbackBySyncStatus,
} from './feedback'
import { formatPublicCode } from '../identity/publicCode'
import { newParticipantId } from '../identity/uuid'
import { stationId, type FeedbackAnswers, type RecordContext } from '../../types'

const CONTEXT: RecordContext = testContext({ stationId: stationId('B1') })
const CODE = formatPublicCode('A1', 1)
const ANSWERS: FeedbackAnswers = {
  overall: 5,
  wouldReturn: true,
  comment: 'Well organised',
  highlights: ['staff', 'timing'],
}

let database: OfflineEventDb

beforeEach(() => {
  database = createTestDb()
})

afterEach(async () => {
  await destroyTestDb(database)
})

describe('feedback captured from a QR scan (invariant C)', () => {
  it('records both identifiers', async () => {
    const participantId = newParticipantId()

    const record = await createFeedback(database, {
      ...CONTEXT,
      identity: { captureMethod: 'qr-scan', publicCode: CODE, participantId },
      answers: ANSWERS,
    })

    expect(record.captureMethod).toBe('qr-scan')
    expect(record.publicCode).toBe(CODE)
    expect(record.participantId).toBe(participantId)
  })

  it('is retrievable by participant ID through the index', async () => {
    const participantId = newParticipantId()
    await createFeedback(database, {
      ...CONTEXT,
      identity: { captureMethod: 'qr-scan', publicCode: CODE, participantId },
      answers: ANSWERS,
    })

    const found = await database.feedback
      .where('participantId')
      .equals(participantId)
      .toArray()

    expect(found).toHaveLength(1)
  })
})

describe('feedback captured by manual entry (invariant D)', () => {
  it('records the public code alone', async () => {
    const record = await createFeedback(database, {
      ...CONTEXT,
      identity: { captureMethod: 'manual-code', publicCode: CODE },
      answers: ANSWERS,
    })

    expect(record.captureMethod).toBe('manual-code')
    expect(record.publicCode).toBe(CODE)
    expect(record.participantId).toBeUndefined()
  })

  it('omits the participant ID rather than storing an empty one', async () => {
    const record = await createFeedback(database, {
      ...CONTEXT,
      identity: { captureMethod: 'manual-code', publicCode: CODE },
      answers: ANSWERS,
    })

    const stored = await getFeedbackByRecordId(database, record.recordId)
    expect(stored).toBeDefined()
    expect(Object.hasOwn(stored as object, 'participantId')).toBe(false)
  })

  it('stays out of the participant ID index', async () => {
    await createFeedback(database, {
      ...CONTEXT,
      identity: { captureMethod: 'manual-code', publicCode: CODE },
      answers: ANSWERS,
    })

    const indexed = await database.feedback
      .where('participantId')
      .notEqual('')
      .count()

    expect(indexed).toBe(0)
    expect(await countFeedback(database)).toBe(1)
  })
})

describe('feedback records generally', () => {
  it('is stamped with provenance and starts pending', async () => {
    const record = await createFeedback(database, {
      ...CONTEXT,
      identity: { captureMethod: 'manual-code', publicCode: CODE },
      answers: ANSWERS,
    })

    expect(record.kind).toBe('feedback')
    expect(record.stationId).toBe('B1')
    expect(record.deviceId).toBe(CONTEXT.deviceId)
    expect(record.eventId).toBe(CONTEXT.eventId)
    expect(record.revision).toBe(1)
    expect(record.syncStatus).toBe('pending')
  })

  it('preserves the answer payload verbatim', async () => {
    const record = await createFeedback(database, {
      ...CONTEXT,
      identity: { captureMethod: 'manual-code', publicCode: CODE },
      answers: ANSWERS,
    })

    const stored = await getFeedbackByRecordId(database, record.recordId)
    expect(stored?.answers).toEqual(ANSWERS)
  })

  it('survives a restart', async () => {
    const record = await createFeedback(database, {
      ...CONTEXT,
      identity: { captureMethod: 'manual-code', publicCode: CODE },
      answers: ANSWERS,
    })
    const name = database.name

    database.close()
    const reopened = new OfflineEventDb(name)
    expect(await getFeedbackByRecordId(reopened, record.recordId)).toEqual(record)
    reopened.close()
  })

  it('keeps both submissions when one participant is recorded twice', async () => {
    // Point B cannot rule this out offline, and discarding the second would
    // destroy evidence the server needs.
    await createFeedback(database, {
      ...CONTEXT,
      identity: { captureMethod: 'qr-scan', publicCode: CODE, participantId: newParticipantId() },
      answers: ANSWERS,
    })
    await createFeedback(database, {
      ...CONTEXT,
      identity: { captureMethod: 'manual-code', publicCode: CODE },
      answers: { overall: 3 },
    })

    expect(await listFeedbackByPublicCode(database, CODE)).toHaveLength(2)
  })

  it('lists records awaiting synchronisation', async () => {
    await createFeedback(database, {
      ...CONTEXT,
      identity: { captureMethod: 'manual-code', publicCode: CODE },
      answers: ANSWERS,
    })

    expect(await listFeedbackBySyncStatus(database, 'pending')).toHaveLength(1)
    expect(await listFeedbackBySyncStatus(database, 'synced')).toHaveLength(0)
  })

  it('holds no participant PII', async () => {
    const record = await createFeedback(database, {
      ...CONTEXT,
      identity: { captureMethod: 'manual-code', publicCode: CODE },
      answers: ANSWERS,
    })

    // Point B's store has identity and answers, and no field for anything else.
    expect(Object.keys(record).sort()).toEqual([
      'answers',
      'captureMethod',
      'createdAt',
      'deviceId',
      'eventDay',
      'eventId',
      'kind',
      'publicCode',
      'recordId',
      'revision',
      'stationId',
      'syncStatus',
      'updatedAt',
    ])
  })
})
