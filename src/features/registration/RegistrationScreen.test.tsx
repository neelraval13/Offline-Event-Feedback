import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegistrationScreen } from './RegistrationScreen'
import { fillCampaignRegistration } from '../campaign/flying-flea/testSupport'
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
  phone: '9876543210',
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
  await fillCampaignRegistration(user, values)
  return user
}

async function registerParticipant(values = PARTICIPANT) {
  const user = await fillForm(values)
  await user.click(screen.getByRole('button', { name: 'Register & Print' }))
  await screen.findByTestId('sticker')
  return user
}

/**
 * Opens the reprint-recovery list and returns it.
 *
 * V2 collapses it by default, so eight rows of codes do not compete with the
 * rider standing in front of the operator and the page does not grow for every
 * rider registered. What it contains once open is unchanged, which is what
 * every assertion below is about.
 */
async function openRecent(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  const recent = await screen.findByRole('region', {
    name: 'Recent registrations on this device',
  })

  await user.click(
    within(recent).getByRole('button', { name: /^Reprint an earlier sticker/ }),
  )
  return recent
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
      expect(document.activeElement).toBe(screen.getByLabelText(/^Name/)),
    )
  })

  it('requires every field and writes nothing when they are missing', async () => {
    render(<RegistrationScreen />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Register & Print' }))

    // The four fields the operator still answers: vehicle, name, email and
    // phone. Nothing is saved and no identity is issued.
    expect(await screen.findAllByRole('alert')).toHaveLength(4)
    expect(screen.queryByTestId('sticker')).toBeNull()
    expect(await countRegistrations(db)).toBe(0)
  })

  it('rejects an invalid phone number without saving', async () => {
    render(<RegistrationScreen />)
    const user = await fillForm({ ...PARTICIPANT, phone: '12' })
    await user.click(screen.getByRole('button', { name: 'Register & Print' }))

    expect(
      await screen.findByText('Enter a valid 10-digit mobile number.'),
    ).toBeDefined()
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
    expect(screen.getByLabelText(/^Name/)).toHaveProperty('value', 'Ada Lovelace')
    expect(screen.getByLabelText(/^Phone Number/)).toHaveProperty(
      'value',
      PARTICIPANT.phone,
    )
  })

  it('trims whitespace before storing', async () => {
    render(<RegistrationScreen />)
    await registerParticipant({
      name: '  Ada Lovelace  ',
      // The campaign stores a bare 10-digit mobile: spaces and dashes are how
      // people type a number, not part of it.
      phone: ' 98765 43210 ',
      email: '  ada@example.com  ',
    })

    const record = await onlyRecord()
    expect(record.name).toBe('Ada Lovelace')
    expect(record.phone).toBe('9876543210')
    expect(record.email).toBe('ada@example.com')
  })

  it('submits on Enter from the last field', async () => {
    render(<RegistrationScreen />)
    const user = await fillForm()

    await user.type(screen.getByLabelText(/^Email ID/), '{Enter}')

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

    expect(await screen.findByText(/Registration not saved/)).toBeDefined()
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
    await screen.findByText(/Registration not saved/)

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

    /*
     * Print, then reprint. The label on the button changes once a print has
     * been attempted (see `printAttempted`); what must not change is the
     * identity behind it, however many times it is pressed.
     */
    await user.click(screen.getByRole('button', { name: 'Print sticker' }))
    await user.click(screen.getByRole('button', { name: 'Reprint sticker' }))

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

    await user.click(screen.getByRole('button', { name: 'Next rider' }))

    expect(await getRegistrationByRecordId(db, first.recordId)).toEqual(first)
    expect(await countRegistrations(db)).toBe(1)
  })

  it('clears the form and returns focus to Name for the next participant', async () => {
    render(<RegistrationScreen />)
    const user = await registerParticipant()

    await user.click(screen.getByRole('button', { name: 'Next rider' }))

    const name = await screen.findByLabelText(/^Name/)
    expect(name).toHaveProperty('value', '')
    expect(screen.getByLabelText(/^Email ID/)).toHaveProperty('value', '')
    await waitFor(() => expect(document.activeElement).toBe(name))
  })

  it('issues a distinct sequential code to the next participant', async () => {
    render(<RegistrationScreen />)
    const user = await registerParticipant()
    const first = await onlyRecord()

    await user.click(screen.getByRole('button', { name: 'Next rider' }))
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

    await user.click(screen.getByRole('button', { name: 'Print sticker' }))
    await user.click(screen.getByRole('button', { name: 'Reprint sticker' }))
    await user.click(screen.getByRole('button', { name: 'Reprint sticker' }))

    expect(window.print).toHaveBeenCalledTimes(3)
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

    const correction = screen.getByRole('dialog', {
      name: 'Correct rider details',
    })
    const email = within(correction).getByLabelText(/^Email ID/)
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
    const correction = screen.getByRole('dialog', {
      name: 'Correct rider details',
    })
    const name = within(correction).getByLabelText(/^Name/)
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

describe('the venue and the time the operator no longer types', () => {
  /*
   * Two fields became two facts. Neither is a control any more, both are still
   * on every record, and the whole risk of the change lives in *when* the time
   * is read and *whether* a later correction overwrites it.
   *
   * The instants below are written as UTC so they mean the same moment wherever
   * this suite runs; the venue is UTC+05:30.
   */

  /** 14:10 at the venue: the form is opened. */
  const OPENED = new Date('2026-08-23T08:40:00.000Z')
  /** 14:13 at the venue: the operator presses Register & Print. */
  const SUBMITTED = new Date('2026-08-23T08:43:00.000Z')
  /** 15:49 at the venue: the next rider. */
  const NEXT_RIDER = new Date('2026-08-23T10:19:00.000Z')

  /*
   * Only `Date` is faked, deliberately: `setTimeout` and friends stay real, so
   * IndexedDB, Dexie and user-event keep making progress while the test decides
   * what "now" is. Faking the whole timer set stalls the save and the sticker
   * never arrives.
   */
  function atVenueTime(instant: Date) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(instant)
    return userEvent.setup()
  }

  it('states both above the form instead of asking for them', async () => {
    render(<RegistrationScreen />)

    expect(await screen.findByText('Richardson & Cruddas')).toBeDefined()
    expect(screen.getByText('23 August 2026')).toBeDefined()

    expect(screen.queryByLabelText(/^Location/)).toBeNull()
    expect(screen.queryByLabelText(/^Test Ride Date/)).toBeNull()
    expect(
      document.querySelectorAll('input[type="datetime-local"]'),
    ).toHaveLength(0)
  })

  it('stores the locked venue on a registration nobody chose one for', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()

    expect((await onlyRecord()).location).toBe('Richardson & Cruddas')
  })

  it('stores the event day with the time the operator pressed the button', async () => {
    const user = atVenueTime(OPENED)
    try {
      render(<RegistrationScreen />)
      await fillCampaignRegistration(user)

      // Three minutes pass while the rider spells their email address out.
      vi.setSystemTime(SUBMITTED)
      await user.click(screen.getByRole('button', { name: 'Register & Print' }))
      await screen.findByTestId('sticker')

      // 14:13, not the 14:10 the form was opened at.
      expect((await onlyRecord()).testRideAt).toBe('2026-08-23T14:13')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the clock again for the next rider at the same desk', async () => {
    /*
     * The component is not remounted between riders: "Next rider" clears the
     * desk in place. A time captured on mount, or when the draft was created,
     * would give every rider of the session the first one's slot.
     */
    const user = atVenueTime(OPENED)
    try {
      render(<RegistrationScreen />)

      await fillCampaignRegistration(user)
      vi.setSystemTime(SUBMITTED)
      await user.click(screen.getByRole('button', { name: 'Register & Print' }))
      await screen.findByTestId('sticker')

      await user.click(screen.getByRole('button', { name: 'Next rider' }))
      vi.setSystemTime(NEXT_RIDER)
      await fillCampaignRegistration(user, {
        ...PARTICIPANT,
        email: 'grace@example.com',
      })
      await user.click(screen.getByRole('button', { name: 'Register & Print' }))
      await screen.findByTestId('sticker')

      const stored = await listRecentRegistrations(db, 10)
      expect(stored.map((record) => record.testRideAt).sort()).toEqual([
        '2026-08-23T14:13',
        '2026-08-23T15:49',
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('never stamps the calendar day the device happens to be on', async () => {
    // Registering while the tablet believes it is some other date entirely.
    const user = atVenueTime(new Date('2026-08-15T08:43:00.000Z'))
    try {
      render(<RegistrationScreen />)
      await fillCampaignRegistration(user)
      await user.click(screen.getByRole('button', { name: 'Register & Print' }))
      await screen.findByTestId('sticker')

      // The date is the event's, the time is the venue clock's.
      expect((await onlyRecord()).testRideAt).toBe('2026-08-23T14:13')
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves the ride time alone when details are corrected later', async () => {
    /*
     * A correction is not a new ride. An operator who fixes a misspelt email at
     * 16:10 must not move the rider's 15:42 test ride, because afterwards
     * nothing in the record says it was ever anything else.
     */
    const user = atVenueTime(new Date('2026-08-23T10:12:00.000Z'))
    try {
      render(<RegistrationScreen />)
      await fillCampaignRegistration(user)
      await user.click(screen.getByRole('button', { name: 'Register & Print' }))
      await screen.findByTestId('sticker')

      expect((await onlyRecord()).testRideAt).toBe('2026-08-23T15:42')

      // Half an hour later, at 16:10.
      vi.setSystemTime(new Date('2026-08-23T10:40:00.000Z'))
      await user.click(screen.getByRole('button', { name: 'Correct details' }))

      const correction = screen.getByRole('dialog', {
        name: 'Correct rider details',
      })
      const email = within(correction).getByLabelText(/^Email ID/)
      await user.clear(email)
      await user.type(email, 'ada.corrected@example.com')
      await user.click(
        within(correction).getByRole('button', { name: 'Save correction' }),
      )

      await waitFor(async () => {
        expect((await onlyRecord()).email).toBe('ada.corrected@example.com')
      })

      const after = await onlyRecord()
      expect(after.testRideAt).toBe('2026-08-23T15:42')
      expect(after.testRideAt).not.toBe('2026-08-23T16:10')
      // And the venue is still the canonical one.
      expect(after.location).toBe('Richardson & Cruddas')
    } finally {
      vi.useRealTimers()
    }
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

    const recent = await openRecent(userEvent.setup())
    expect(within(recent).getByText(record.publicCode)).toBeDefined()
  })

  it('reprints a recovered registration without creating a new one', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()
    const record = await onlyRecord()

    cleanup()
    render(<RegistrationScreen />)
    const user = userEvent.setup()

    const recent = await openRecent(user)
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
    const recent = await openRecent(user)
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
    await user.click(screen.getByRole('button', { name: 'Next rider' }))
    await registerParticipant({ ...PARTICIPANT, name: 'Grace Hopper' })

    const recent = await openRecent(user)
    const codes = within(recent)
      .getAllByText(/^A1-[0-9A-F]{6}-\d{5}-[0-9A-Z]$/)
      .map((node) => node.textContent)

    const stored = await listRecentRegistrations(db, 10)
    expect(codes).toEqual(stored.map((record) => record.publicCode))
    expect(recent.textContent).not.toContain('Grace')
    expect(recent.textContent).not.toContain('Ada')
  })
})
