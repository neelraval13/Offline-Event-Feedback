import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { HomeScreen } from './HomeScreen'

/*
 * The station menu.
 *
 * Nothing here tests how it looks; jsdom lays nothing out. What it tests is the
 * structure the screen depends on, and that regressed once before: four
 * destinations in one list rather than three plus a second section, the event
 * stated once rather than in a badge and again in a paragraph, and four links
 * that are still links.
 */

afterEach(cleanup)

const DESTINATIONS = [
  {
    title: 'Point A',
    role: 'Registration',
    href: '#/a',
    description: 'Register riders and print their QR sticker.',
  },
  {
    title: 'Point B',
    role: 'Feedback',
    href: '#/b',
    description: 'Capture test ride feedback by QR, code or rider details.',
  },
  {
    title: 'Device Admin',
    role: 'Device operations',
    href: '#/admin',
    description: 'Check offline readiness, local data, sync and backups.',
  },
  {
    title: 'Central Reporting',
    role: 'Event reporting',
    href: '#/reporting',
    description: 'Review the central event record, reconciliation and exports.',
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

  it('states the venue once', () => {
    /*
     * The venue used to appear in a brand badge and again in a paragraph below
     * the title. `getAllByText` is the assertion: one occurrence, not two.
     */
    render(<HomeScreen />)

    expect(screen.getAllByText('Richardson & Cruddas')).toHaveLength(1)
  })

  it('shows the day as a date, not as a sentence about the event', () => {
    render(<HomeScreen />)

    // The old paragraph carried the event name and an ISO day. Both are noise
    // on a menu: the name is in the shell, and the day reads better.
    expect(screen.queryByText(/Offline-first/)).toBeNull()
    expect(screen.queryByText(/2026-08-23/)).toBeNull()
  })

  it('draws no second brand header under the shell', () => {
    /*
     * The V2 shell carries the parachute, the product name, the event and the
     * day. Home drawing its own topbar underneath was two headers where the
     * screen needed one.
     */
    const { container } = render(<HomeScreen />)

    expect(container.querySelector('.ff-topbar')).toBeNull()
  })

  it('reports no readiness of its own', () => {
    /*
     * The shell already says whether this device is prepared to work offline,
     * from the one source that knows. A second answer on Home could disagree
     * with it, and an operator would have no way to tell which was right.
     *
     * Asserted as the absence of status *semantics* rather than of the word:
     * "Check offline readiness" is Device Admin's job description, which is
     * exactly the kind of copy a word ban would have forced out of the one
     * place it belongs.
     */
    const { container } = render(<HomeScreen />)

    expect(screen.queryByRole('status')).toBeNull()
    expect(container.querySelector('[aria-live]')).toBeNull()
    expect(container.querySelector('[data-slot="badge"]')).toBeNull()
    // No claim about this device, only descriptions of where to go.
    expect(container.textContent).not.toContain('Offline ready')
    expect(container.textContent).not.toContain('Ready for offline use')
  })
})

describe('the destinations', () => {
  it('offers all four in one list', () => {
    render(<HomeScreen />)

    const lists = screen.getAllByRole('list')
    expect(lists).toHaveLength(1)
    expect(within(lists[0] as HTMLElement).getAllByRole('link')).toHaveLength(4)
  })

  it.each(DESTINATIONS)(
    'links to $title',
    ({ title, role, href, description }) => {
      render(<HomeScreen />)

      const link = screen.getByRole('link', { name: new RegExp(title) })
      expect(link.getAttribute('href')).toBe(href)
      // The name, the job and the sentence are all part of the one target.
      expect(within(link).getByText(title)).toBeDefined()
      expect(within(link).getByText(role)).toBeDefined()
      expect(within(link).getByText(description)).toBeDefined()
    },
  )

  it('gives every destination the same structure', () => {
    /*
     * Device Admin and Central Reporting are not made secondary because they
     * are operational tools. One shape, four times.
     */
    render(<HomeScreen />)

    const cards = document.querySelectorAll('[data-home-destination]')
    expect(cards).toHaveLength(4)

    for (const card of cards) {
      expect(card.tagName).toBe('A')
      expect(card.getAttribute('href')).toMatch(/^#\//)
      // The whole surface is the link: no nested control to miss or to stop at.
      expect(card.querySelector('button')).toBeNull()
      expect(card.querySelector('a')).toBeNull()
    }
  })

  it('carries the reporting requirement inside its own destination', () => {
    render(<HomeScreen />)

    const reporting = screen.getByRole('link', { name: /Central Reporting/ })
    expect(within(reporting).getByText('Requires reporting access.')).toBeDefined()

    // Exactly one destination carries a note; it is not a general subtitle.
    expect(document.querySelectorAll('[data-home-note]')).toHaveLength(1)
  })

  it('has no second heading repeating a destination title', () => {
    // "Central reporting" used to be a heading above a one-card grid, directly
    // above a card called "Central Reporting".
    render(<HomeScreen />)

    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: /reporting/i })).toBeNull()
  })

  it('shows no participant data', () => {
    /*
     * Home is the first thing a device displays, often on a stand where anyone
     * can read it. Every record this product holds is one deliberate click
     * away, on a screen built to show it.
     */
    const { container } = render(<HomeScreen />)

    for (const forbidden of ['@', 'Recent', 'Last registered', 'Latest feedback']) {
      expect(container.textContent).not.toContain(forbidden)
    }
  })

  it('offers no route that is not one of the four stations', () => {
    render(<HomeScreen />)

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(hrefs.sort()).toEqual(['#/a', '#/admin', '#/b', '#/reporting'])
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

  it('names each destination usefully to a screen reader', () => {
    render(<HomeScreen />)

    for (const { title, role } of DESTINATIONS) {
      const link = screen.getByRole('link', { name: new RegExp(title) })
      // The accessible name carries the job, not just the station letter:
      // "Point A" alone tells a first-day volunteer nothing.
      expect(link.textContent).toContain(role)
    }
  })
})
