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
import { deriveIssuerCode } from '../identity/issuerCode'
import { newParticipantId } from '../identity/uuid'
import {
  deviceId,
  FEEDBACK_FORM_VERSION,
  stationId,
  type FeedbackAnswers,
  type RecordContext,
} from '../../types'

const CONTEXT: RecordContext = testContext({ stationId: stationId('B1') })
const CODE = formatPublicCode(
  {
    stationId: stationId('A1'),
    issuerCode: deriveIssuerCode(deviceId('11111111-2222-4333-8444-555555555555')),
  },
  1,
)
const ANSWERS: FeedbackAnswers = {
  overall_rating: 5,
  experience: 'excellent',
  recommend: true,
  comments: 'Well organised',
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
      formVersion: FEEDBACK_FORM_VERSION,
      identity: { captureMethod: 'qr', publicCode: CODE, participantId },
      answers: ANSWERS,
    })

    /*
     * `toMatchObject` rather than three property reads. `FeedbackRecord` is a
     * union of three identity shapes, so `record.publicCode` does not compile
     * without narrowing first, which is the point of the union: production code
     * has to establish which shape it holds before reading a field only some
     * shapes have. A test asserting the whole shape at once says the same thing
     * and needs no narrowing.
     */
    expect(record).toMatchObject({
      captureMethod: 'qr',
      publicCode: CODE,
      participantId,
    })
  })

  it('is retrievable by participant ID through the index', async () => {
    const participantId = newParticipantId()
    await createFeedback(database, {
      ...CONTEXT,
      formVersion: FEEDBACK_FORM_VERSION,
      identity: { captureMethod: 'qr', publicCode: CODE, participantId },
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
      formVersion: FEEDBACK_FORM_VERSION,
      identity: { captureMethod: 'manual', publicCode: CODE },
      answers: ANSWERS,
    })

    expect(record).toMatchObject({ captureMethod: 'manual', publicCode: CODE })
    expect(Object.hasOwn(record, 'participantId')).toBe(false)
  })

  it('omits the participant ID rather than storing an empty one', async () => {
    const record = await createFeedback(database, {
      ...CONTEXT,
      formVersion: FEEDBACK_FORM_VERSION,
      identity: { captureMethod: 'manual', publicCode: CODE },
      answers: ANSWERS,
    })

    const stored = await getFeedbackByRecordId(database, record.recordId)
    expect(stored).toBeDefined()
    expect(Object.hasOwn(stored as object, 'participantId')).toBe(false)
  })

  it('stays out of the participant ID index', async () => {
    await createFeedback(database, {
      ...CONTEXT,
      formVersion: FEEDBACK_FORM_VERSION,
      identity: { captureMethod: 'manual', publicCode: CODE },
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
      formVersion: FEEDBACK_FORM_VERSION,
      identity: { captureMethod: 'manual', publicCode: CODE },
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
      formVersion: FEEDBACK_FORM_VERSION,
      identity: { captureMethod: 'manual', publicCode: CODE },
      answers: ANSWERS,
    })

    const stored = await getFeedbackByRecordId(database, record.recordId)
    expect(stored?.answers).toEqual(ANSWERS)
  })

  it('survives a restart', async () => {
    const record = await createFeedback(database, {
      ...CONTEXT,
      formVersion: FEEDBACK_FORM_VERSION,
      identity: { captureMethod: 'manual', publicCode: CODE },
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
      formVersion: FEEDBACK_FORM_VERSION,
      identity: { captureMethod: 'qr', publicCode: CODE, participantId: newParticipantId() },
      answers: ANSWERS,
    })
    await createFeedback(database, {
      ...CONTEXT,
      formVersion: FEEDBACK_FORM_VERSION,
      identity: { captureMethod: 'manual', publicCode: CODE },
      answers: { overall_rating: 3, experience: 'okay', recommend: false },
    })

    expect(await listFeedbackByPublicCode(database, CODE)).toHaveLength(2)
  })

  it('lists records awaiting synchronisation', async () => {
    await createFeedback(database, {
      ...CONTEXT,
      formVersion: FEEDBACK_FORM_VERSION,
      identity: { captureMethod: 'manual', publicCode: CODE },
      answers: ANSWERS,
    })

    expect(await listFeedbackBySyncStatus(database, 'pending')).toHaveLength(1)
    expect(await listFeedbackBySyncStatus(database, 'synced')).toHaveLength(0)
  })

  it('holds no participant PII on a sticker capture', async () => {
    const record = await createFeedback(database, {
      ...CONTEXT,
      formVersion: FEEDBACK_FORM_VERSION,
      identity: { captureMethod: 'manual', publicCode: CODE },
      answers: ANSWERS,
    })

    /*
     * A sticker capture has identity and answers and no field for anything
     * else. This is stricter than "does not contain a name": it asserts the
     * exact key set, so a future change that started attaching contact details
     * to a scanned response has to come and edit this list, in a test whose
     * name says why the list is short.
     */
    expect(Object.keys(record).sort()).toEqual([
      'answers',
      'captureMethod',
      'createdAt',
      'deviceId',
      'eventDay',
      'eventId',
      'formVersion',
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

describe('feedback captured from contact details', () => {
  const CONTACT = {
    captureMethod: 'contact',
    respondentName: 'Grace Hopper',
    respondentPhone: '9876543210',
    respondentEmail: 'grace@example.com',
  } as const

  it('records the rider’s own details as the identity', async () => {
    const record = await createFeedback(database, {
      ...CONTEXT,
      formVersion: FEEDBACK_FORM_VERSION,
      identity: CONTACT,
      answers: ANSWERS,
    })

    expect(record).toMatchObject(CONTACT)
  })

  it('invents no public code and no participant ID', async () => {
    /*
     * The defect this exists to prevent: fabricating an identifier so the
     * record fits the shape the other two paths have. A blank or generated
     * public code would join against every other blank one the moment somebody
     * wrote a query that trusted the column.
     */
    const record = await createFeedback(database, {
      ...CONTEXT,
      formVersion: FEEDBACK_FORM_VERSION,
      identity: CONTACT,
      answers: ANSWERS,
    })

    const stored = await getFeedbackByRecordId(database, record.recordId)
    expect(stored).toBeDefined()
    expect(Object.hasOwn(stored as object, 'publicCode')).toBe(false)
    expect(Object.hasOwn(stored as object, 'participantId')).toBe(false)
  })

  it('stays out of both sparse indexes', async () => {
    await createFeedback(database, {
      ...CONTEXT,
      formVersion: FEEDBACK_FORM_VERSION,
      identity: CONTACT,
      answers: ANSWERS,
    })

    // An absent property is absent from the index. This is what makes a new
    // Dexie version unnecessary for this change.
    expect(await database.feedback.where('publicCode').notEqual('').count()).toBe(0)
    expect(
      await database.feedback.where('participantId').notEqual('').count(),
    ).toBe(0)
    expect(await countFeedback(database)).toBe(1)
  })

  it('starts pending, like every other record', async () => {
    const record = await createFeedback(database, {
      ...CONTEXT,
      formVersion: FEEDBACK_FORM_VERSION,
      identity: CONTACT,
      answers: ANSWERS,
    })

    expect(record.syncStatus).toBe('pending')
    expect(record.revision).toBe(1)
  })

  it('survives a restart with every field intact', async () => {
    const record = await createFeedback(database, {
      ...CONTEXT,
      formVersion: FEEDBACK_FORM_VERSION,
      identity: CONTACT,
      answers: ANSWERS,
    })
    const name = database.name

    database.close()
    const reopened = new OfflineEventDb(name)
    // Deep equality, so a lost respondent field fails here rather than at the
    // export three phases later.
    expect(await getFeedbackByRecordId(reopened, record.recordId)).toEqual(record)
    reopened.close()
  })

  it('keeps both responses when the same person answers twice', async () => {
    /*
     * No duplicate guard applies here, deliberately. There is no code to be the
     * same as, and refusing a response because another on this device shares a
     * phone number would be one offline tablet deciding two humans are one.
     */
    for (const answers of [ANSWERS, { ...ANSWERS, overall_rating: 3 as const }]) {
      await createFeedback(database, {
        ...CONTEXT,
        formVersion: FEEDBACK_FORM_VERSION,
        identity: CONTACT,
        answers,
      })
    }

    expect(await countFeedback(database)).toBe(2)
  })

  it('leaves sticker responses untouched in the same database', async () => {
    await createFeedback(database, {
      ...CONTEXT,
      formVersion: FEEDBACK_FORM_VERSION,
      identity: { captureMethod: 'qr', publicCode: CODE, participantId: newParticipantId() },
      answers: ANSWERS,
    })
    await createFeedback(database, {
      ...CONTEXT,
      formVersion: FEEDBACK_FORM_VERSION,
      identity: CONTACT,
      answers: ANSWERS,
    })

    // The code lookup finds the scanned one and only the scanned one.
    expect(await listFeedbackByPublicCode(database, CODE)).toHaveLength(1)
    expect(await countFeedback(database)).toBe(2)
  })
})
