import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, destroyTestDb } from '../../test/db'
import { OfflineEventDb } from './db'
import {
  allocatePublicCode,
  readSequence,
  sequenceKeyFor,
  type SequenceScope,
} from './sequences'
import { eventDay, eventId, stationId } from '../../types'
import { isValidPublicCode } from '../identity/publicCode'

const A1: SequenceScope = {
  eventId: eventId('evt-test'),
  eventDay: eventDay('2026-01-01'),
  stationId: stationId('A1'),
}

const B1: SequenceScope = { ...A1, stationId: stationId('B1') }
const NEXT_DAY: SequenceScope = { ...A1, eventDay: eventDay('2026-01-02') }

let database: OfflineEventDb

beforeEach(() => {
  database = createTestDb()
})

afterEach(async () => {
  await destroyTestDb(database)
})

describe('allocatePublicCode', () => {
  it('starts at sequence 1', async () => {
    expect(await readSequence(database, A1)).toBe(0)

    const allocated = await allocatePublicCode(database, A1)

    expect(allocated.sequence).toBe(1)
    expect(allocated.publicCode).toBe('A1-00001-O')
  })

  it('increments on each call', async () => {
    const first = await allocatePublicCode(database, A1)
    const second = await allocatePublicCode(database, A1)
    const third = await allocatePublicCode(database, A1)

    expect([first.sequence, second.sequence, third.sequence]).toEqual([1, 2, 3])
  })

  it('records the last issued value', async () => {
    await allocatePublicCode(database, A1)
    await allocatePublicCode(database, A1)

    expect(await readSequence(database, A1)).toBe(2)
  })

  it('survives a browser restart without resetting', async () => {
    await allocatePublicCode(database, A1)
    await allocatePublicCode(database, A1)
    const name = database.name

    database.close()
    const reopened = new OfflineEventDb(name)
    const afterRestart = await allocatePublicCode(reopened, A1)

    expect(afterRestart.sequence).toBe(3)
    reopened.close()
  })

  it('hands out distinct codes when allocations race', async () => {
    // The failure this guards against is two rapid registrations in one
    // browser reading the counter before either writes it back.
    const allocations = await Promise.all(
      Array.from({ length: 100 }, () => allocatePublicCode(database, A1)),
    )

    const sequences = allocations.map((a) => a.sequence)
    const codes = allocations.map((a) => a.publicCode)

    expect(new Set(sequences).size).toBe(100)
    expect(new Set(codes).size).toBe(100)
    expect(await readSequence(database, A1)).toBe(Math.max(...sequences))
  })

  it('counts separately per station', async () => {
    await allocatePublicCode(database, A1)
    await allocatePublicCode(database, A1)
    const b = await allocatePublicCode(database, B1)

    expect(b.sequence).toBe(1)
    expect(b.publicCode).toBe('B1-00001-7')
    expect(await readSequence(database, A1)).toBe(2)
  })

  it('counts separately per event day', async () => {
    await allocatePublicCode(database, A1)
    const nextDay = await allocatePublicCode(database, NEXT_DAY)

    expect(nextDay.sequence).toBe(1)
  })

  it('skips sequences that have no printable check character', async () => {
    // 288 is unprintable for A1, so the counter jumps over it.
    await database.sequences.put({ key: sequenceKeyFor(A1), value: 287 })

    const allocated = await allocatePublicCode(database, A1)

    expect(allocated.sequence).toBe(289)
    expect(isValidPublicCode(allocated.publicCode)).toBe(true)
  })

  it('rolls back when the surrounding unit of work fails', async () => {
    await expect(
      database.transaction('rw', database.sequences, async () => {
        await allocatePublicCode(database, A1)
        throw new Error('caller failed after allocating')
      }),
    ).rejects.toThrow('caller failed after allocating')

    // The code was never printed, so the number must not be consumed.
    expect(await readSequence(database, A1)).toBe(0)
  })

  it('issues valid codes across a long run', async () => {
    const codes: string[] = []
    for (let i = 0; i < 250; i += 1) {
      codes.push((await allocatePublicCode(database, A1)).publicCode)
    }

    expect(new Set(codes).size).toBe(250)
    expect(codes.every((code) => isValidPublicCode(code, { expectedPrefix: 'A1' }))).toBe(true)
  })
})
