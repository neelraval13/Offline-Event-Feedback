import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, destroyTestDb } from '../../test/db'
import { OfflineEventDb } from './db'
import {
  allocatePublicCode,
  readSequence,
  sequenceKeyFor,
  type AllocatedPublicCode,
  type SequenceScope,
} from './sequences'
import { deviceId, eventDay, eventId, stationId } from '../../types'
import { isValidPublicCode } from '../identity/publicCode'
import { deriveIssuerCode } from '../identity/issuerCode'
import { newDeviceId } from '../identity/uuid'

const DEVICE_A = deviceId('11111111-2222-4333-8444-555555555555')
const DEVICE_B = deviceId('99999999-8888-4777-8666-555555555555')

const A1: SequenceScope = {
  eventId: eventId('evt-test'),
  eventDay: eventDay('2026-01-01'),
  stationId: stationId('A1'),
  issuerCode: deriveIssuerCode(DEVICE_A),
}

/** Same station, same event day, a different physical device. */
const A1_SECOND_DEVICE: SequenceScope = {
  ...A1,
  issuerCode: deriveIssuerCode(DEVICE_B),
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
    expect(allocated.publicCode).toBe('A1-B8EFD9-00001-X')
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
    const allocations = await Promise.all(
      Array.from({ length: 100 }, () => allocatePublicCode(database, A1)),
    )

    const sequences = allocations.map((a) => a.sequence)
    expect(new Set(sequences).size).toBe(100)
    expect(new Set(allocations.map((a) => a.publicCode)).size).toBe(100)
    expect(await readSequence(database, A1)).toBe(Math.max(...sequences))
  })

  it('counts separately per station', async () => {
    await allocatePublicCode(database, A1)
    await allocatePublicCode(database, A1)
    const b = await allocatePublicCode(database, B1)

    expect(b.sequence).toBe(1)
    expect(b.publicCode).toBe('B1-B8EFD9-00001-I')
    expect(await readSequence(database, A1)).toBe(2)
  })

  it('counts separately per event day', async () => {
    await allocatePublicCode(database, A1)
    expect((await allocatePublicCode(database, NEXT_DAY)).sequence).toBe(1)
  })

  it('counts separately per issuing device', async () => {
    await allocatePublicCode(database, A1)
    await allocatePublicCode(database, A1)

    const other = await allocatePublicCode(database, A1_SECOND_DEVICE)

    expect(other.sequence).toBe(1)
    expect(await readSequence(database, A1)).toBe(2)
    expect(sequenceKeyFor(A1)).not.toBe(sequenceKeyFor(A1_SECOND_DEVICE))
  })

  it('skips sequences that have no printable check character', async () => {
    // 58 is unprintable for A1/B8EFD9, so the counter jumps over it.
    await database.sequences.put({ key: sequenceKeyFor(A1), value: 57 })

    const allocated = await allocatePublicCode(database, A1)

    expect(allocated.sequence).toBe(59)
    expect(isValidPublicCode(allocated.publicCode)).toBe(true)
  })

  it('rolls back when the surrounding unit of work fails', async () => {
    await expect(
      database.transaction('rw', database.sequences, async () => {
        await allocatePublicCode(database, A1)
        throw new Error('caller failed after allocating')
      }),
    ).rejects.toThrow('caller failed after allocating')

    expect(await readSequence(database, A1)).toBe(0)
  })

  it('issues valid codes across a long run', async () => {
    const codes: string[] = []
    for (let i = 0; i < 250; i += 1) {
      codes.push((await allocatePublicCode(database, A1)).publicCode)
    }

    expect(new Set(codes).size).toBe(250)
    expect(
      codes.every((code) => isValidPublicCode(code, { expectedStation: 'A1' })),
    ).toBe(true)
  })
})

describe('two independent devices at station A1', () => {
  /*
   * The scenario Phase 1.1 exists for. Each device has its own IndexedDB and
   * cannot see the other — exactly the situation at the event — so both count
   * from 1. Before the issuer segment they printed identical codes.
   */
  it('generate large batches with no overlapping public codes', async () => {
    const deviceOne = createTestDb()
    const deviceTwo = createTestDb()

    try {
      const batchSize = 2_000
      const one: AllocatedPublicCode[] = []
      const two: AllocatedPublicCode[] = []

      for (let i = 0; i < batchSize; i += 1) {
        one.push(await allocatePublicCode(deviceOne, A1))
        two.push(await allocatePublicCode(deviceTwo, A1_SECOND_DEVICE))
      }

      expect(one[0]?.publicCode).toBe('A1-B8EFD9-00001-X')
      expect(two[0]?.publicCode).toBe('A1-6091A1-00001-C')

      // The counters really do collide — both devices work through very nearly
      // the same sequence numbers, because neither can see the other. This is
      // the collision that used to reach the sticker.
      const sequencesFromOne = new Set(one.map((a) => a.sequence))
      const sharedSequences = two.filter((a) =>
        sequencesFromOne.has(a.sequence),
      ).length
      expect(sharedSequences).toBeGreaterThan(batchSize * 0.9)

      // The codes do not. Not one is shared.
      const codesFromOne = new Set(one.map((a) => a.publicCode))
      expect(two.filter((a) => codesFromOne.has(a.publicCode))).toEqual([])
      expect(
        new Set([...one, ...two].map((a) => a.publicCode)).size,
      ).toBe(batchSize * 2)
    } finally {
      await destroyTestDb(deviceOne)
      await destroyTestDb(deviceTwo)
    }
  })

  it('stay disjoint across a fleet of five devices', async () => {
    const devices = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const db = createTestDb()
        return {
          db,
          scope: { ...A1, issuerCode: deriveIssuerCode(newDeviceId()) },
        }
      }),
    )

    try {
      const all: string[] = []
      for (const { db, scope } of devices) {
        for (let i = 0; i < 500; i += 1) {
          all.push((await allocatePublicCode(db, scope)).publicCode)
        }
      }

      expect(new Set(all).size).toBe(2_500)
      expect(all.every((code) => isValidPublicCode(code))).toBe(true)
    } finally {
      await Promise.all(devices.map(({ db }) => destroyTestDb(db)))
    }
  })
})
