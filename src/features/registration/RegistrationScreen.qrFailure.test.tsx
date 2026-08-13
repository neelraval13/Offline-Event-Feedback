import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/*
 * The one failure that is easy to get wrong: the registration committed, and
 * then the sticker failed to render.
 *
 * The participant is registered. Telling staff to "try again" here would create
 * a second record, a second participant ID and a second public code for one
 * human being — and the first, unprinted identity would linger in the database
 * forever. So this file exists to hold the QR renderer at gunpoint and check
 * the screen says the right thing.
 */
vi.mock('../../lib/qr/qrCode', () => ({
  renderQrSvg: vi.fn(),
  QR_ERROR_CORRECTION_LEVEL: 'M',
  QR_QUIET_ZONE_MODULES: 4,
}))

const { RegistrationScreen } = await import('./RegistrationScreen')
const { renderQrSvg } = await import('../../lib/qr/qrCode')
const { db } = await import('../../lib/storage')
const { countRegistrations, listRecentRegistrations } = await import(
  '../../lib/storage/registrations'
)

const renderQrSvgMock = vi.mocked(renderQrSvg)

const PARTICIPANT = {
  name: 'Ada Lovelace',
  phone: '+44 20 7946 0958',
  email: 'ada@example.com',
}

beforeEach(async () => {
  await db.open()
  await Promise.all([db.registrations.clear(), db.sequences.clear()])
  window.print = vi.fn()
  renderQrSvgMock.mockReset()
})

afterEach(() => {
  cleanup()
})

async function submitParticipant() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Name'), PARTICIPANT.name)
  await user.type(screen.getByLabelText('Phone number'), PARTICIPANT.phone)
  await user.type(screen.getByLabelText('Email address'), PARTICIPANT.email)
  await user.click(screen.getByRole('button', { name: 'Register & Print' }))
  return user
}

describe('QR rendering fails after the registration is saved', () => {
  it('keeps the registration and says so explicitly', async () => {
    renderQrSvgMock.mockRejectedValue(new Error('canvas unavailable'))

    render(<RegistrationScreen />)
    await submitParticipant()

    expect(
      await screen.findByText(/The registration is saved/),
    ).toBeDefined()
    expect(await countRegistrations(db)).toBe(1)
  })

  it('tells staff not to register the participant again', async () => {
    renderQrSvgMock.mockRejectedValue(new Error('canvas unavailable'))

    render(<RegistrationScreen />)
    await submitParticipant()

    const alert = await screen.findByText(/The registration is saved/)
    expect(alert.textContent).toMatch(/do\s+not\s+register/i)
  })

  it('still shows the public code so the sticker can be recovered', async () => {
    renderQrSvgMock.mockRejectedValue(new Error('canvas unavailable'))

    render(<RegistrationScreen />)
    await submitParticipant()
    await screen.findByText(/The registration is saved/)

    const record = (await listRecentRegistrations(db, 1))[0]
    expect(screen.getByTestId('saved-public-code').textContent).toBe(
      record?.publicCode,
    )
  })

  it('produces no printable sticker and cannot print', async () => {
    renderQrSvgMock.mockRejectedValue(new Error('canvas unavailable'))

    render(<RegistrationScreen />)
    await submitParticipant()
    await screen.findByText(/The registration is saved/)

    expect(screen.queryByTestId('sticker')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Print sticker' }),
    ).toHaveProperty('disabled', true)
    expect(window.print).not.toHaveBeenCalled()
  })

  it('recovers on retry without creating a second registration', async () => {
    renderQrSvgMock.mockRejectedValueOnce(new Error('canvas unavailable'))
    renderQrSvgMock.mockResolvedValue('<svg data-testid="fake-qr"></svg>')

    render(<RegistrationScreen />)
    const user = await submitParticipant()
    await screen.findByText(/The registration is saved/)

    const before = (await listRecentRegistrations(db, 5))[0]
    await user.click(screen.getByRole('button', { name: 'Retry sticker' }))

    const sticker = await screen.findByTestId('sticker')
    expect(sticker.textContent).toContain(before?.publicCode)

    const after = await listRecentRegistrations(db, 5)
    expect(after).toHaveLength(1)
    expect(after[0]).toEqual(before)
  })

  it('renders the retried sticker from the same saved payload', async () => {
    renderQrSvgMock.mockRejectedValueOnce(new Error('canvas unavailable'))
    renderQrSvgMock.mockResolvedValue('<svg data-testid="fake-qr"></svg>')

    render(<RegistrationScreen />)
    const user = await submitParticipant()
    await screen.findByText(/The registration is saved/)
    await user.click(screen.getByRole('button', { name: 'Retry sticker' }))
    await screen.findByTestId('sticker')

    const record = (await listRecentRegistrations(db, 1))[0]
    const [firstPayload] = renderQrSvgMock.mock.calls[0] ?? []
    const [retryPayload] = renderQrSvgMock.mock.calls[1] ?? []

    // The retry encodes exactly what the first attempt would have, because both
    // read the same committed record.
    expect(retryPayload).toBe(firstPayload)
    expect(retryPayload).toContain(record?.participantId)
    expect(retryPayload).toContain(record?.publicCode)
    expect(retryPayload).not.toContain(PARTICIPANT.name)
    expect(retryPayload).not.toContain(PARTICIPANT.email)
  })
})
