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
})
