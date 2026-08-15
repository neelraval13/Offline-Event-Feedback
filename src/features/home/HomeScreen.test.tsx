import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { HomeScreen } from './HomeScreen'

/*
 * The station menu.
 *
 * Nothing here tests how it looks; jsdom lays nothing out. What it tests is the
 * structure that the visual cleanup depends on, and that regressed once before:
 * four destinations in one list rather than three plus a second section, the
 * event stated once rather than in a badge and again in a paragraph, and four
 * links that are still links.
 */

afterEach(cleanup)

const DESTINATIONS = [
  {
    title: 'Point A: Registration',
    href: '#/a',
    description: 'Register a rider and print the QR sticker.',
  },
  {
    title: 'Point B: Feedback',
    href: '#/b',
    description: 'Scan the sticker or enter the code to collect feedback.',
  },
  {
    title: 'Device Admin',
    href: '#/admin',
    description: 'View local records, export backups and check this device.',
  },
  {
    title: 'Central Reporting',
    href: '#/reporting',
    description: 'Review and export reconciled central data.',
  },
] as const

describe('the identity block', () => {
  it('names the campaign, the screen and the day, once each', () => {
    render(<HomeScreen />)

    expect(screen.getByText('Flying Flea · Test Rides')).toBeDefined()
    expect(
      screen.getByRole('heading', { level: 1, name: /Test Ride Stations/ }),
    ).toBeDefined()
    expect(screen.getByText('23 August 2026')).toBeDefined()
    expect(screen.getByText('Choose a station to begin.')).toBeDefined()
  })

  it('states the venue in the badge and nowhere else', () => {
    /*
     * The venue used to appear in the badge and again in a paragraph below the
     * title. `getAllByText` is the assertion: one occurrence, not two.
     */
    render(<HomeScreen />)

    expect(screen.getAllByText('Richardson & Cruddas')).toHaveLength(1)
  })

  it('shows the day as a date, not as a sentence about the event', () => {
    render(<HomeScreen />)

    // The old paragraph carried the event name and an ISO day. Both are noise
    // on a menu: the name is in the badge and the marks, the day reads better.
    expect(screen.queryByText(/Offline-first/)).toBeNull()
    expect(screen.queryByText(/2026-08-23/)).toBeNull()
  })
})

describe('the action grid', () => {
  it('offers all four destinations in one list', () => {
    render(<HomeScreen />)

    const lists = screen.getAllByRole('list')
    expect(lists).toHaveLength(1)
    expect(within(lists[0] as HTMLElement).getAllByRole('link')).toHaveLength(4)
  })

  it.each(DESTINATIONS)('links to $title', ({ title, href, description }) => {
    render(<HomeScreen />)

    const link = screen.getByRole('link', { name: new RegExp(title) })
    expect(link.getAttribute('href')).toBe(href)
    expect(within(link).getByText(description)).toBeDefined()
  })

  it('gives every card the same structure', () => {
    /*
     * Device Admin and Central Reporting are not made secondary because they
     * are operational tools. One class, one shape, four times.
     */
    render(<HomeScreen />)

    const cards = document.querySelectorAll('.ff-home__link')
    expect(cards).toHaveLength(4)

    for (const card of cards) {
      expect(card.tagName).toBe('A')
      expect(card.querySelectorAll('.ff-home__title')).toHaveLength(1)
      expect(card.querySelectorAll('.ff-home__desc')).toHaveLength(1)
    }
  })

  it('carries the reporting requirement inside its own card', () => {
    render(<HomeScreen />)

    const reporting = screen.getByRole('link', { name: /Central Reporting/ })
    expect(within(reporting).getByText('Requires reporting access.')).toBeDefined()

    // Exactly one card carries a note; it is not a general-purpose subtitle.
    expect(document.querySelectorAll('.ff-home__note')).toHaveLength(1)
  })

  it('has no second heading repeating a card title', () => {
    // "Central reporting" used to be a heading above a one-card grid, directly
    // above a card called "Central Reporting".
    render(<HomeScreen />)

    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: /reporting/i })).toBeNull()
  })
})

describe('reaching a station without a pointer', () => {
  it('keeps every destination a real link', () => {
    /*
     * Not a div with a click handler: a link is what Tab reaches, what Enter
     * follows, what a screen reader announces as a destination, and what a
     * middle click opens.
     */
    render(<HomeScreen />)

    for (const link of screen.getAllByRole('link')) {
      expect(link.tagName).toBe('A')
      expect(link.getAttribute('href')).toMatch(/^#\//)
      expect(link.hasAttribute('tabindex')).toBe(false)
    }
  })
})
