import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegistrationScreen } from './RegistrationScreen'
import { db } from '../../lib/storage'
import {
  countRegistrations,
  getRegistrationByRecordId,
  listRecentRegistrations,
} from '../../lib/storage/registrations'
import { OfflineEventDb } from '../../lib/storage/db'
import {
  qrPayloadForRegistration,
  serializeQrPayload,
} from '../../lib/identity/qrPayload'
import { renderQrSvg } from '../../lib/qr/qrCode'
import { readFileSync } from 'node:fs'
import type { RegistrationRecord } from '../../types'

/* Read from disk rather than imported: Vitest does not process CSS, so a
 * `?raw` import yields nothing. The stylesheet is where the sticker's layout
 * guarantees actually live, so it is what gets asserted. */
const stylesheet = readFileSync('src/styles.css', 'utf8')

/**
 * Parses SVG markup into the DOM and serialises it back, so a string produced
 * by the QR library can be compared with one read out of a rendered element.
 * The DOM writes `<path></path>` where the library writes `<path/>`; that
 * difference is not a difference in the symbol.
 */
function normalizeSvg(svg: string): string {
  const holder = document.createElement('div')
  holder.innerHTML = svg
  return holder.innerHTML
}

const PARTICIPANT = {
  name: 'Ada Lovelace',
  phone: '+44 20 7946 0958',
  email: 'ada@example.com',
}

beforeEach(async () => {
  await db.open()
  await Promise.all([
    db.registrations.clear(),
    db.feedback.clear(),
    db.sequences.clear(),
  ])
  window.print = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function fillForm(values = PARTICIPANT) {
  const user = userEvent.setup()
  await user.clear(screen.getByLabelText('Name'))
  await user.type(screen.getByLabelText('Name'), values.name)
  await user.type(screen.getByLabelText('Phone number'), values.phone)
  await user.type(screen.getByLabelText('Email address'), values.email)
  return user
}

async function registerParticipant(values = PARTICIPANT) {
  const user = await fillForm(values)
  await user.click(screen.getByRole('button', { name: 'Register & Print' }))
  await screen.findByTestId('sticker')
  return user
}

/** The single record the tests just created. */
async function onlyRecord(): Promise<RegistrationRecord> {
  const records = await listRecentRegistrations(db, 10)
  expect(records).toHaveLength(1)
  return records[0] as RegistrationRecord
}

describe('form behaviour', () => {
  it('focuses Name when the screen opens', async () => {
    render(<RegistrationScreen />)
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Name')),
    )
  })

  it('requires every field and writes nothing when they are missing', async () => {
    render(<RegistrationScreen />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Register & Print' }))

    expect(await screen.findAllByRole('alert')).toHaveLength(3)
    expect(screen.queryByTestId('sticker')).toBeNull()
    expect(await countRegistrations(db)).toBe(0)
  })

  it('rejects an invalid phone number without saving', async () => {
    render(<RegistrationScreen />)
    const user = await fillForm({ ...PARTICIPANT, phone: '12' })
    await user.click(screen.getByRole('button', { name: 'Register & Print' }))

    expect(await screen.findByText(/Phone number must have between/)).toBeDefined()
    expect(await countRegistrations(db)).toBe(0)
  })

  it('rejects an invalid email without saving', async () => {
    render(<RegistrationScreen />)
    const user = await fillForm({ ...PARTICIPANT, email: 'not-an-email' })
    await user.click(screen.getByRole('button', { name: 'Register & Print' }))

    expect(await screen.findByText('Enter a valid email address.')).toBeDefined()
    expect(await countRegistrations(db)).toBe(0)
  })

  it('keeps the other fields when one is invalid', async () => {
    render(<RegistrationScreen />)
    const user = await fillForm({ ...PARTICIPANT, email: 'bad' })
    await user.click(screen.getByRole('button', { name: 'Register & Print' }))

    await screen.findByText('Enter a valid email address.')
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Ada Lovelace')
    expect(screen.getByLabelText('Phone number')).toHaveProperty(
      'value',
      '+44 20 7946 0958',
    )
  })

  it('trims whitespace before storing', async () => {
    render(<RegistrationScreen />)
    await registerParticipant({
      name: '  Ada Lovelace  ',
      phone: ' +44 20 7946 0958 ',
      email: '  ada@example.com  ',
    })

    const record = await onlyRecord()
    expect(record.name).toBe('Ada Lovelace')
    expect(record.phone).toBe('+44 20 7946 0958')
    expect(record.email).toBe('ada@example.com')
  })

  it('submits on Enter from the last field', async () => {
    render(<RegistrationScreen />)
    const user = await fillForm()

    await user.type(screen.getByLabelText('Email address'), '{Enter}')

    await screen.findByTestId('sticker')
    expect(await countRegistrations(db)).toBe(1)
  })

  it('creates only one registration when submit is pressed repeatedly', async () => {
    render(<RegistrationScreen />)
    const user = await fillForm()

    const submit = screen.getByRole('button', { name: 'Register & Print' })
    // Three clicks as fast as the harness allows, while the first save is in
    // flight. A queue does not make participants patient.
    await Promise.all([user.click(submit), user.click(submit), user.click(submit)])

    await screen.findByTestId('sticker')
    expect(await countRegistrations(db)).toBe(1)
  })
})

describe('persistence before sticker (invariant 1)', () => {
  it('has committed the registration by the time a sticker exists', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()

    // The sticker is on screen; the record must already be readable from a
    // separate connection to the database.
    const reopened = new OfflineEventDb(db.name)
    try {
      expect(await countRegistrations(reopened)).toBe(1)
    } finally {
      reopened.close()
    }
  })

  it('produces no sticker when the write fails', async () => {
    vi.spyOn(db.registrations, 'add').mockRejectedValue(
      new Error('QuotaExceededError'),
    )

    render(<RegistrationScreen />)
    const user = await fillForm()
    await user.click(screen.getByRole('button', { name: 'Register & Print' }))

    expect(await screen.findByText(/Could not save this registration/)).toBeDefined()
    expect(screen.queryByTestId('sticker')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Print sticker' })).toBeNull()
    expect(window.print).not.toHaveBeenCalled()
    expect(await countRegistrations(db)).toBe(0)
  })

  it('leaves the form usable after a write failure', async () => {
    const add = vi
      .spyOn(db.registrations, 'add')
      .mockRejectedValueOnce(new Error('QuotaExceededError'))

    render(<RegistrationScreen />)
    const user = await fillForm()
    await user.click(screen.getByRole('button', { name: 'Register & Print' }))
    await screen.findByText(/Could not save this registration/)

    add.mockRestore()
    await user.click(screen.getByRole('button', { name: 'Register & Print' }))

    await screen.findByTestId('sticker')
    expect(await countRegistrations(db)).toBe(1)
  })

  it('survives a database reopen', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()
    const record = await onlyRecord()

    db.close()
    const reopened = new OfflineEventDb(db.name)
    try {
      expect(await getRegistrationByRecordId(reopened, record.recordId)).toEqual(
        record,
      )
    } finally {
      reopened.close()
    }
  })
})

describe('identity comes from the saved record', () => {
  it('displays the public code that storage issued', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()

    const record = await onlyRecord()
    expect(screen.getByTestId('saved-public-code').textContent).toBe(
      record.publicCode,
    )
    expect(record.publicCode).toMatch(/^A1-[0-9A-F]{6}-\d{5}-[0-9A-Z]$/)
  })

  it('does not mint a second identity when reprinting', async () => {
    render(<RegistrationScreen />)
    const user = await registerParticipant()
    const before = await onlyRecord()

    await user.click(screen.getByRole('button', { name: 'Reprint sticker' }))
    await user.click(screen.getByRole('button', { name: 'Print sticker' }))

    const after = await onlyRecord()
    expect(after.participantId).toBe(before.participantId)
    expect(after.publicCode).toBe(before.publicCode)
    expect(after.recordId).toBe(before.recordId)
    expect(await countRegistrations(db)).toBe(1)
  })

  it('keeps the previous record when moving to the next participant', async () => {
    render(<RegistrationScreen />)
    const user = await registerParticipant()
    const first = await onlyRecord()

    await user.click(screen.getByRole('button', { name: 'Next participant' }))

    expect(await getRegistrationByRecordId(db, first.recordId)).toEqual(first)
    expect(await countRegistrations(db)).toBe(1)
  })

  it('clears the form and returns focus to Name for the next participant', async () => {
    render(<RegistrationScreen />)
    const user = await registerParticipant()

    await user.click(screen.getByRole('button', { name: 'Next participant' }))

    const name = await screen.findByLabelText('Name')
    expect(name).toHaveProperty('value', '')
    expect(screen.getByLabelText('Email address')).toHaveProperty('value', '')
    await waitFor(() => expect(document.activeElement).toBe(name))
  })

  it('issues a distinct sequential code to the next participant', async () => {
    render(<RegistrationScreen />)
    const user = await registerParticipant()
    const first = await onlyRecord()

    await user.click(screen.getByRole('button', { name: 'Next participant' }))
    await registerParticipant({ ...PARTICIPANT, name: 'Grace Hopper' })

    const records = await listRecentRegistrations(db, 10)
    expect(records).toHaveLength(2)
    const codes = records.map((r) => r.publicCode)
    expect(new Set(codes).size).toBe(2)
    expect(codes).toContain(first.publicCode)
  })
})

describe('QR contents', () => {
  it('encodes exactly the serialised payload contract for the saved record', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()

    const record = await onlyRecord()
    const expectedPayload = serializeQrPayload(qrPayloadForRegistration(record))
    const expectedSvg = await renderQrSvg(expectedPayload)

    // Rendering is deterministic, so an identical symbol proves identical input.
    const qr = screen.getByTestId('sticker').querySelector('.sticker__qr')
    expect(qr?.innerHTML).toBe(normalizeSvg(expectedSvg))
  })

  it('uses the saved participantId and publicCode, not fresh ones', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()

    const record = await onlyRecord()
    const payload = JSON.parse(
      serializeQrPayload(qrPayloadForRegistration(record)),
    ) as Record<string, unknown>

    expect(payload['participant']).toBe(record.participantId)
    expect(payload['code']).toBe(record.publicCode)
    expect(payload['event']).toBe(record.eventId)
    expect(payload['v']).toBe(1)
  })

  it('carries no name, phone or email', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()

    const record = await onlyRecord()
    const payload = serializeQrPayload(qrPayloadForRegistration(record))

    expect(payload).not.toContain(record.name)
    expect(payload).not.toContain(record.phone)
    expect(payload).not.toContain(record.email)
    expect(payload).not.toContain('Ada')
    expect(payload).not.toContain('Lovelace')
    expect(payload).not.toContain('7946')
    expect(payload).not.toContain('example.com')
    expect(Object.keys(JSON.parse(payload) as object).sort()).toEqual([
      'code',
      'event',
      'participant',
      'v',
    ])
  })
})

describe('printable sticker', () => {
  it('shows the public code', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()

    const record = await onlyRecord()
    const sticker = screen.getByTestId('sticker')
    expect(within(sticker).getByText(record.publicCode)).toBeDefined()
  })

  it('contains no PII anywhere in its markup', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()

    const markup = screen.getByTestId('sticker').innerHTML
    for (const secret of [
      PARTICIPANT.name,
      PARTICIPANT.phone,
      PARTICIPANT.email,
      'Ada',
      'Lovelace',
      '7946',
      'example.com',
    ]) {
      expect(markup).not.toContain(secret)
    }
  })

  it('prints the public code on a single line by CSS contract', () => {
    // The layout guarantee lives in the stylesheet, so that is what is
    // asserted: a wrapped public code is a misread waiting to happen.
    const rule = /\.sticker__code\s*\{[^}]*\}/.exec(stylesheet)?.[0] ?? ''
    expect(rule).toContain('white-space: nowrap')
    expect(rule).toContain('slashed-zero')
    expect(rule).toContain('tabular-nums')
  })

  it('is declared at the physical label size', () => {
    const rule = /\.sticker\s*\{[^}]*\}/.exec(stylesheet)?.[0] ?? ''
    expect(rule).toContain('width: 50mm')
    expect(rule).toContain('height: 40mm')
  })
})

describe('printing', () => {
  it('invokes the browser print boundary', async () => {
    render(<RegistrationScreen />)
    const user = await registerParticipant()

    await user.click(screen.getByRole('button', { name: 'Print sticker' }))

    // This is all a browser can tell us. Whether paper emerged is not knowable
    // here, which is exactly why Reprint exists.
    expect(window.print).toHaveBeenCalledTimes(1)
  })

  it('reprints the identical sticker as many times as needed', async () => {
    render(<RegistrationScreen />)
    const user = await registerParticipant()
    const svgBefore = screen
      .getByTestId('sticker')
      .querySelector('.sticker__qr')?.innerHTML

    await user.click(screen.getByRole('button', { name: 'Reprint sticker' }))
    await user.click(screen.getByRole('button', { name: 'Reprint sticker' }))

    expect(window.print).toHaveBeenCalledTimes(2)
    expect(
      screen.getByTestId('sticker').querySelector('.sticker__qr')?.innerHTML,
    ).toBe(svgBefore)
    expect(await countRegistrations(db)).toBe(1)
  })

  it('focuses the print button once the sticker is ready', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Print sticker' }),
      ),
    )
  })
})

describe('correcting contact details', () => {
  it('updates the details while preserving identity and provenance', async () => {
    render(<RegistrationScreen />)
    const user = await registerParticipant()
    const before = await onlyRecord()

    await user.click(screen.getByRole('button', { name: 'Correct details' }))

    const correction = screen.getByRole('region', {
      name: 'Correct contact details',
    })
    const email = within(correction).getByLabelText('Email address')
    await user.clear(email)
    await user.type(email, 'ada.corrected@example.com')
    await user.click(
      within(correction).getByRole('button', { name: 'Save correction' }),
    )

    await waitFor(async () => {
      const after = await onlyRecord()
      expect(after.email).toBe('ada.corrected@example.com')
    })

    const after = await onlyRecord()
    expect(after.recordId).toBe(before.recordId)
    expect(after.participantId).toBe(before.participantId)
    expect(after.publicCode).toBe(before.publicCode)
    expect(after.eventId).toBe(before.eventId)
    expect(after.stationId).toBe(before.stationId)
    expect(after.deviceId).toBe(before.deviceId)
    expect(after.createdAt).toBe(before.createdAt)
    expect(after.revision).toBe(before.revision + 1)
    expect(after.name).toBe(before.name)
  })

  it('does not create another registration', async () => {
    render(<RegistrationScreen />)
    const user = await registerParticipant()

    await user.click(screen.getByRole('button', { name: 'Correct details' }))
    const correction = screen.getByRole('region', {
      name: 'Correct contact details',
    })
    const name = within(correction).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Augusta Ada King')
    await user.click(
      within(correction).getByRole('button', { name: 'Save correction' }),
    )

    await waitFor(async () => {
      expect((await onlyRecord()).name).toBe('Augusta Ada King')
    })
    expect(await countRegistrations(db)).toBe(1)
  })
})

describe('recovery after a page refresh', () => {
  it('offers the most recent registration for reprint', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()
    const record = await onlyRecord()

    // A refresh: the component tree is thrown away and rebuilt from storage.
    cleanup()
    render(<RegistrationScreen />)

    const recent = await screen.findByRole('region', {
      name: 'Recent registrations on this device',
    })
    expect(within(recent).getByText(record.publicCode)).toBeDefined()
  })

  it('reprints a recovered registration without creating a new one', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()
    const record = await onlyRecord()

    cleanup()
    render(<RegistrationScreen />)
    const user = userEvent.setup()

    const recent = await screen.findByRole('region', {
      name: 'Recent registrations on this device',
    })
    await user.click(within(recent).getByRole('button', { name: 'Reprint' }))

    const sticker = await screen.findByTestId('sticker')
    expect(within(sticker).getByText(record.publicCode)).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Print sticker' }))
    expect(window.print).toHaveBeenCalled()

    const after = await onlyRecord()
    expect(after).toEqual(record)
    expect(await countRegistrations(db)).toBe(1)
  })

  it('renders the recovered sticker with the identical QR symbol', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()
    const record = await onlyRecord()
    const original = screen
      .getByTestId('sticker')
      .querySelector('.sticker__qr')?.innerHTML

    cleanup()
    render(<RegistrationScreen />)
    const user = userEvent.setup()
    const recent = await screen.findByRole('region', {
      name: 'Recent registrations on this device',
    })
    await user.click(within(recent).getByRole('button', { name: 'Reprint' }))

    await screen.findByTestId('sticker')
    expect(
      screen.getByTestId('sticker').querySelector('.sticker__qr')?.innerHTML,
    ).toBe(original)
    expect(original).toBe(
      normalizeSvg(
        await renderQrSvg(serializeQrPayload(qrPayloadForRegistration(record))),
      ),
    )
  })

  it('lists newest first and shows no participant names', async () => {
    render(<RegistrationScreen />)
    const user = await registerParticipant()
    await user.click(screen.getByRole('button', { name: 'Next participant' }))
    await registerParticipant({ ...PARTICIPANT, name: 'Grace Hopper' })

    const recent = await screen.findByRole('region', {
      name: 'Recent registrations on this device',
    })
    const codes = within(recent)
      .getAllByText(/^A1-[0-9A-F]{6}-\d{5}-[0-9A-Z]$/)
      .map((node) => node.textContent)

    const stored = await listRecentRegistrations(db, 10)
    expect(codes).toEqual(stored.map((record) => record.publicCode))
    expect(recent.textContent).not.toContain('Grace')
    expect(recent.textContent).not.toContain('Ada')
  })
})
