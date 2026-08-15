import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { EVENT_CONFIG } from '../../../../config/event'
import { FLYING_FLEA_CAMPAIGN } from '../config'
import { CampaignHeroHeader } from './CampaignHeroHeader'
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

describe('the hero both stations share', () => {
  /*
   * One component, so Point A and Point B cannot disagree about where they are.
   * Point B's operator scans stickers all day and never sees the registration
   * form; they need the same confirmation.
   */

  it('carries the venue and the day at Point A', () => {
    render(
      <CampaignHeroHeader lead="Test Ride" accent="Registration" subtitle="Point A · A1" />,
    )

    expect(screen.getByText('Richardson & Cruddas')).toBeDefined()
    expect(screen.getByText('23 August 2026')).toBeDefined()
  })

  it('carries the venue and the day at Point B', () => {
    render(
      <CampaignHeroHeader lead="Test Ride" accent="Feedback" subtitle="Point B · B1" />,
    )

    expect(screen.getByText('Richardson & Cruddas')).toBeDefined()
    expect(screen.getByText('23 August 2026')).toBeDefined()
  })

  it('states the venue once, not once in the topbar and once below it', () => {
    render(
      <CampaignHeroHeader lead="Test Ride" accent="Registration" subtitle="Point A · A1" />,
    )

    // `getByText` throws on a second match, so this is the assertion.
    expect(screen.getAllByText('Richardson & Cruddas')).toHaveLength(1)
  })
})
