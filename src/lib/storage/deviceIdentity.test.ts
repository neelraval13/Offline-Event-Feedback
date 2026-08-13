import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, destroyTestDb } from '../../test/db'
import { OfflineEventDb } from './db'
import { DEVICE_ID_KEY, getOrCreateDeviceId, peekDeviceId } from './deviceIdentity'

let database: OfflineEventDb

beforeEach(() => {
  database = createTestDb()
})

afterEach(async () => {
  await destroyTestDb(database)
})

describe('getOrCreateDeviceId', () => {
  it('generates an ID on first use', async () => {
    expect(await peekDeviceId(database)).toBeUndefined()

    const id = await getOrCreateDeviceId(database)

    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('persists what it generated', async () => {
    const id = await getOrCreateDeviceId(database)
    expect(await peekDeviceId(database)).toBe(id)
  })

  it('returns the same ID on every subsequent call', async () => {
    const first = await getOrCreateDeviceId(database)
    const second = await getOrCreateDeviceId(database)
    const third = await getOrCreateDeviceId(database)

    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  it('survives a browser restart', async () => {
    const id = await getOrCreateDeviceId(database)
    const name = database.name

    // Closing the connection and opening a fresh one is what a page refresh
    // or a browser restart does.
    database.close()
    const reopened = new OfflineEventDb(name)

    expect(await getOrCreateDeviceId(reopened)).toBe(id)
    reopened.close()
  })

  it('mints only one ID when calls race', async () => {
    const ids = await Promise.all(
      Array.from({ length: 20 }, () => getOrCreateDeviceId(database)),
    )

    expect(new Set(ids).size).toBe(1)
    expect(await database.deviceConfig.count()).toBe(1)
  })

  it('stores the ID under a stable key with a timestamp', async () => {
    const id = await getOrCreateDeviceId(database)
    const row = await database.deviceConfig.get(DEVICE_ID_KEY)

    expect(row?.value).toBe(id)
    expect(row?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('is independent of the station a device is operating as', async () => {
    // One browser visiting both routes during development is still one device.
    const id = await getOrCreateDeviceId(database)
    expect(id).not.toContain('A1')
    expect(id).not.toContain('B1')
  })
})
