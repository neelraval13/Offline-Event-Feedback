import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fillCampaignRegistration } from '../campaign/flying-flea/testSupport'
import { db } from '../../lib/storage'
import { countRegistrations } from '../../lib/storage/registrations'

/*
 * The two failures, told apart.
 *
 * A registration becomes durable in IndexedDB before a sticker is rendered, and
 * nothing that happens afterwards can invalidate it. So Point A has two
 * failures that look superficially alike and mean opposite things:
 *
 *   the save failed      the rider does not exist. Register them.
 *   the sticker failed   the rider exists. Do NOT register them again.
 *
 * V1 rendered both with the same red `notice--error`, and the only thing
 * separating "we lost the rider" from "print it again" was the sentence inside.
 * These tests hold the V2 distinction down as *structure*, not wording: the
 * saved state has a green band and a public code in it and the failed state has
 * neither, so the two are told apart from across a desk before a word is read.
 */

const { renderQrSvgMock } = vi.hoisted(() => ({ renderQrSvgMock: vi.fn() }))

vi.mock('../../lib/qr/qrCode', async () => {
  const actual = await vi.importActual<typeof import('../../lib/qr/qrCode')>(
    '../../lib/qr/qrCode',
  )
  return { ...actual, renderQrSvg: renderQrSvgMock }
})

const { RegistrationScreen } = await import('./RegistrationScreen')
const actualQr = await vi.importActual<typeof import('../../lib/qr/qrCode')>(
  '../../lib/qr/qrCode',
)

beforeEach(async () => {
  await db.open()
  await Promise.all([
    db.registrations.clear(),
    db.feedback.clear(),
    db.sequences.clear(),
  ])
  window.print = vi.fn()
  renderQrSvgMock.mockImplementation(actualQr.renderQrSvg)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function submitRider() {
  const user = userEvent.setup()
  await fillCampaignRegistration(user, {
    name: 'Ada Lovelace',
    phone: '9876543210',
    email: 'ada@example.com',
  })
  await user.click(screen.getByRole('button', { name: 'Register & Print' }))
  return user
}

/** The reassurance that must survive every sticker problem. */
function savedBanner(): HTMLElement | null {
  return screen.queryByText(/This rider is in the system on this device/)
}

describe('the sticker failed, and the rider did not', () => {
  beforeEach(() => {
    renderQrSvgMock.mockRejectedValue(new Error('canvas unavailable'))
  })

  it('keeps Registration saved green and dominant', async () => {
    render(<RegistrationScreen />)
    await submitRider()

    const banner = await waitFor(() => {
      const found = savedBanner()
      expect(found).not.toBeNull()
      return found as HTMLElement
    })

    // The tone comes from the alert around it, and it is the healthy one.
    const alert = banner.closest('[data-slot="alert"]') as HTMLElement
    expect(alert.className).toContain('bg-ok-soft')
    expect(alert.className).not.toContain('danger')
    expect(within(alert).getByText('Registration saved')).toBeDefined()
  })

  it('reports the sticker in amber, never in red', async () => {
    /*
     * Red is reserved for the one state where something was actually lost. A
     * sticker that failed to render is recoverable in one tap, and telling an
     * operator otherwise several times a day is how they learn to ignore red.
     */
    render(<RegistrationScreen />)
    await submitRider()

    const problem = await screen.findByText(/Sticker unavailable/)
    const alert = problem.closest('[data-slot="alert"]') as HTMLElement

    expect(alert.className).toContain('bg-warn-soft')
    expect(alert.className).not.toContain('bg-danger-soft')
  })

  it('makes Retry sticker the obvious action', async () => {
    render(<RegistrationScreen />)
    await submitRider()
    await screen.findByText(/Sticker unavailable/)

    const retry = screen.getByRole('button', { name: 'Retry sticker' })
    expect(retry.className).toContain('bg-interactive')
  })

  it('keeps Next rider and Correct details available', async () => {
    render(<RegistrationScreen />)
    await submitRider()
    await screen.findByText(/Sticker unavailable/)

    expect(screen.getByRole('button', { name: 'Next rider' })).toHaveProperty(
      'disabled',
      false,
    )
    expect(
      screen.getByRole('button', { name: 'Correct details' }),
    ).toHaveProperty('disabled', false)
  })

  it('still shows the public code, so the label can be recovered later', async () => {
    render(<RegistrationScreen />)
    await submitRider()
    await screen.findByText(/Sticker unavailable/)

    expect(screen.getByTestId('saved-public-code').textContent).toMatch(
      /^A1-[0-9A-F]{6}-\d{5}-[0-9A-Z]$/,
    )
  })
})

describe('the save failed, so there is no rider', () => {
  beforeEach(() => {
    vi.spyOn(db.registrations, 'add').mockRejectedValue(
      new Error('QuotaExceededError'),
    )
  })

  it('is the one state that gets the destructive treatment', async () => {
    render(<RegistrationScreen />)
    await submitRider()

    const problem = await screen.findByText(/Registration not saved/)
    const alert = problem.closest('[data-slot="alert"]') as HTMLElement

    expect(alert.className).toContain('bg-danger-soft')
  })

  it('shows none of the things a saved rider has', async () => {
    /*
     * The structural half of the distinction, and the half an operator reads
     * first: no green band, no public code, no sticker area at all.
     */
    render(<RegistrationScreen />)
    await submitRider()
    await screen.findByText(/Registration not saved/)

    expect(savedBanner()).toBeNull()
    expect(screen.queryByTestId('saved-public-code')).toBeNull()
    expect(screen.queryByTestId('sticker')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Print sticker' })).toBeNull()
    expect(await countRegistrations(db)).toBe(0)
  })

  it('says the rider is not registered, and that the entries survived', async () => {
    render(<RegistrationScreen />)
    await submitRider()

    const problem = await screen.findByText(/Registration not saved/)
    const alert = problem.closest('[data-slot="alert"]') as HTMLElement

    expect(alert.textContent).toMatch(/not\s+registered/i)
    expect(alert.textContent).toMatch(/still here/i)
  })

  it('leaves every value the operator typed in place', async () => {
    render(<RegistrationScreen />)
    await submitRider()
    await screen.findByText(/Registration not saved/)

    expect(screen.getByLabelText(/^Name/)).toHaveProperty(
      'value',
      'Ada Lovelace',
    )
    expect(screen.getByLabelText(/^Email ID/)).toHaveProperty(
      'value',
      'ada@example.com',
    )
    expect(screen.getByLabelText(/^Phone Number/)).toHaveProperty(
      'value',
      '9876543210',
    )
    expect(
      screen.getByRole('button', { name: 'Vehicle 1' }).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true')
  })
})

describe('the correction sheet', () => {
  it('opens over the saved rider and closes again', async () => {
    render(<RegistrationScreen />)
    const user = await submitRider()
    await screen.findByTestId('sticker')

    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Correct details' }))
    const sheet = await screen.findByRole('dialog', {
      name: 'Correct rider details',
    })

    // The rider being edited is named by their code, inside the sheet.
    expect(sheet.textContent).toContain(
      screen.getByTestId('saved-public-code').textContent,
    )

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('says what it is, and what it is not', async () => {
    render(<RegistrationScreen />)
    const user = await submitRider()
    await screen.findByTestId('sticker')
    await user.click(screen.getByRole('button', { name: 'Correct details' }))

    const sheet = await screen.findByRole('dialog')
    expect(sheet.textContent).toMatch(/already registered/i)
    expect(sheet.textContent).toMatch(/does not create a second registration/i)
    // The reason a corrected rider does not need a new label.
    expect(sheet.textContent).toMatch(/does not need reprinting/i)
  })

  it('is the only form on the page while it is open', async () => {
    /*
     * V1 toggled a second copy of the registration form open below the saved
     * panel, directly under the one the operator had just used. That is the
     * confusion this screen exists to prevent.
     */
    render(<RegistrationScreen />)
    const user = await submitRider()
    await screen.findByTestId('sticker')
    await user.click(screen.getByRole('button', { name: 'Correct details' }))

    await screen.findByRole('dialog')
    expect(document.querySelectorAll('form')).toHaveLength(1)
    expect(
      screen.queryByRole('button', { name: 'Register & Print' }),
    ).toBeNull()
  })
})
