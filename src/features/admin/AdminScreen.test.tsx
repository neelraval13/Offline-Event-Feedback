import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AdminScreen } from './AdminScreen'
import { db } from '../../lib/storage/db'
import { peekDeviceId } from '../../lib/storage/deviceIdentity'

afterEach(cleanup)

describe('AdminScreen diagnostics', () => {
  it('provisions and displays the device identity', async () => {
    render(<AdminScreen />)

    const value = await screen.findByText(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )

    // What is shown is what was persisted, not a value invented for display.
    expect(await peekDeviceId(db)).toBe(value.textContent)
  })

  it('reports the local database as ready', async () => {
    render(<AdminScreen />)

    expect(
      await screen.findByText(/offline-event-feedback v1: ready/),
    ).toBeDefined()
  })

  it('shows no participant PII', async () => {
    const { container } = render(<AdminScreen />)
    await screen.findByText(/ready/)

    for (const label of ['Name', 'Phone', 'Email', 'Participant']) {
      expect(container.textContent).not.toContain(label)
    }
  })

  it('does not claim reconciliation or reporting are unbuilt', async () => {
    /*
     * This screen carried a "Not implemented yet" list naming reconciliation
     * and central reporting long after both shipped and were run against a real
     * event. Stale copy on an operator screen is worse than no copy: it is the
     * one place a member of staff would look to find out whether a feature
     * exists, and it told them it did not.
     */
    const { container } = render(<AdminScreen />)
    await screen.findByText(/ready/)

    expect(container.textContent).not.toContain('Not implemented yet')
    expect(container.textContent).not.toContain('Reconciliation of conflicting')
    expect(container.textContent).not.toContain('Central reporting')
    // And nothing took its place.
    expect(container.textContent).not.toContain('Coming soon')
  })
})
