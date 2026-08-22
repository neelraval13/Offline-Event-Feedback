import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecentReprints } from './RecentReprints'
import type { RegistrationRecord } from '../../types'

/*
 * The recovery utility, and the line it must not cross.
 *
 * It has exactly one job: "that sticker from three riders ago never came out,
 * let me print it again". It is not a participant list, not a dashboard and not
 * a search, and the strongest reason is not layout: a screen on a desk facing a
 * queue must not carry the last eight people's names, and nothing about
 * reprinting a label needs one.
 *
 * The component is handed whole `RegistrationRecord`s, contact details and all,
 * so "shows no names" is a property of this file rather than of what the caller
 * chose to pass. That is what these tests check, by giving it records whose
 * every text field is a distinctive string and then asserting none of them
 * reaches the DOM.
 */

afterEach(cleanup)

/*
 * Fixtures, not records. Ids and public codes are branded so that nothing in
 * the application can invent one; a test that only needs a string to render is
 * exactly the place that cast belongs, and it is confined to this function.
 */
type RecordFixture = Partial<
  Omit<RegistrationRecord, 'recordId' | 'publicCode'>
> & {
  readonly recordId?: string
  readonly publicCode?: string
}

function record(overrides: RecordFixture): RegistrationRecord {
  return {
    kind: 'registration',
    recordId: 'rec-1',
    participantId: 'p-1',
    publicCode: 'A1-B8EFD9-00001-X',
    eventId: 'ff-rc-2026-08-23',
    eventDay: '2026-08-23',
    stationId: 'A1',
    deviceId: 'device-1',
    createdAt: '2026-08-23T09:41:00.000Z',
    updatedAt: '2026-08-23T09:41:00.000Z',
    revision: 1,
    name: 'ZZNAMEZZ',
    phone: 'ZZPHONEZZ',
    email: 'ZZEMAILZZ',
    ...overrides,
  } as RegistrationRecord
}

const RECORDS = [
  record({ recordId: 'rec-2', publicCode: 'A1-B8EFD9-00002-K' }),
  record({ recordId: 'rec-1', publicCode: 'A1-B8EFD9-00001-X' }),
]

describe('the collapsed strip', () => {
  it('renders nothing at all when there is nothing to recover', () => {
    const { container } = render(
      <RecentReprints records={[]} activeRecordId={null} onReprint={vi.fn()} />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('starts closed, and says how many are within reach', () => {
    /*
     * V1 rendered the list open, permanently, below whichever state the screen
     * was in, and grew the page for every rider registered. The count is the
     * one thing an operator needs without opening it: whether the sticker they
     * are looking for is still there.
     */
    render(
      <RecentReprints
        records={RECORDS}
        activeRecordId={null}
        onReprint={vi.fn()}
      />,
    )

    const toggle = screen.getByRole('button', {
      name: /^Reprint an earlier sticker/,
    })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('2 on this device')
    expect(screen.queryByText('A1-B8EFD9-00002-K')).toBeNull()
  })

  it('opens and closes in place, without a dialog', async () => {
    const user = userEvent.setup()
    render(
      <RecentReprints
        records={RECORDS}
        activeRecordId={null}
        onReprint={vi.fn()}
      />,
    )
    const toggle = screen.getByRole('button', {
      name: /^Reprint an earlier sticker/,
    })

    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('A1-B8EFD9-00002-K')).toBeDefined()
    // Recovery is a two-second job. An overlay would be in the way of it.
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(toggle)
    expect(screen.queryByText('A1-B8EFD9-00002-K')).toBeNull()
  })
})

describe('what a row is allowed to say', () => {
  async function open() {
    const user = userEvent.setup()
    render(
      <RecentReprints
        records={RECORDS}
        activeRecordId={null}
        onReprint={vi.fn()}
      />,
    )
    await user.click(
      screen.getByRole('button', { name: /^Reprint an earlier sticker/ }),
    )
    return user
  }

  it('shows the public code and the time, in order', async () => {
    await open()

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(
      rows.map((row) => within(row).getByText(/^A1-/).textContent),
    ).toEqual(['A1-B8EFD9-00002-K', 'A1-B8EFD9-00001-X'])
  })

  it('shows no name, phone or email, even though it was given them', async () => {
    await open()

    const region = screen.getByRole('region', {
      name: 'Recent registrations on this device',
    })
    expect(region.textContent).not.toContain('ZZNAMEZZ')
    expect(region.textContent).not.toContain('ZZPHONEZZ')
    expect(region.textContent).not.toContain('ZZEMAILZZ')
  })

  it('offers a reprint per row, and reports the record it belongs to', async () => {
    const user = userEvent.setup()
    const onReprint = vi.fn()
    render(
      <RecentReprints
        records={RECORDS}
        activeRecordId={null}
        onReprint={onReprint}
      />,
    )
    await user.click(
      screen.getByRole('button', { name: /^Reprint an earlier sticker/ }),
    )

    const rows = screen.getAllByRole('listitem')
    await user.click(
      within(rows[1] as HTMLElement).getByRole('button', { name: 'Reprint' }),
    )

    expect(onReprint).toHaveBeenCalledExactlyOnceWith(RECORDS[1])
  })

  it('marks the record already on screen instead of offering it again', async () => {
    /*
     * Reprinting the sticker that is already showing does nothing an operator
     * wants, and a button that appears to do nothing is one they press twice.
     */
    const user = userEvent.setup()
    render(
      <RecentReprints
        records={RECORDS}
        activeRecordId="rec-2"
        onReprint={vi.fn()}
      />,
    )
    await user.click(
      screen.getByRole('button', { name: /^Reprint an earlier sticker/ }),
    )

    const rows = screen.getAllByRole('listitem')
    const showing = within(rows[0] as HTMLElement).getByRole('button')
    expect(showing.textContent).toBe('Showing')
    expect(showing).toHaveProperty('disabled', true)

    expect(
      within(rows[1] as HTMLElement).getByRole('button', { name: 'Reprint' }),
    ).toHaveProperty('disabled', false)
  })
})
