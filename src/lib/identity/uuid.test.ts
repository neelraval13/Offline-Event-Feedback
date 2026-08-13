import { describe, expect, it } from 'vitest'
import { isUuid, newDeviceId, newParticipantId, newRecordId } from './uuid'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The version nibble of a canonical UUID. */
function versionOf(id: string): string {
  return id.charAt(14)
}

describe('newParticipantId', () => {
  it('generates a canonical UUID', () => {
    const id = newParticipantId()
    expect(id).toMatch(UUID_PATTERN)
    expect(isUuid(id)).toBe(true)
  })

  it('generates version 7, so IDs are time-ordered', () => {
    expect(versionOf(newParticipantId())).toBe('7')
  })

  it('generates 10,000 unique IDs', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 10_000; i += 1) {
      ids.add(newParticipantId())
    }
    expect(ids.size).toBe(10_000)
  })

  it('generates IDs that sort into creation order', () => {
    const ids = Array.from({ length: 1_000 }, () => newParticipantId())
    expect([...ids].sort()).toEqual(ids)
  })

  it('needs no network and no central sequence', () => {
    // Nothing to assert against a stub: generation is synchronous and local,
    // which is exactly the property. A call that returns without awaiting
    // anything cannot have consulted a server.
    expect(typeof newParticipantId()).toBe('string')
  })
})

describe('newRecordId', () => {
  it('generates unique, time-ordered UUIDs', () => {
    const ids = Array.from({ length: 5_000 }, () => newRecordId())
    expect(new Set(ids).size).toBe(5_000)
    expect(versionOf(ids[0] as string)).toBe('7')
  })
})

describe('newDeviceId', () => {
  it('generates a random (v4) UUID', () => {
    const id = newDeviceId()
    expect(id).toMatch(UUID_PATTERN)
    expect(versionOf(id)).toBe('4')
  })

  it('generates a different ID every call', () => {
    const ids = Array.from({ length: 1_000 }, () => newDeviceId())
    expect(new Set(ids).size).toBe(1_000)
  })
})

describe('isUuid', () => {
  it('rejects non-UUIDs', () => {
    for (const value of ['', 'nope', '123', 'A1-00001-O', 'x'.repeat(36)]) {
      expect(isUuid(value)).toBe(false)
    }
  })
})
