import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, destroyTestDb } from '../../test/db'
import type { OfflineEventDb } from './db'
import { createRegistration, listRecentRegistrations } from './registrations'
import { getOrCreateDeviceId } from './deviceIdentity'
import { allocatePublicCode, readSequence, sequenceKeyFor } from './sequences'
import { deriveIssuerCode } from '../identity/issuerCode'
import { nextIssuableSequence } from '../identity/publicCode'
import { eventDay, eventId, stationId } from '../../types'

/*
 * Issuing public codes on a device that already holds another event's.
 *
 * ## The outage this prevents
 *
 * The sequence counter is keyed by event, so a new event restarts at 1. The
 * public code is not: it is station, issuer, sequence and a check character,
 * and the issuer comes from the device. A tablet that ran the previous event
 * and was rolled over without being wiped therefore tried to issue that event's
 * first code to this event's first rider, into a unique index that already held
 * it.
 *
 * The result was worse than one refused registration. The sequence bump and the
 * insert share a transaction, so the bump rolled back too: the counter never
 * moved, and every rider after the first failed identically. Point A on that
 * device could not register anybody, and the only thing on screen was "Could
 * not save this registration".
 *
 * It was invisible until now because a device had only ever seen one event.
 */

const PREVIOUS = {
  eventId: eventId('ff-rc-2026-08-23'),
  eventDay: eventDay('2026-08-23'),
}
const CURRENT = {
  eventId: eventId('ff-2026-09-20'),
  eventDay: eventDay('2026-09-20'),
}

let database: OfflineEventDb

beforeEach(() => {
  database = createTestDb()
})

afterEach(async () => {
  await destroyTestDb(database)
})

async function register(
  event: { eventId: ReturnType<typeof eventId>; eventDay: ReturnType<typeof eventDay> },
  name: string,
) {
  const deviceId = await getOrCreateDeviceId(database)
  return createRegistration(database, {
    ...event,
    stationId: stationId('A1'),
    deviceId,
    name,
    phone: '9876543210',
    email: `${name.toLowerCase()}@example.invalid`,
  })
}

describe('a device still holding the previous event’s registrations', () => {
  it('can still register a rider for this event', async () => {
    // The regression, stated as the thing an operator actually needs.
    await register(PREVIOUS, 'August')

    const september = await register(CURRENT, 'September')

    expect(september.publicCode).toBeDefined()
    expect(await database.registrations.count()).toBe(2)
  })

  it('issues a different code from the one already on a sticker', async () => {
    /*
     * The reason it must not simply overwrite: the previous event's code is
     * printed on a sticker a rider was given. Two records sharing it would make
     * the code ambiguous everywhere it is read, which is precisely what the
     * unique index exists to prevent.
     */
    const august = await register(PREVIOUS, 'August')
    const september = await register(CURRENT, 'September')

    expect(september.publicCode).not.toBe(august.publicCode)
  })

  it('keeps every rider after the first working too', async () => {
    /*
     * The part that made this an outage rather than an inconvenience. The
     * rolled-back sequence meant the failure repeated for every rider, so a
     * test that registered only one September rider would have passed against
     * a fix that worked once.
     */
    await register(PREVIOUS, 'AugustOne')
    await register(PREVIOUS, 'AugustTwo')
    await register(PREVIOUS, 'AugustThree')

    const codes = [
      (await register(CURRENT, 'SeptOne')).publicCode,
      (await register(CURRENT, 'SeptTwo')).publicCode,
      (await register(CURRENT, 'SeptThree')).publicCode,
      (await register(CURRENT, 'SeptFour')).publicCode,
    ]

    expect(new Set(codes).size).toBe(4)
    expect(await database.registrations.count()).toBe(7)
  })

  it('leaves the previous event’s registrations untouched', async () => {
    const august = await register(PREVIOUS, 'August')
    await register(CURRENT, 'September')

    expect(await database.registrations.get(august.recordId)).toEqual(august)
  })

  it('advances the counter past the taken codes, so later riders skip nothing', async () => {
    /*
     * The cost is paid once. After the first September rider steps over the
     * codes the previous event took, the counter holds the number it landed on,
     * and every rider after that takes the next issuable sequence directly.
     *
     * "Next issuable", not "one more". `nextIssuableSequence` skips any
     * sequence whose check character cannot be formed for this issuer, which is
     * ordinary behaviour that predates this fix, and which of them are skipped
     * depends on the issuer code and therefore on the device ID. Asserting a
     * step of exactly one was wrong and failed roughly one run in twenty, on
     * the runs where the next number happened to be unprintable.
     */
    for (const name of ['A1', 'A2', 'A3', 'A4', 'A5']) {
      await register(PREVIOUS, name)
    }

    const deviceId = await getOrCreateDeviceId(database)
    const issuerCode = deriveIssuerCode(deviceId)
    const scope = { ...CURRENT, stationId: stationId('A1'), issuerCode }

    await register(CURRENT, 'September')

    const afterFirst = await readSequence(database, scope)
    expect(afterFirst).toBeGreaterThan(5)

    await register(CURRENT, 'SeptemberTwo')
    const afterSecond = await readSequence(database, scope)

    /*
     * Exactly the next issuable sequence: the second rider stepped over nothing
     * that was taken, only over any number this issuer cannot print. Computed
     * from the same helper allocation uses, so the assertion cannot disagree
     * with the rule it is checking.
     */
    expect(afterSecond).toBe(
      nextIssuableSequence({ stationId: stationId('A1'), issuerCode }, afterFirst + 1),
    )
  })

  it('keeps the sequence scoped per event, as the key says', async () => {
    // The fix does not change what the counter is keyed by. It changes only
    // that an allocation will not hand back a code this database already holds.
    const deviceId = await getOrCreateDeviceId(database)
    const issuerCode = deriveIssuerCode(deviceId)

    expect(
      sequenceKeyFor({ ...PREVIOUS, stationId: stationId('A1'), issuerCode }),
    ).not.toBe(
      sequenceKeyFor({ ...CURRENT, stationId: stationId('A1'), issuerCode }),
    )
  })
})

describe('the recent list, ordered and limited', () => {
  /*
   * The filter has to be applied before the limit, and this is the shape that
   * tells the two orderings apart.
   *
   * A device that ran a previous event holds rows that are NEWER than this
   * event's, because they were captured first only in the sense of belonging
   * to an earlier event; on a re-used tablet the previous event's rows can sit
   * anywhere in the ordering. Here they are deliberately the newest, and there
   * are more of them than the limit. Limiting first would take `limit` foreign
   * rows, filter them all away, and hand the station an empty list while its
   * own registrations sat just behind them.
   */
  async function seed(count: number, event: typeof PREVIOUS, prefix: string) {
    const created: string[] = []
    for (let index = 0; index < count; index += 1) {
      const record = await register(event, `${prefix}${index}`)
      created.push(record.recordId)
      // Distinct `createdAt` values, since the ordering is what is under test.
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    return created
  }

  it('returns this event’s newest rows even when newer foreign rows fill the limit', async () => {
    const LIMIT = 8

    // This event's registrations first, so they are the OLDER rows.
    const mine = await seed(LIMIT, CURRENT, 'Sept')
    // Then more than a full page of the previous event's, all newer.
    await seed(LIMIT, PREVIOUS, 'Aug')

    const recent = await listRecentRegistrations(
      database,
      LIMIT,
      CURRENT.eventId,
    )

    // Every one of this event's rows, newest first, and nothing else.
    expect(recent.map((record) => record.recordId)).toEqual([...mine].reverse())
    expect(recent).toHaveLength(LIMIT)
    for (const record of recent) {
      expect(record.eventId).toBe(CURRENT.eventId)
    }
  })

  it('still honours the limit when this event has more than a page', async () => {
    const LIMIT = 3

    await seed(2, PREVIOUS, 'Aug')
    const mine = await seed(5, CURRENT, 'Sept')

    const recent = await listRecentRegistrations(
      database,
      LIMIT,
      CURRENT.eventId,
    )

    // The three newest of this event's five, not the three newest overall.
    expect(recent.map((record) => record.recordId)).toEqual(
      mine.slice(-LIMIT).reverse(),
    )
  })

  it('returns nothing when only the previous event has rows', async () => {
    await seed(4, PREVIOUS, 'Aug')

    expect(await listRecentRegistrations(database, 8, CURRENT.eventId)).toEqual(
      [],
    )
    expect(await database.registrations.count()).toBe(4)
  })
})

describe('allocation on a clean device', () => {
  it('is unchanged: the first code is the first sequence', async () => {
    /*
     * The ordinary case must not have moved. A device that has never seen
     * another event allocates exactly as it always did, with no skipping.
     */
    const deviceId = await getOrCreateDeviceId(database)
    const scope = {
      ...CURRENT,
      stationId: stationId('A1'),
      issuerCode: deriveIssuerCode(deviceId),
    }

    const first = await allocatePublicCode(database, scope)
    const second = await allocatePublicCode(database, scope)

    expect(first.sequence).toBe(1)
    expect(second.sequence).toBeGreaterThan(first.sequence)
    expect(first.publicCode).not.toBe(second.publicCode)
  })
})
