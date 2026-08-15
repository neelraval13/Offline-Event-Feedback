import { describe, expect, it } from 'vitest'
import { isUuid, parseCursor } from './postgres.js'

/*
 * The values that reach a `::uuid` or `::timestamptz` cast.
 *
 * Anything that fails to parse here would otherwise become a Postgres error and
 * a 500: the wrong answer to a malformed request, and a way to learn about the
 * schema by watching which inputs break it.
 */

function cursorOf(createdAt: string, recordId: string): string {
  return Buffer.from(`${createdAt}|${recordId}`, 'utf8').toString('base64url')
}

const RECORD_ID = '019ffc65-4559-7125-9453-de82fb849ed8'
const INSTANT = '2026-01-01T09:00:00.000Z'

describe('isUuid', () => {
  it('accepts the identifiers this schema actually holds', () => {
    // UUIDv7 for records and participants, UUIDv4 for devices.
    expect(isUuid(RECORD_ID)).toBe(true)
    expect(isUuid('11111111-2222-4333-8444-555555555555')).toBe(true)
    expect(isUuid(RECORD_ID.toUpperCase())).toBe(true)
  })

  it('rejects anything else', () => {
    for (const value of [
      '',
      'not-a-uuid',
      '12345',
      `${RECORD_ID}x`,
      RECORD_ID.replace('-', ''),
      "'; DROP TABLE registrations; --",
    ]) {
      expect(isUuid(value)).toBe(false)
    }
  })
})

describe('parseCursor', () => {
  it('round-trips a cursor of the shape the server issues', () => {
    expect(parseCursor(cursorOf(INSTANT, RECORD_ID))).toEqual({
      createdAt: INSTANT,
      recordId: RECORD_ID,
    })
  })

  it('rejects a cursor with no separator', () => {
    expect(parseCursor(Buffer.from('nonsense', 'utf8').toString('base64url'))).toBeNull()
  })

  it('rejects a cursor whose record id is not a uuid', () => {
    expect(parseCursor(cursorOf(INSTANT, 'not-a-uuid'))).toBeNull()
    expect(parseCursor(cursorOf(INSTANT, '1 OR 1=1'))).toBeNull()
  })

  it('rejects a cursor whose timestamp is not an ISO instant', () => {
    expect(parseCursor(cursorOf('not-a-date', RECORD_ID))).toBeNull()
    // Parseable by Date, but not the canonical form Postgres was handed. A
    // cursor is issued by this server; anything else was tampered with.
    expect(parseCursor(cursorOf('2026-01-01', RECORD_ID))).toBeNull()
    expect(parseCursor(cursorOf('2026-01-01T09:00:00Z', RECORD_ID))).toBeNull()
  })

  it('rejects a cursor that is not base64url at all', () => {
    // Buffer.from is famously lenient, so this asserts the outcome rather than
    // an exception: whatever it decodes to must not parse as a cursor.
    expect(parseCursor('not base64!!')).toBeNull()
    expect(parseCursor('')).toBeNull()
  })
})
