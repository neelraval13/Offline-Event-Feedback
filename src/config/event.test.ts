import { describe, expect, it } from 'vitest'
import { EVENT_CONFIG, stationFor } from './event'

describe('event configuration', () => {
  it('describes the V1 A1 -> B1 setup', () => {
    expect(EVENT_CONFIG.registrationStation.stationId).toBe('A1')
    expect(EVENT_CONFIG.feedbackStation.stationId).toBe('B1')
  })

  it('uses an ISO calendar date for the event day', () => {
    expect(EVENT_CONFIG.eventDay).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('the real event this build is for', () => {
  /*
   * These three values are stamped onto every record the moment it is written,
   * they travel on the wire, and reconciliation groups by them. A build that
   * reached a desk still carrying the development placeholders would label a
   * whole day of real registrations as a development event, and afterwards
   * nothing downstream could tell which was which.
   */

  it('runs on the day of the Flying Flea test rides', () => {
    expect(EVENT_CONFIG.eventDay).toBe('2026-08-23')
  })

  it('is named for the campaign and the venue', () => {
    expect(EVENT_CONFIG.eventName).toBe(
      'Flying Flea Test Ride - Richardson & Cruddas',
    )
  })

  it('is not the development placeholder', () => {
    expect(EVENT_CONFIG.eventId).not.toBe('evt-dev-001')
    expect(EVENT_CONFIG.eventName).not.toBe('Development Event')
    expect(EVENT_CONFIG.eventDay).not.toBe('2026-01-01')
  })

  it('carries an ID every consumer of it accepts', () => {
    /*
     * The event ID is not merely a label. It is a wire `identifier` (1 to 128
     * characters), a Postgres key, part of an export filename, and it is
     * encoded verbatim into every QR sticker. Restricting it to lowercase
     * alphanumerics and hyphens means it survives all four without being
     * escaped, sanitised or quoted anywhere.
     */
    expect(EVENT_CONFIG.eventId).toMatch(/^[a-z0-9-]+$/)
    expect(EVENT_CONFIG.eventId.length).toBeLessThanOrEqual(128)

    // The export filename sanitiser must have nothing to replace.
    expect(EVENT_CONFIG.eventId.replace(/[^a-zA-Z0-9._-]/g, '_')).toBe(
      EVENT_CONFIG.eventId,
    )
  })

  it('abbreviates the campaign and the venue, and spells out the day', () => {
    // Stable: derived from facts about the event that cannot change, rather
    // than generated. `ff` is the campaign and `rc` is the venue; the day is
    // written in full because it is the part that distinguishes one run of this
    // campaign from the next.
    expect(EVENT_CONFIG.eventId).toBe('ff-rc-2026-08-23')
    expect(EVENT_CONFIG.eventId).toContain(EVENT_CONFIG.eventDay)
  })

  it('stays short, because every character is printed on every sticker', () => {
    /*
     * The ID is encoded verbatim into the QR payload. Spelling the venue out
     * (`flying-flea-richardson-cruddas-2026-08-23`) took the payload from 114
     * bytes to 139 and every symbol from 45 modules to 49 inside the same 26 mm,
     * for information no scanner reads. The full names live in `eventName` and
     * `lockedLocation`, neither of which is printed.
     *
     * 24 characters is the budget that keeps the payload under 124 bytes, which
     * is where the symbol would grow again.
     */
    expect(EVENT_CONFIG.eventId.length).toBeLessThanOrEqual(24)
    expect(EVENT_CONFIG.eventId).not.toContain('richardson')
  })
})

describe('stations', () => {
  it('resolves a station per role', () => {
    expect(stationFor('registration')).toBe(EVENT_CONFIG.registrationStation)
    expect(stationFor('feedback')).toBe(EVENT_CONFIG.feedbackStation)
  })

  it('does not carry a hardcoded device identity', () => {
    // Device identity belongs to the browser installation, not to config.
    expect(EVENT_CONFIG.registrationStation).not.toHaveProperty('deviceId')
    expect(EVENT_CONFIG.feedbackStation).not.toHaveProperty('deviceId')
  })
})
