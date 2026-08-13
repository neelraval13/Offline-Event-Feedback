import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, destroyTestDb, testContext } from '../../test/db'
import { OfflineEventDb } from './db'
import {
  countRegistrations,
  createRegistration,
  getRegistrationByParticipantId,
  getRegistrationByPublicCode,
  getRegistrationByRecordId,
  listRegistrationsBySyncStatus,
  updateRegistration,
  type NewRegistrationInput,
} from './registrations'
import { readSequence } from './sequences'
import { isValidPublicCode } from '../identity/publicCode'
import { isUuid } from '../identity/uuid'
import { recordId as toRecordId, type RecordContext } from '../../types'

const CONTEXT: RecordContext = testContext()

function input(overrides: Partial<NewRegistrationInput> = {}): NewRegistrationInput {
  return {
    ...CONTEXT,
    name: 'Ada Lovelace',
    phone: '+44 20 7946 0958',
    email: 'ada@example.com',
    ...overrides,
  }
}

let database: OfflineEventDb

beforeEach(() => {
  database = createTestDb()
})

afterEach(async () => {
  await destroyTestDb(database)
})

describe('createRegistration', () => {
  it('returns a fully stamped record', async () => {
    const record = await createRegistration(database, input())

    expect(record.kind).toBe('registration')
    expect(isUuid(record.recordId)).toBe(true)
    expect(isUuid(record.participantId)).toBe(true)
    expect(isValidPublicCode(record.publicCode, { expectedPrefix: 'A1' })).toBe(
      true,
    )
    expect(record.eventId).toBe(CONTEXT.eventId)
    expect(record.eventDay).toBe(CONTEXT.eventDay)
    expect(record.stationId).toBe(CONTEXT.stationId)
    expect(record.deviceId).toBe(CONTEXT.deviceId)
    expect(record.revision).toBe(1)
    expect(record.syncStatus).toBe('pending')
    expect(record.createdAt).toBe(record.updatedAt)
  })

  it('persists the record so it survives a restart', async () => {
    const record = await createRegistration(database, input())
    const name = database.name

    database.close()
    const reopened = new OfflineEventDb(name)
    const loaded = await getRegistrationByRecordId(reopened, record.recordId)

    expect(loaded).toEqual(record)
    reopened.close()
  })

  it('stores the participant details', async () => {
    const record = await createRegistration(database, input())

    expect(record.name).toBe('Ada Lovelace')
    expect(record.phone).toBe('+44 20 7946 0958')
    expect(record.email).toBe('ada@example.com')
  })

  it('issues sequential public codes', async () => {
    const first = await createRegistration(database, input())
    const second = await createRegistration(database, input({ name: 'Grace' }))

    expect(first.publicCode).toBe('A1-00001-O')
    expect(second.publicCode).toBe('A1-00002-M')
  })

  it('gives every record a distinct identity, even under concurrency', async () => {
    const records = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        createRegistration(database, input({ name: `Participant ${i}` })),
      ),
    )

    expect(new Set(records.map((r) => r.recordId)).size).toBe(60)
    expect(new Set(records.map((r) => r.participantId)).size).toBe(60)
    expect(new Set(records.map((r) => r.publicCode)).size).toBe(60)
    expect(await countRegistrations(database)).toBe(60)
  })

  it('leaves the sequence untouched when the write fails', async () => {
    await expect(
      database.transaction(
        'rw',
        database.sequences,
        database.registrations,
        async () => {
          await createRegistration(database, input())
          throw new Error('printer check failed')
        },
      ),
    ).rejects.toThrow('printer check failed')

    expect(await countRegistrations(database)).toBe(0)
    expect(
      await readSequence(database, {
        eventId: CONTEXT.eventId,
        eventDay: CONTEXT.eventDay,
        stationId: CONTEXT.stationId,
      }),
    ).toBe(0)
  })

  it('only resolves once the data is committed', async () => {
    // Invariant 1: a caller that awaits this and then prints cannot print
    // ahead of the save.
    const record = await createRegistration(database, input())
    database.close()

    const reopened = new OfflineEventDb(database.name)
    expect(await getRegistrationByRecordId(reopened, record.recordId)).toBeDefined()
    reopened.close()
  })
})

describe('retrieval', () => {
  it('finds a registration by record ID', async () => {
    const record = await createRegistration(database, input())
    expect(await getRegistrationByRecordId(database, record.recordId)).toEqual(
      record,
    )
  })

  it('finds a registration by participant ID', async () => {
    const record = await createRegistration(database, input())
    expect(
      await getRegistrationByParticipantId(database, record.participantId),
    ).toEqual(record)
  })

  it('finds a registration by public code', async () => {
    const record = await createRegistration(database, input())
    expect(
      await getRegistrationByPublicCode(database, record.publicCode),
    ).toEqual(record)
  })

  it('returns undefined for identities it has never seen', async () => {
    expect(
      await getRegistrationByRecordId(database, toRecordId('missing')),
    ).toBeUndefined()
  })

  it('lists records awaiting synchronisation', async () => {
    await createRegistration(database, input())
    await createRegistration(database, input({ name: 'Grace' }))

    const pending = await listRegistrationsBySyncStatus(database, 'pending')
    expect(pending).toHaveLength(2)
    expect(await listRegistrationsBySyncStatus(database, 'synced')).toHaveLength(
      0,
    )
  })
})

describe('updateRegistration', () => {
  it('bumps the revision and the update time', async () => {
    const created = await createRegistration(database, input())
    const updated = await updateRegistration(database, created.recordId, {
      phone: '+44 20 0000 0000',
    })

    expect(updated.revision).toBe(2)
    expect(updated.phone).toBe('+44 20 0000 0000')
    expect(updated.updatedAt >= created.updatedAt).toBe(true)
    expect(updated.createdAt).toBe(created.createdAt)
  })

  it('accumulates revisions', async () => {
    const created = await createRegistration(database, input())
    await updateRegistration(database, created.recordId, { name: 'A' })
    await updateRegistration(database, created.recordId, { name: 'B' })
    const third = await updateRegistration(database, created.recordId, {
      name: 'C',
    })

    expect(third.revision).toBe(4)
    expect(third.name).toBe('C')
  })

  it('persists the update', async () => {
    const created = await createRegistration(database, input())
    await updateRegistration(database, created.recordId, { email: 'new@x.test' })

    const loaded = await getRegistrationByRecordId(database, created.recordId)
    expect(loaded?.email).toBe('new@x.test')
    expect(loaded?.revision).toBe(2)
  })

  it('never changes the identity printed on the sticker', async () => {
    const created = await createRegistration(database, input())
    const updated = await updateRegistration(database, created.recordId, {
      name: 'Renamed',
    })

    expect(updated.participantId).toBe(created.participantId)
    expect(updated.publicCode).toBe(created.publicCode)
    expect(updated.recordId).toBe(created.recordId)
  })

  it('can move a record through sync states', async () => {
    const created = await createRegistration(database, input())

    expect((await updateRegistration(database, created.recordId, {
      syncStatus: 'syncing',
    })).syncStatus).toBe('syncing')
    expect((await updateRegistration(database, created.recordId, {
      syncStatus: 'synced',
    })).syncStatus).toBe('synced')
    expect((await updateRegistration(database, created.recordId, {
      syncStatus: 'error',
    })).syncStatus).toBe('error')
  })

  it('leaves untouched fields alone', async () => {
    const created = await createRegistration(database, input())
    const updated = await updateRegistration(database, created.recordId, {
      name: 'Renamed',
    })

    expect(updated.phone).toBe(created.phone)
    expect(updated.email).toBe(created.email)
  })

  it('rejects an unknown record', async () => {
    await expect(
      updateRegistration(database, toRecordId('missing'), { name: 'X' }),
    ).rejects.toThrow(/No registration/)
  })
})

describe('database-level duplicate protection', () => {
  it('refuses two records with the same public code', async () => {
    const record = await createRegistration(database, input())

    await expect(
      database.registrations.add({
        ...record,
        recordId: toRecordId('another-record'),
      }),
    ).rejects.toThrow()
  })

  it('refuses two records with the same participant ID', async () => {
    const record = await createRegistration(database, input())

    await expect(
      database.registrations.add({
        ...record,
        recordId: toRecordId('another-record'),
        publicCode: (await createRegistration(database, input())).publicCode,
      }),
    ).rejects.toThrow()
  })
})
