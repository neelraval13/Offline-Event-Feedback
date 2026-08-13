import { describe, expect, it } from 'vitest'
import { recordContextFor } from './recordContext'
import { EVENT_CONFIG } from './event'
import { newDeviceId } from '../lib/identity/uuid'

describe('recordContextFor', () => {
  it('stamps Point A records with the registration station', () => {
    const deviceId = newDeviceId()

    expect(recordContextFor('registration', deviceId)).toEqual({
      eventId: EVENT_CONFIG.eventId,
      eventDay: EVENT_CONFIG.eventDay,
      stationId: 'A1',
      deviceId,
    })
  })

  it('stamps Point B records with the feedback station', () => {
    const deviceId = newDeviceId()

    expect(recordContextFor('feedback', deviceId)).toMatchObject({
      stationId: 'B1',
      deviceId,
    })
  })

  it('keeps one device identity across both stations', () => {
    // A browser visiting both routes in development is still one device; only
    // the station differs.
    const deviceId = newDeviceId()
    const a = recordContextFor('registration', deviceId)
    const b = recordContextFor('feedback', deviceId)

    expect(a.deviceId).toBe(b.deviceId)
    expect(a.stationId).not.toBe(b.stationId)
  })
})
