import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FLYING_FLEA_FORM_VERSION } from '../../../shared/campaign/flyingFlea'
import type { FeedbackRow } from '../../lib/reporting/types'
import { ResponseSummary } from './ResponseSummary'

/*
 * What a participant's response list says about each response.
 *
 * The bug this covers: a campaign response was reported as one "this build
 * cannot summarise", on a build that reads that questionnaire perfectly well and
 * renders every answer on the detail view beside it. The message was true only
 * of the code path, not of the system, and an organiser reading it would
 * reasonably conclude the data was unusable.
 */

afterEach(cleanup)

function row(overrides: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    recordId: '22222222-2222-4222-8222-222222222222',
    publicCode: 'A1-B8EFD9-00001-X',
    participantId: null,
    captureMethod: 'qr',
    formVersion: 'feedback-v1',
    createdAt: '2026-01-01T11:00:00.000Z',
    revision: 1,
    reconciliationStatus: 'matched',
    matchMethod: 'qr_identity',
    overallRating: 4,
    experience: 'good',
    recommend: true,
    campaignSummary: null,
    linkedRegistration: null,
    ...overrides,
  }
}

const CAMPAIGN_SUMMARY = {
  testRideExperience: 7,
  rotaryKnobUsage: 6,
  rideModesExperience: 5,
  overallExperienceRating: 7,
}

function campaignRow(overrides: Partial<FeedbackRow> = {}): FeedbackRow {
  return row({
    formVersion: FLYING_FLEA_FORM_VERSION,
    overallRating: null,
    experience: null,
    recommend: null,
    campaignSummary: CAMPAIGN_SUMMARY,
    ...overrides,
  })
}

describe('feedback-v1', () => {
  it('keeps its compact legacy summary', () => {
    render(<ResponseSummary response={row()} />)

    expect(document.body.textContent).toContain('Rated 4')
    expect(document.body.textContent).toContain('good')
    expect(document.body.textContent).toContain('would recommend')
  })

  it('says so when the rider would not recommend', () => {
    render(<ResponseSummary response={row({ recommend: false })} />)

    expect(document.body.textContent).toContain('would not recommend')
  })
})

describe('flying-flea-feedback-v1', () => {
  it('summarises the campaign questionnaire on its own scale', () => {
    render(<ResponseSummary response={campaignRow()} />)
    const text = document.body.textContent ?? ''

    expect(text).toContain('Flying Flea feedback')
    expect(text).toContain('Test ride 7/7')
    expect(text).toContain('Rotary knob 6/7')
    expect(text).toContain('Ride modes 5/7')
  })

  it('includes the overall rating', () => {
    render(<ResponseSummary response={campaignRow()} />)

    expect(document.body.textContent).toContain('Overall 7/7')
  })

  it('never claims the build cannot read it', () => {
    // The regression, stated directly.
    render(<ResponseSummary response={campaignRow()} />)

    expect(document.body.textContent).not.toContain('cannot summarise')
  })

  it('shows a dash for a question the rider skipped', () => {
    render(
      <ResponseSummary
        response={campaignRow({
          campaignSummary: { ...CAMPAIGN_SUMMARY, rotaryKnobUsage: null },
        })}
      />,
    )

    expect(document.body.textContent).toContain('Rotary knob not rated')
    expect(document.body.textContent).toContain('Overall 7/7')
  })
})

describe('an unknown questionnaire', () => {
  it('keeps the safe fallback and names the version', () => {
    render(
      <ResponseSummary
        response={row({
          formVersion: 'flying-flea-feedback-v2',
          overallRating: null,
          experience: null,
          recommend: null,
        })}
      />,
    )
    const text = document.body.textContent ?? ''

    expect(text).toContain('flying-flea-feedback-v2')
    expect(text).toContain('cannot summarise')
  })

  it('falls back rather than guessing when a campaign summary is missing', () => {
    // Declared as the campaign questionnaire but carrying no campaign answers:
    // a shape the server should never produce, and not one to invent numbers for.
    render(
      <ResponseSummary
        response={row({ formVersion: FLYING_FLEA_FORM_VERSION })}
      />,
    )

    expect(document.body.textContent).toContain('cannot summarise')
  })
})

describe('a participant with several responses', () => {
  it('summarises each one without electing one of them', () => {
    /*
     * Both are rendered, each on its own terms. Nothing marks either as the
     * participant's answer: the reconciliation run chose no winner, and a list
     * that summarised only one would quietly overrule it.
     */
    const first = campaignRow({ recordId: 'first' })
    const second = campaignRow({
      recordId: 'second',
      campaignSummary: { ...CAMPAIGN_SUMMARY, overallExperienceRating: 2 },
    })

    render(
      <ul>
        <li>
          <ResponseSummary response={first} />
        </li>
        <li>
          <ResponseSummary response={second} />
        </li>
      </ul>,
    )

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toContain('Overall 7/7')
    expect(items[1]?.textContent).toContain('Overall 2/7')
  })
})
