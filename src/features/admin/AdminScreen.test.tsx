import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminScreen } from './AdminScreen'
import { db } from '../../lib/storage/db'
import { peekDeviceId } from '../../lib/storage/deviceIdentity'

afterEach(cleanup)

/**
 * Opens the Device details disclosure.
 *
 * V2 puts the technical facts last and collapsed: they are for whoever an event
 * lead phones, not for the event lead, and V1 had the device UUID outranking
 * the one line that decides whether the device can be used. What they contain
 * once open is unchanged, which is what these tests assert.
 */
async function openDeviceDetails() {
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: /^Device details/ }),
  )
  return user
}

describe('AdminScreen diagnostics', () => {
  it('provisions and displays the device identity', async () => {
    render(<AdminScreen />)
    await openDeviceDetails()

    const value = await screen.findByText(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )

    // What is shown is what was persisted, not a value invented for display.
    expect(await peekDeviceId(db)).toBe(value.textContent)
  })

  it('reports the local database as ready', async () => {
    render(<AdminScreen />)
    await openDeviceDetails()

    expect(
      await screen.findByText(/offline-event-feedback v1: ready/),
    ).toBeDefined()
  })

  it('shows no participant PII', async () => {
    const { container } = render(<AdminScreen />)
    await openDeviceDetails()
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
    await openDeviceDetails()
    await screen.findByText(/ready/)

    expect(container.textContent).not.toContain('Not implemented yet')
    expect(container.textContent).not.toContain('Reconciliation of conflicting')
    expect(container.textContent).not.toContain('Central reporting')
    // And nothing took its place.
    expect(container.textContent).not.toContain('Coming soon')
  })
})
