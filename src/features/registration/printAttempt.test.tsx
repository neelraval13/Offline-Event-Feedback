import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegistrationScreen } from './RegistrationScreen'
import { fillCampaignRegistration } from '../campaign/flying-flea/testSupport'
import { db } from '../../lib/storage'
import {
  countRegistrations,
  listRecentRegistrations,
} from '../../lib/storage/registrations'
import type { RegistrationRecord } from '../../types'

/*
 * What the terminal offers next, and why it changes.
 *
 * Before a print has been attempted the operator's next physical act is to
 * print the label; afterwards it is to take the next rider. The screen follows
 * that, and the state it follows is deliberately the smallest possible thing:
 * one boolean, in React, meaning "print was invoked".
 *
 * ## The part these tests exist to hold down
 *
 * It must never become anything more than that. It is not persisted, not
 * synced, not part of a `RegistrationRecord` and does not move `revision`,
 * because a registration is the same registration whether or not somebody has
 * pressed print. Two of the tests below assert exactly that, by reading the
 * record back out of IndexedDB after a print.
 *
 * It also cannot mean "the label came out". The browser will not tell us
 * whether the printer was on, whether paper emerged, or whether the operator
 * cancelled the dialog. It means the print path was invoked, which is all that
 * is needed to decide which button should be the obvious one.
 */

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

async function registerRider(name = 'Ada Lovelace') {
  const user = userEvent.setup()
  await fillCampaignRegistration(user, {
    name,
    phone: '9876543210',
    email: 'ada@example.com',
  })
  await user.click(screen.getByRole('button', { name: 'Register & Print' }))
  await screen.findByTestId('sticker')
  return user
}

async function onlyRecord(): Promise<RegistrationRecord> {
  const records = await listRecentRegistrations(db, 10)
  return records[0] as RegistrationRecord
}

/** Which action the screen is presenting as the obvious one. */
function primaryAction(): string {
  const buttons = [...screen.getAllByRole('button')]
  const primary = buttons.find((button) =>
    button.className.includes('bg-interactive'),
  )

  return primary?.textContent?.trim() ?? 'none'
}

describe('before a print has been attempted', () => {
  it('offers Print sticker as the primary action', async () => {
    render(<RegistrationScreen />)
    await registerRider()

    expect(primaryAction()).toBe('Print sticker')
  })

  it('does not yet call it a reprint', async () => {
    // "Reprint" before a print is a label that describes something that has
    // not happened, and it invites a second press of a button nobody pressed.
    render(<RegistrationScreen />)
    await registerRider()

    expect(screen.queryByRole('button', { name: 'Reprint sticker' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Print sticker' })).toBeDefined()
  })

  it('keeps Next rider reachable but quiet', async () => {
    render(<RegistrationScreen />)
    await registerRider()

    const next = screen.getByRole('button', { name: 'Next rider' })
    expect(next).toHaveProperty('disabled', false)
    expect(next.className).not.toContain('bg-interactive')
  })
})

describe('after a print has been attempted', () => {
  it('makes Next rider the primary action', async () => {
    render(<RegistrationScreen />)
    const user = await registerRider()

    await user.click(screen.getByRole('button', { name: 'Print sticker' }))

    expect(window.print).toHaveBeenCalledTimes(1)
    expect(primaryAction()).toBe('Next rider')
  })

  it('offers the same sticker again, now called a reprint', async () => {
    render(<RegistrationScreen />)
    const user = await registerRider()

    await user.click(screen.getByRole('button', { name: 'Print sticker' }))
    await user.click(screen.getByRole('button', { name: 'Reprint sticker' }))

    expect(window.print).toHaveBeenCalledTimes(2)
    expect(await countRegistrations(db)).toBe(1)
  })

  it('drops Correct details to the quietest weight', async () => {
    /*
     * Once a label exists, correcting details is the rarest thing an operator
     * does and the most expensive to hit by accident.
     */
    render(<RegistrationScreen />)
    const user = await registerRider()
    await user.click(screen.getByRole('button', { name: 'Print sticker' }))

    const correct = screen.getByRole('button', { name: 'Correct details' })

    // Neither the primary fill nor the secondary's border: the ghost weight.
    expect(correct.className).not.toContain('bg-interactive')
    expect(correct.className).not.toMatch(/(^|\s)border(\s|$)/)
    // And the button beside it does carry one, so this is a real ordering.
    expect(
      screen.getByRole('button', { name: 'Reprint sticker' }).className,
    ).toMatch(/(^|\s)border(\s|$)/)
  })
})

describe('what a print attempt does not touch', () => {
  it('writes nothing to the stored record', async () => {
    render(<RegistrationScreen />)
    const user = await registerRider()
    const before = await onlyRecord()

    await user.click(screen.getByRole('button', { name: 'Print sticker' }))
    await user.click(screen.getByRole('button', { name: 'Reprint sticker' }))

    const after = await onlyRecord()
    expect(after).toEqual(before)
    expect(after.revision).toBe(before.revision)
  })

  it('puts no print field on the record at all', async () => {
    render(<RegistrationScreen />)
    const user = await registerRider()
    await user.click(screen.getByRole('button', { name: 'Print sticker' }))

    const record = await onlyRecord()
    const printish = Object.keys(record).filter((key) =>
      /print/i.test(key),
    )
    expect(printish).toEqual([])
  })
})

describe('the print question starts again with each rider', () => {
  it('resets when the desk is cleared for the next rider', async () => {
    render(<RegistrationScreen />)
    const user = await registerRider()
    await user.click(screen.getByRole('button', { name: 'Print sticker' }))

    await user.click(screen.getByRole('button', { name: 'Next rider' }))
    await fillCampaignRegistration(user, {
      name: 'Grace Hopper',
      phone: '9876543211',
      email: 'grace@example.com',
    })
    await user.click(screen.getByRole('button', { name: 'Register & Print' }))
    await screen.findByTestId('sticker')

    expect(primaryAction()).toBe('Print sticker')
  })

  it('resets when an earlier sticker is recovered', async () => {
    /*
     * A different rider is now in hand. Recovering a label from three riders
     * ago and being told the obvious next action is "next rider" would be the
     * screen answering a question about somebody else.
     */
    render(<RegistrationScreen />)
    const user = await registerRider()
    await user.click(screen.getByRole('button', { name: 'Print sticker' }))
    expect(primaryAction()).toBe('Next rider')

    await user.click(screen.getByRole('button', { name: 'Next rider' }))

    const recent = screen.getByRole('region', {
      name: 'Recent registrations on this device',
    })
    await user.click(
      within(recent).getByRole('button', { name: /^Reprint an earlier sticker/ }),
    )
    await user.click(within(recent).getByRole('button', { name: 'Reprint' }))
    await screen.findByTestId('sticker')

    await waitFor(() => expect(primaryAction()).toBe('Print sticker'))
  })

  it('survives a sticker retry, because the rider has not changed', async () => {
    /*
     * Retrying a failed sticker is the same rider still standing there. It
     * redoes the label, not the print question.
     */
    render(<RegistrationScreen />)
    const user = await registerRider()
    await user.click(screen.getByRole('button', { name: 'Print sticker' }))

    expect(primaryAction()).toBe('Next rider')
    expect(screen.getByRole('button', { name: 'Reprint sticker' })).toBeDefined()
  })
})
