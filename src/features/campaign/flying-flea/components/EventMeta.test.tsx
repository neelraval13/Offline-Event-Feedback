import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { EVENT_CONFIG } from '../../../../config/event'
import { CampaignHeroHeader } from './CampaignHeroHeader'
import { ALL_EVENT_LOCATIONS_LABEL, EventMeta } from './EventMeta'

/*
 * Where and when, stated once.
 *
 * The date used to be a form field. Removing a control is only half the change:
 * the operator still has to be able to see, without asking anyone, which day
 * this device is stamping onto every record it writes. That is what this
 * component is for, and why the assertions below are about it being visible
 * rather than about it being correct in isolation.
 *
 * The venue half changed meaning for the September event. There is no longer
 * one venue to state: the event runs in Bengaluru and Hyderabad on the same
 * day, so this caption reports what THIS DEVICE is set to, and names both
 * cities only where no device setting applies.
 */

afterEach(cleanup)

describe('the event metadata', () => {
  it('names the city this device is recording', () => {
    render(<EventMeta location="Hyderabad" />)

    expect(screen.getByTestId('event-meta-venue').textContent).toBe('Hyderabad')
  })

  it('names both cities when no device setting applies', () => {
    /*
     * The home screen is not a station and records nothing, so there is no
     * "current" city to report. Naming one of them there would be a claim about
     * a device that has not been pointed at a desk yet.
     */
    render(<EventMeta />)

    expect(screen.getByTestId('event-meta-venue').textContent).toBe(
      'Bengaluru / Hyderabad',
    )
    expect(ALL_EVENT_LOCATIONS_LABEL).toBe('Bengaluru / Hyderabad')
  })

  it('never claims one locked venue for a two-city event', () => {
    /*
     * The regression this exists for. Until September this caption printed a
     * single compiled venue, and on a two-city event that wording is not stale,
     * it is false on half the devices at the event.
     */
    render(<EventMeta />)

    expect(screen.queryByText('Richardson & Cruddas')).toBeNull()
  })

  it('writes the day the way a person reads it, not as an ISO string', () => {
    render(<EventMeta location="Bengaluru" />)

    expect(screen.getByText('20 September 2026')).toBeDefined()
    expect(screen.queryByText('2026-09-20')).toBeNull()
  })

  it('shows the day the records actually carry', () => {
    /*
     * Not a second source of truth: the day is the one stamped onto every
     * record at either station. A caption that drifted from the data would be
     * worse than no caption.
     */
    render(<EventMeta location="Bengaluru" />)

    expect(EVENT_CONFIG.eventDay).toBe('2026-09-20')
    expect(screen.getByText('20 September 2026')).toBeDefined()
  })

  it('is a caption, not a control', () => {
    /*
     * Still true, and still the point. The city IS selectable now, but not
     * here: the selector is a separate control on each station. This line is a
     * statement of what the device is doing, which is what makes a wrongly-set
     * tablet noticeable to somebody who is not looking for it.
     */
    render(<EventMeta location="Bengaluru" />)

    expect(document.querySelectorAll('input, select, button')).toHaveLength(0)
  })
})

describe('the hero both stations share', () => {
  /*
   * One component, so Point A and Point B cannot disagree about where they are.
   * Point B's operator scans stickers all day and never sees the registration
   * form; they need the same confirmation.
   */

  it('carries the device city and the day at Point A', () => {
    render(
      <CampaignHeroHeader
        lead="Test Ride"
        accent="Registration"
        subtitle="Point A · A1"
        location="Bengaluru"
      />,
    )

    expect(screen.getByText('Bengaluru')).toBeDefined()
    expect(screen.getByText('20 September 2026')).toBeDefined()
  })

  it('carries the device city and the day at Point B', () => {
    render(
      <CampaignHeroHeader
        lead="Test Ride"
        accent="Feedback"
        subtitle="Point B · B1"
        location="Hyderabad"
      />,
    )

    expect(screen.getByText('Hyderabad')).toBeDefined()
    expect(screen.getByText('20 September 2026')).toBeDefined()
  })

  it('states the city once, not once in the topbar and once below it', () => {
    render(
      <CampaignHeroHeader
        lead="Test Ride"
        accent="Registration"
        subtitle="Point A · A1"
        location="Bengaluru"
      />,
    )

    // `getByText` throws on a second match, so this is the assertion. It is
    // what stops a station from rendering its own city line beside the hero's.
    expect(screen.getAllByText('Bengaluru')).toHaveLength(1)
  })

  it('falls back to both cities when a station passes none', () => {
    render(
      <CampaignHeroHeader
        lead="Test Ride"
        accent="Registration"
        subtitle="Point A · A1"
      />,
    )

    expect(screen.getByText('Bengaluru / Hyderabad')).toBeDefined()
  })
})
