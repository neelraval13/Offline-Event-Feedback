import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportingConcept } from './ReportingConcept'
import { ROUTES } from '../../../app/routes'

/*
 * The Reporting concept's product decisions, as rendered.
 *
 * `concept.test.ts` proves the route is inert and that the fixtures add up.
 * This file proves the screen says what the model means: that direct feedback
 * is ordinary, that coverage and the analysis base are two different questions,
 * that a historical run is labelled in words, and that no surface offers a way
 * to rewrite the evidence.
 *
 * Every assertion here is about a decision that has been made explicitly and
 * could plausibly be undone by a later edit. That is the only reason a concept
 * needs tests at all.
 */

afterEach(cleanup)

/** Opens the concept on a given section, via the design-review selector. */
async function openSection(label: string) {
  const user = userEvent.setup()
  render(<ReportingConcept />)
  const sections = screen.getByRole('group', { name: 'Section states' })
  await user.click(within(sections).getByRole('button', { name: label }))
  return user
}

describe('the route the concept occupies', () => {
  it('is unlisted, lazy, and separate from the production reporting screen', () => {
    const concept = ROUTES.find((route) => route.path === '/concept/reporting')
    const production = ROUTES.find((route) => route.path === '/reporting')

    expect(concept?.showInNav).toBe(false)
    expect(production?.showInNav).toBe(false)

    /*
     * Both render through a Suspense boundary, which is what lazy loading looks
     * like from here; the bundle assertion is the build's job. What matters is
     * that they are two routes rendering two different components.
     */
    expect(concept).toBeDefined()
    expect(production).toBeDefined()
    expect(concept?.render).not.toBe(production?.render)
  })
})

describe('the credential gate', () => {
  it('offers no way to stay signed in', async () => {
    const user = userEvent.setup()
    render(<ReportingConcept />)
    const sessions = screen.getByRole('group', { name: 'Session states' })
    await user.click(within(sessions).getByRole('button', { name: 'Logged out' }))

    /*
     * No remember-me, no persistent session, no account. The secret reads every
     * participant's contact details, so a closed tab has to end the session.
     */
    for (const forbidden of [
      /remember/i,
      /keep me signed in/i,
      /stay signed in/i,
      /forgot/i,
      /create an account/i,
    ]) {
      expect(screen.queryByText(forbidden)).toBeNull()
    }
    expect(screen.queryByRole('checkbox')).toBeNull()

    expect(screen.getByText(/is not stored by the app/i)).toBeDefined()
    expect(screen.getByLabelText(/^Reporting secret/)).toHaveProperty('type', 'password')
  })

  it('says what happened to the data when a secret is rejected', async () => {
    const user = userEvent.setup()
    render(<ReportingConcept />)
    const sessions = screen.getByRole('group', { name: 'Session states' })
    await user.click(within(sessions).getByRole('button', { name: 'Rejected secret' }))

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('rejected')
    expect(alert.textContent).toContain('session ended')
    expect(alert.textContent).toContain('cleared')
  })
})

describe('the snapshot rail', () => {
  it('labels the current and historical states in words, not only colour', async () => {
    const user = userEvent.setup()
    render(<ReportingConcept />)
    const runs = screen.getByRole('group', { name: 'Run states' })

    expect(screen.getByText('Current snapshot')).toBeDefined()

    await user.click(within(runs).getByRole('button', { name: 'Historical' }))
    expect(screen.getByText('Historical snapshot')).toBeDefined()
    expect(
      screen.getByText(/Every status, count and anomaly on this screen is that run/),
    ).toBeDefined()
  })

  it('does not call a historical snapshot an error', async () => {
    const user = userEvent.setup()
    render(<ReportingConcept />)
    const runs = screen.getByRole('group', { name: 'Run states' })
    await user.click(within(runs).getByRole('button', { name: 'Historical' }))

    // It is legitimate evidence: what the event looked like when a figure was
    // quoted. The banner says so rather than implying something went wrong.
    expect(screen.getByText(/valid evidence, not an error/i)).toBeDefined()
    expect(screen.queryByText(/invalid snapshot/i)).toBeNull()
  })

  it('keeps the stale warning above the sections, on every section', async () => {
    const user = userEvent.setup()
    render(<ReportingConcept />)
    const runs = screen.getByRole('group', { name: 'Run states' })
    const sections = screen.getByRole('group', { name: 'Section states' })

    await user.click(within(runs).getByRole('button', { name: 'Latest stale' }))

    for (const label of ['Overview', 'Participants', 'Export']) {
      await user.click(within(sections).getByRole('button', { name: label }))
      expect(screen.getByText('Event data changed since this snapshot')).toBeDefined()
    }
  })

  it('strengthens the stale warning on Export, where a file is about to exist', async () => {
    const user = userEvent.setup()
    render(<ReportingConcept />)
    const runs = screen.getByRole('group', { name: 'Run states' })
    const sections = screen.getByRole('group', { name: 'Section states' })

    await user.click(within(runs).getByRole('button', { name: 'Latest stale' }))
    await user.click(within(sections).getByRole('button', { name: 'Overview' }))
    expect(screen.queryByText(/A file downloaded now describes/)).toBeNull()

    await user.click(within(sections).getByRole('button', { name: 'Export' }))
    expect(screen.getByText(/A file downloaded now describes/)).toBeDefined()
  })
})

describe('coverage and the analysis base', () => {
  it('presents them as two separate questions, never one response rate', () => {
    render(<ReportingConcept />)

    expect(screen.getByRole('heading', { name: 'Registration coverage' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Analysis base' })).toBeDefined()

    /*
     * A single "response rate" is exactly the figure this screen refuses to
     * produce: a rider with two conflicting responses raises coverage and
     * contributes to no average, and one number would hide that.
     */
    expect(screen.queryByText(/^Response rate$/i)).toBeNull()

    expect(
      screen.getByText(/How much of the registration list responded at all/),
    ).toBeDefined()
    expect(
      screen.getByText(/attribute to exactly one person/),
    ).toBeDefined()
  })

  it('carries direct feedback beside the coverage fraction, not inside it', () => {
    const { container } = render(<ReportingConcept />)

    expect(screen.getAllByText('Direct feedback').length).toBeGreaterThan(0)
    expect(screen.getByText('Outside registration coverage')).toBeDefined()
    expect(
      screen.getByText(/1,057 of 1,284 registered riders responded/),
    ).toBeDefined()

    // 1,057 + 37 would be 1,094; that figure must appear nowhere.
    expect(container.textContent).not.toContain('1,094')
  })
})

describe('direct feedback is a valid path', () => {
  it('is not one of the review categories', async () => {
    await openSection('Needs review')

    const categories = screen.getByRole('group', { name: 'Review category' })
    expect(within(categories).queryByText(/direct feedback/i)).toBeNull()

    for (const label of [
      'Codes that matched no registration',
      'Identity conflicts',
      'Several responses',
      'No response',
    ]) {
      expect(within(categories).getByText(label)).toBeDefined()
    }
  })

  it('is a different status from a code that matched no registration', async () => {
    await openSection('Responses')

    const filters = screen.getByRole('group', { name: 'Filter by status' })
    expect(within(filters).getByRole('button', { name: 'Direct feedback' })).toBeDefined()
    expect(
      within(filters).getByRole('button', { name: 'No registration' }),
    ).toBeDefined()
  })

  it('reads as ordinary rather than as a fault', async () => {
    const user = await openSection('Responses')

    const filters = screen.getByRole('group', { name: 'Filter by status' })
    await user.click(within(filters).getByRole('button', { name: 'Direct feedback' }))

    const table = screen.getByRole('table', { name: 'Responses' })
    const pills = within(table).getAllByText('Direct feedback')
    expect(pills.length).toBeGreaterThan(0)

    /*
     * Neutral, not amber or red. `standalone` is the contact path working, and
     * an attention treatment would send somebody to fix a rider who did nothing
     * wrong.
     */
    for (const pill of pills) {
      expect(pill.className).toContain('text-muted')
      expect(pill.className).not.toContain('text-warn')
      expect(pill.className).not.toContain('text-danger')
    }
  })
})

describe('questionnaire versions', () => {
  it('names each questionnaire with its own scale', () => {
    render(<ReportingConcept />)

    expect(screen.getAllByText('Flying Flea test ride').length).toBeGreaterThan(0)
    expect(screen.getByText(/Four questions, 1 to 7/)).toBeDefined()
    expect(
      screen.getByText(/Two questionnaires are never averaged together/),
    ).toBeDefined()
  })

  it('keeps the 1-5 and 1-7 figures in separate sections', async () => {
    const user = userEvent.setup()
    render(<ReportingConcept />)
    const data = screen.getByRole('group', { name: 'Data states' })
    await user.click(within(data).getByRole('button', { name: 'Mixed questionnaires' }))

    const flyingFlea = screen.getByRole('heading', { name: 'Flying Flea test ride' })
    const legacy = screen.getByRole('heading', { name: 'Legacy feedback' })
    expect(flyingFlea).toBeDefined()
    expect(legacy).toBeDefined()
    expect(flyingFlea.closest('section')).not.toBe(legacy.closest('section'))

    // Both scales are stated wherever an average is shown.
    expect(screen.getAllByText('/ 7').length).toBeGreaterThan(0)
    expect(screen.getByText('/ 5')).toBeDefined()
  })

  it('says plainly that unreadable responses were excluded, not guessed at', () => {
    render(<ReportingConcept />)
    expect(
      screen.getByText(/remain available individually and in exports/),
    ).toBeDefined()
  })
})

describe('the detail sheets', () => {
  it('offer no way to edit, merge, reassign or delete a participant', async () => {
    const user = await openSection('Participants')
    await user.click(screen.getByRole('table', { name: 'Participants' }).querySelectorAll('tbody tr')[0] as HTMLElement)

    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText(/Read\s+only/i)).toBeDefined()

    for (const forbidden of [/^Edit/i, /^Merge/i, /^Delete/i, /^Resolve/i, /^Reassign/i, /^Save/i]) {
      expect(within(sheet).queryByRole('button', { name: forbidden })).toBeNull()
    }
    expect(within(sheet).queryByRole('textbox')).toBeNull()
  })

  it('offer no way to edit, reassign or delete a response', async () => {
    const user = await openSection('Responses')
    await user.click(screen.getByRole('table', { name: 'Responses' }).querySelectorAll('tbody tr')[0] as HTMLElement)

    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText(/Read\s+only/i)).toBeDefined()

    for (const forbidden of [/^Edit/i, /^Merge/i, /^Delete/i, /^Reassign/i, /^Link/i]) {
      expect(within(sheet).queryByRole('button', { name: forbidden })).toBeNull()
    }
    expect(within(sheet).queryByRole('textbox')).toBeNull()
  })
})

describe('needs review is not issue tracking', () => {
  it('offers no resolution controls', async () => {
    await openSection('Needs review')

    for (const forbidden of [
      /^Resolve/i,
      /^Ignore/i,
      /^Dismiss/i,
      /^Mark handled/i,
      /^Link participant/i,
      /^Merge/i,
    ]) {
      expect(screen.queryByRole('button', { name: forbidden })).toBeNull()
    }

    // The sentence wraps in the source, so it is matched on the paragraph's
    // own text rather than with a regex over a single text node.
    expect(
      screen
        .getAllByText(
          (_, element) =>
            element?.tagName === 'P' &&
            (element.textContent ?? '').includes(
              'Nothing here can be merged, linked, deleted or marked resolved',
            ),
        )
        .length,
    ).toBeGreaterThan(0)
  })

  it('puts the counts on the category controls', async () => {
    await openSection('Needs review')

    const categories = screen.getByRole('group', { name: 'Review category' })
    expect(within(categories).getByText('3')).toBeDefined()
    expect(within(categories).getByText('1')).toBeDefined()
    expect(within(categories).getByText('4')).toBeDefined()
    expect(within(categories).getByText('227')).toBeDefined()
  })
})

describe('duplicates', () => {
  it('offers no merge, delete or confirm control', async () => {
    await openSection('Duplicates')

    for (const forbidden of [/^Merge/i, /^Delete/i, /^Confirm/i, /^Not a duplicate/i]) {
      expect(screen.queryByRole('button', { name: forbidden })).toBeNull()
    }

    expect(screen.getByText(/Merging is not available/i)).toBeDefined()
    expect(screen.getByText(/Names are never matched on/i)).toBeDefined()
  })

  it('names the field the pair matched on', async () => {
    await openSection('Duplicates')

    expect(screen.getByText(/Matched on: Same phone and email/)).toBeDefined()
    expect(screen.getByText(/Matched on: Same phone$/)).toBeDefined()
    expect(screen.getByText(/Matched on: Same email/)).toBeDefined()
  })
})

describe('export', () => {
  it('makes the PII risk the first thing on the section', async () => {
    await openSection('Export')

    const alerts = screen.getAllByRole('alert')
    expect(alerts[0]?.textContent).toContain('participant contact details')
    expect(alerts[0]?.textContent).toContain('leave this protected workspace')
  })

  it('keeps every format and leads with the workbook', async () => {
    await openSection('Export')

    expect(screen.getByText('Full workbook (XLSX)')).toBeDefined()
    expect(screen.getByText('Participants (CSV)')).toBeDefined()
    expect(screen.getByText('Responses (CSV)')).toBeDefined()
    expect(screen.getByText('Possible duplicates (CSV)')).toBeDefined()
  })

  it('describes the six sheets the workbook actually has', async () => {
    await openSection('Export')

    /*
     * Read from `server/reporting/exportXlsx.ts`, not from the production
     * panel's description, which lists five and omits Participant Feedback.
     */
    for (const sheet of [
      'Summary',
      'Participant Feedback',
      'Registrations',
      'Feedback',
      'Duplicate Candidates',
      'Metadata',
    ]) {
      expect(screen.getByText(sheet)).toBeDefined()
    }
  })

  it('prepares one export at a time and names what was downloaded', async () => {
    const user = await openSection('Export')

    await user.click(screen.getByRole('button', { name: 'Download workbook' }))

    expect(screen.getByRole('button', { name: 'Preparing…' })).toHaveProperty(
      'disabled',
      true,
    )
    for (const other of screen.getAllByRole('button', { name: 'Download' })) {
      expect(other).toHaveProperty('disabled', true)
    }

    expect(
      await screen.findByText(/Downloaded ff-rc-2026-08-23-report/, undefined, {
        timeout: 4000,
      }),
    ).toBeDefined()
  })
})

describe('search privacy', () => {
  it('never offers a shareable filtered link or a search history', async () => {
    await openSection('Participants')

    expect(
      screen.getByText(/never placed in the address bar/i),
    ).toBeDefined()

    for (const forbidden of [/^Copy link/i, /^Share/i, /^Recent searches/i]) {
      expect(screen.queryByRole('button', { name: forbidden })).toBeNull()
    }
    expect(window.location.search).toBe('')
  })
})
