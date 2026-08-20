import { describe, expect, it } from 'vitest'
import { FLYING_FLEA_FORM_VERSION } from '../../../shared/campaign/flyingFlea'
import { FEEDBACK_FORM_VERSION } from '../../types'
import type { FeedbackRow } from '../../lib/reporting/types'
import { ratingCell } from './ratingCell'

/*
 * The Rating column, per questionnaire.
 *
 * The defect: the column rendered `row.overallRating`, the `feedback-v1`
 * answer, for every row. A Flying Flea response carrying
 * `campaignSummary.overallExperienceRating = 5` therefore listed as `None`,
 * while the Overview on the same screen said "Overall experience: 5 / 7" from
 * the same run. Nothing was wrong with the stored answer; the column was
 * reading a field that questionnaire never fills.
 */

function row(overrides: Partial<FeedbackRow>): FeedbackRow {
  return {
    recordId: '019ffc65-4559-7125-9453-de82fb849ed8',
    publicCode: 'B1-B8EFD9-00001-X',
    participantId: '019ffc65-4559-7125-9453-e230415644f1',
    captureMethod: 'qr',
    formVersion: FLYING_FLEA_FORM_VERSION,
    createdAt: '2026-08-23T10:12:00.000Z',
    revision: 1,
    reconciliationStatus: 'matched',
    matchMethod: 'qr_identity',
    overallRating: null,
    experience: null,
    recommend: null,
    campaignSummary: null,
    linkedRegistration: null,
    respondentName: null,
    respondentPhone: null,
    respondentEmail: null,
    ...overrides,
  }
}

function campaignSummary(overallExperienceRating: number | null) {
  return {
    testRideExperience: 6,
    rotaryKnobUsage: 5,
    rideModesExperience: 6,
    overallExperienceRating,
  }
}

describe('a Flying Flea response', () => {
  it('reads its rating from the campaign summary, on its own scale', () => {
    const cell = ratingCell(
      row({
        formVersion: FLYING_FLEA_FORM_VERSION,
        campaignSummary: campaignSummary(5),
      }),
    )

    expect(cell).toBe('5 / 7')
  })

  it('is never read through the legacy field', () => {
    /*
     * The exact production row: a campaign response whose `overallRating` is
     * null, because that key belongs to the other questionnaire. It used to
     * print `None`.
     */
    const cell = ratingCell(
      row({
        formVersion: FLYING_FLEA_FORM_VERSION,
        overallRating: null,
        campaignSummary: campaignSummary(5),
      }),
    )

    expect(cell).not.toBe('None')
    expect(cell).toBe('5 / 7')
  })

  it('carries the scale, so a 5 cannot be read as five out of five', () => {
    for (const rating of [1, 4, 7]) {
      expect(
        ratingCell(
          row({
            formVersion: FLYING_FLEA_FORM_VERSION,
            campaignSummary: campaignSummary(rating),
          }),
        ),
      ).toBe(`${rating} / 7`)
    }
  })

  it('says None when the summary genuinely holds no rating', () => {
    expect(
      ratingCell(
        row({
          formVersion: FLYING_FLEA_FORM_VERSION,
          campaignSummary: campaignSummary(null),
        }),
      ),
    ).toBe('None')

    expect(
      ratingCell(
        row({ formVersion: FLYING_FLEA_FORM_VERSION, campaignSummary: null }),
      ),
    ).toBe('None')
  })
})

describe('a legacy feedback-v1 response', () => {
  it('keeps the display it has always had', () => {
    expect(
      ratingCell(row({ formVersion: FEEDBACK_FORM_VERSION, overallRating: 4 })),
    ).toBe('4')
  })

  it('still shows None when it was not rated', () => {
    expect(
      ratingCell(
        row({ formVersion: FEEDBACK_FORM_VERSION, overallRating: null }),
      ),
    ).toBe('None')
  })

  it('ignores a campaign summary that does not belong to it', () => {
    // Defensive: the two questionnaires never share a row, and if a future one
    // did, the version decides which field is read.
    expect(
      ratingCell(
        row({
          formVersion: FEEDBACK_FORM_VERSION,
          overallRating: 3,
          campaignSummary: campaignSummary(7),
        }),
      ),
    ).toBe('3')
  })
})

describe('a questionnaire this build has never seen', () => {
  it('says so rather than pretending the rider did not answer', () => {
    /*
     * `None` would be a claim about the response. The answers are stored and
     * exported in full; what cannot be shown is a number on a scale this build
     * does not know.
     */
    const cell = ratingCell(
      row({ formVersion: 'some-future-questionnaire-v3', overallRating: null }),
    )

    expect(cell).toBe('Not available')
    expect(cell).not.toBe('None')
  })
})
