import { describe, expect, it } from 'vitest'
import { EVENT_CONFIG, stationFor } from './event'

describe('event configuration', () => {
  it('describes the V1 A1 -> B1 setup', () => {
    expect(EVENT_CONFIG.registrationStation.stationId).toBe('A1')
    expect(EVENT_CONFIG.feedbackStation.stationId).toBe('B1')
  })

  it('gives each station a distinct device identity', () => {
    expect(EVENT_CONFIG.registrationStation.deviceId).not.toBe(
      EVENT_CONFIG.feedbackStation.deviceId,
    )
  })

  it('uses an ISO calendar date for the event day', () => {
    expect(EVENT_CONFIG.eventDay).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('resolves a station per role', () => {
    expect(stationFor('registration')).toBe(EVENT_CONFIG.registrationStation)
    expect(stationFor('feedback')).toBe(EVENT_CONFIG.feedbackStation)
  })
})
