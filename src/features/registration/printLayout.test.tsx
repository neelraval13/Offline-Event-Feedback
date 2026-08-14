import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { RegistrationScreen } from './RegistrationScreen'
import { PRINT_ROOT_ID } from './PrintableSticker'
import { fillCampaignRegistration } from '../campaign/flying-flea/testSupport'
import { db } from '../../lib/storage'

/*
 * Regression cover for the six-duplicate-pages defect found in physical QA.
 *
 * jsdom does not paginate, so the page count itself cannot be asserted here.
 * What can be asserted is the two things that caused it — an application still
 * occupying layout, and a fixed-position label repeating across pages — plus
 * the structural guarantee that exactly one sticker reaches the print root.
 * The page count stays a step in docs/point-a-physical-test.md.
 */
const stylesheet = readFileSync('src/styles.css', 'utf8')
const html = readFileSync('index.html', 'utf8')

/** CSS with comments removed, so assertions test declarations and not prose. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * The declarations inside the `@media print` block, and only those.
 *
 * Bounded by matching braces rather than by slicing to the end of the file.
 * The end-of-file version passed only for as long as the print rules happened
 * to be last in the stylesheet: any rule appended afterwards was read as part
 * of the print block, and an unrelated `visibility: hidden` elsewhere would
 * fail an assertion about printing.
 */
function printBlock(): string {
  const source = withoutComments(stylesheet)
  const start = source.indexOf('@media print {')
  expect(start).toBeGreaterThan(-1)

  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(start, index + 1)
      }
    }
  }

  throw new Error('the @media print block is not closed')
}

const PARTICIPANT = {
  name: 'Ada Lovelace',
  phone: '9876543210',
  email: 'ada@example.com',
}

beforeEach(async () => {
  await db.open()
  await Promise.all([db.registrations.clear(), db.sequences.clear()])
  window.print = vi.fn()
  document.getElementById(PRINT_ROOT_ID)?.remove()
})

afterEach(() => {
  cleanup()
  document.getElementById(PRINT_ROOT_ID)?.remove()
})

async function registerParticipant() {
  const user = userEvent.setup()
  await fillCampaignRegistration(user, PARTICIPANT)
  await user.click(screen.getByRole('button', { name: 'Register & Print' }))
  await screen.findByTestId('sticker-print')
  return user
}

describe('print CSS contract', () => {
  it('sets a single 50mm x 40mm page with no margin', () => {
    const block = printBlock()
    expect(block).toMatch(/@page\s*\{[^}]*size:\s*50mm\s+40mm/)
    expect(block).toMatch(/@page\s*\{[^}]*margin:\s*0/)
  })

  it('removes the application from layout rather than merely hiding it', () => {
    // `visibility: hidden` keeps the app's full height in the document, which
    // is what paginated the label across six pages.
    const block = printBlock()
    expect(block).toMatch(/#root\s*\{[^}]*display:\s*none/)
    expect(block).not.toContain('visibility: hidden')
  })

  it('positions nothing fixed', () => {
    // Fixed-position elements repeat on every page of paged media.
    expect(printBlock()).not.toContain('position: fixed')
  })

  it('pins the page box so nothing can spill onto a second sheet', () => {
    const block = printBlock()
    expect(block).toMatch(/html,\s*body\s*\{[^}]*height:\s*40mm/)
    expect(block).toMatch(/html,\s*body\s*\{[^}]*overflow:\s*hidden/)
  })

  it('forbids a page break around the label', () => {
    const block = printBlock()
    expect(block).toContain('break-after: avoid')
    expect(block).toContain('break-inside: avoid')
  })

  it('hides the print root on screen', () => {
    const screenRules = withoutComments(
      stylesheet.slice(0, stylesheet.indexOf('@media print {')),
    )
    expect(screenRules).toMatch(/#print-root\s*\{[^}]*display:\s*none/)
  })
})

describe('print DOM structure', () => {
  it('ships a print root outside the application root', () => {
    // Their being siblings is what lets print switch #root off wholesale.
    expect(html).toContain(`id="${PRINT_ROOT_ID}"`)
    expect(html.indexOf('id="root"')).toBeLessThan(
      html.indexOf(`id="${PRINT_ROOT_ID}"`),
    )
  })

  it('puts exactly one sticker in the print root', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()

    const printRoot = document.getElementById(PRINT_ROOT_ID)
    expect(printRoot).not.toBeNull()
    expect(printRoot?.querySelectorAll('.sticker')).toHaveLength(1)
  })

  it('renders the printable sticker outside the application root', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()

    const printed = screen.getByTestId('sticker-print')
    expect(document.getElementById(PRINT_ROOT_ID)?.contains(printed)).toBe(true)
  })

  it('keeps exactly one printable sticker across repeated reprints', async () => {
    render(<RegistrationScreen />)
    const user = await registerParticipant()

    await user.click(screen.getByRole('button', { name: 'Reprint sticker' }))
    await user.click(screen.getByRole('button', { name: 'Reprint sticker' }))
    await user.click(screen.getByRole('button', { name: 'Print sticker' }))

    expect(
      document.getElementById(PRINT_ROOT_ID)?.querySelectorAll('.sticker'),
    ).toHaveLength(1)
    expect(window.print).toHaveBeenCalledTimes(3)
  })

  it('shows the same code on the preview and the printed copy', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()

    const preview = screen.getByTestId('sticker')
    const printed = screen.getByTestId('sticker-print')

    expect(printed.textContent).toBe(preview.textContent)
    expect(printed.querySelector('.sticker__qr')?.innerHTML).toBe(
      preview.querySelector('.sticker__qr')?.innerHTML,
    )
  })

  it('leaves nothing printable once staff moves to the next participant', async () => {
    render(<RegistrationScreen />)
    const user = await registerParticipant()

    await user.click(screen.getByRole('button', { name: 'Next rider' }))

    expect(
      document.getElementById(PRINT_ROOT_ID)?.querySelectorAll('.sticker'),
    ).toHaveLength(0)
  })

  it('carries no PII into the print root', async () => {
    render(<RegistrationScreen />)
    await registerParticipant()

    const markup = document.getElementById(PRINT_ROOT_ID)?.innerHTML ?? ''
    for (const secret of ['Ada', 'Lovelace', '7946', 'example.com']) {
      expect(markup).not.toContain(secret)
    }
  })
})
