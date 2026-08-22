import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { EVENT_CONFIG } from '../../../../config/event'
import { FLYING_FLEA_CAMPAIGN } from '../config'
import { EventMeta } from './EventMeta'

/*
 * Where and when, stated once.
 *
 * These used to be two form fields. Removing a control is only half the change:
 * the operator still has to be able to see, without asking anyone, which venue
 * and which day this device is stamping onto every record it writes. That is
 * what this component is for, and why the assertions below are about it being
 * visible rather than about it being correct in isolation.
 */

afterEach(cleanup)

describe('the event metadata', () => {
  it('names the venue', () => {
    render(<EventMeta />)

    expect(screen.getByText('Richardson & Cruddas')).toBeDefined()
  })

  it('writes the day the way a person reads it, not as an ISO string', () => {
    render(<EventMeta />)

    expect(screen.getByText('23 August 2026')).toBeDefined()
    expect(screen.queryByText('2026-08-23')).toBeNull()
  })

  it('shows the venue and day the records actually carry', () => {
    /*
     * Not a second source of truth: the venue here is the one stamped onto
     * every registration, and the day is the one stamped onto every record at
     * either station. A caption that drifted from the data would be worse than
     * no caption.
     */
    render(<EventMeta />)

    expect(
      screen.getByText(FLYING_FLEA_CAMPAIGN.lockedLocation),
    ).toBeDefined()
    expect(EVENT_CONFIG.eventDay).toBe('2026-08-23')
  })

  it('is a caption, not a control', () => {
    render(<EventMeta />)

    expect(document.querySelectorAll('input, select, button')).toHaveLength(0)
  })
})

/*
 * The hero both stations used to share is gone.
 *
 * `CampaignHeroHeader` carried the venue and the day above a 300px photograph
 * at the top of both capture screens, and V2 replaced it on each with a two-line
 * station header. The guarantee it existed for, that Point A and Point B cannot
 * disagree about where they are, did not go with it: it is now asserted against
 * the real screens rather than against a shared component, by
 * `RegistrationScreen.test.tsx` ("states both above the form instead of asking
 * for them") and `FeedbackScreen.test.tsx` ("names the venue and the day, as
 * Point A does"). Testing the screens is the stronger version of the same
 * check, because a screen can drop a header and a component cannot.
 */
