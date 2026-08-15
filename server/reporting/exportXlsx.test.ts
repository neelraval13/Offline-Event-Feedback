import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { FLYING_FLEA_QUESTIONS } from './campaign.js'
import { buildWorkbook } from './exportXlsx.js'
import { FEEDBACK_CSV_HEADER, REGISTRATION_CSV_HEADER, DUPLICATE_CSV_HEADER } from './exportCsv.js'
import type { CampaignAnalytics, FeedbackAnalytics, OverviewResponse, RunDescriptor } from './types.js'

/*
 * The workbook an organiser actually opens.
 *
 * These tests build a real XLSX and read it back through `exceljs`, rather than
 * asserting on the input, because the defect they exist for was invisible in
 * the data: the Overview screen reported the campaign figures correctly while
 * the workbook's Summary sheet showed a column of `feedback-v1` zeros above
 * them. Both were computed from the same overview. Only the sheet was wrong.
 *
 * No database and no production data: every figure below is a fixture.
 */

const RUN: RunDescriptor = {
  runId: '019ffc65-4559-7125-9453-de82fb849ed8',
  eventId: 'ff-rc-2026-08-23',
  engineVersion: 'reconciliation-v1',
  startedAt: '2026-08-23T12:00:00.000Z',
  completedAt: '2026-08-23T12:00:04.000Z',
  counts: {
    registrationCount: 14,
    feedbackCount: 12,
    matchedRegistrations: 11,
    registrationsWithoutFeedback: 2,
    registrationsWithMultipleFeedback: 1,
    matchedFeedback: 11,
    feedbackWithoutRegistration: 1,
    feedbackIdentityConflicts: 0,
    feedbackInMultipleGroups: 2,
    duplicateRegistrationCandidateCount: 1,
  },
}

/** A questionnaire nobody at this event was asked. */
const NO_LEGACY: FeedbackAnalytics = {
  analysedResponses: 0,
  averageOverallRating: null,
  ratingCounts: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
  experienceCounts: { very_poor: 0, poor: 0, okay: 0, good: 0, excellent: 0 },
  recommendYes: 0,
  recommendNo: 0,
  recommendPercentage: null,
  unreadableFormVersions: 0,
}

const SOME_LEGACY: FeedbackAnalytics = {
  analysedResponses: 4,
  averageOverallRating: 4.25,
  ratingCounts: { '1': 0, '2': 0, '3': 1, '4': 1, '5': 2 },
  experienceCounts: { very_poor: 0, poor: 0, okay: 1, good: 1, excellent: 2 },
  recommendYes: 3,
  recommendNo: 1,
  recommendPercentage: 75,
  unreadableFormVersions: 0,
}

/** Distribution shaped so every question's numbers are distinguishable. */
function distribution(
  counts: Partial<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, number>>,
): Record<1 | 2 | 3 | 4 | 5 | 6 | 7, number> {
  return {
    1: counts[1] ?? 0,
    2: counts[2] ?? 0,
    3: counts[3] ?? 0,
    4: counts[4] ?? 0,
    5: counts[5] ?? 0,
    6: counts[6] ?? 0,
    7: counts[7] ?? 0,
  }
}

const RATING_KEYS = ['testRideExperience', 'rotaryKnobUsage', 'rideModesExperience', 'overallExperienceRating'] as const

/** Canonical wording, read from the shared definition rather than retyped. */
function promptFor(key: string): string {
  const question = FLYING_FLEA_QUESTIONS.find((entry) => entry.key === key)
  if (question === undefined) {
    throw new Error(`no canonical question for ${key}`)
  }
  return question.prompt
}

const CAMPAIGN: CampaignAnalytics = {
  formVersion: 'flying-flea-feedback-v1',
  analysedResponses: 11,
  unreadableFormVersions: 0,
  ratings: [
    {
      key: RATING_KEYS[0],
      prompt: promptFor(RATING_KEYS[0]),
      average: 6.1,
      responses: 11,
      distribution: distribution({ 7: 5, 6: 3, 5: 2, 4: 1 }),
    },
    {
      key: RATING_KEYS[1],
      prompt: promptFor(RATING_KEYS[1]),
      average: 5.4,
      responses: 10,
      distribution: distribution({ 7: 2, 6: 3, 5: 3, 4: 1, 3: 1 }),
    },
    {
      key: RATING_KEYS[2],
      prompt: promptFor(RATING_KEYS[2]),
      average: 5.9,
      responses: 11,
      distribution: distribution({ 7: 4, 6: 4, 5: 2, 2: 1 }),
    },
    {
      key: RATING_KEYS[3],
      prompt: promptFor(RATING_KEYS[3]),
      average: 6.4,
      responses: 11,
      distribution: distribution({ 7: 7, 6: 2, 5: 2 }),
    },
  ],
  textAnswers: { topThreeFeatures: 8, overallExperienceComments: 6 },
}

const NO_CAMPAIGN: CampaignAnalytics = {
  formVersion: 'flying-flea-feedback-v1',
  analysedResponses: 0,
  unreadableFormVersions: 0,
  ratings: [],
  textAnswers: { topThreeFeatures: 0, overallExperienceComments: 0 },
}

function overview(
  analytics: FeedbackAnalytics,
  campaignAnalytics: CampaignAnalytics,
  responsesByFormVersion: Record<string, number>,
): OverviewResponse {
  return {
    eventId: RUN.eventId,
    run: RUN,
    isHistoricalRun: false,
    freshness: {
      dataChangedSinceRun: false,
      currentRegistrationCount: 14,
      currentFeedbackCount: 12,
      registrationsAddedSinceRun: 0,
      feedbackAddedSinceRun: 0,
      latestContentChangeAt: '2026-08-23T11:58:00.000Z',
    },
    analytics,
    campaignAnalytics,
    responsesByFormVersion,
    unreadableResponses: 0,
    coverage: {
      registrationsWithFeedback: 12,
      totalRegistrations: 14,
      percentage: 85.7,
    },
  }
}

/** Builds the workbook and reads it back, as an organiser's spreadsheet would. */
async function readBack(input: OverviewResponse): Promise<ExcelJS.Workbook> {
  const buffer = await buildWorkbook({
    overview: input,
    registrations: [],
    feedback: [],
    duplicates: [],
    generatedAt: new Date('2026-08-23T13:00:00.000Z'),
  })

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  return workbook
}

/** Every `Measure -> Value` pair on a two-column sheet, as strings. */
function pairs(sheet: ExcelJS.Worksheet | undefined): Map<string, string> {
  const found = new Map<string, string>()
  sheet?.eachRow((row, index) => {
    if (index === 1) return // header
    const measure = String(row.getCell(1).value ?? '')
    if (measure.length === 0) return
    found.set(measure, String(row.getCell(2).value ?? ''))
  })
  return found
}

const FLYING_FLEA_ONLY = overview(NO_LEGACY, CAMPAIGN, {
  'flying-flea-feedback-v1': 11,
})

describe('a Flying Flea workbook', () => {
  it('keeps the five sheets an export has always had', async () => {
    const workbook = await readBack(FLYING_FLEA_ONLY)

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Summary',
      'Registrations',
      'Feedback',
      'Duplicate Candidates',
      'Metadata',
    ])
  })

  it('keeps every raw export column, including the campaign answers', async () => {
    /*
     * The raw sheets are a contract. Something downstream reads them by column
     * name, and this pass is presentation only.
     */
    const workbook = await readBack(FLYING_FLEA_ONLY)

    const header = (name: string): string[] =>
      (workbook.getWorksheet(name)?.getRow(1).values as unknown[])
        .slice(1)
        .map((value) => String(value))

    expect(header('Registrations')).toEqual([...REGISTRATION_CSV_HEADER])
    expect(header('Feedback')).toEqual([...FEEDBACK_CSV_HEADER])
    expect(header('Duplicate Candidates')).toEqual([...DUPLICATE_CSV_HEADER])

    // The Flying Flea answer columns specifically.
    for (const column of [
      'test_ride_experience_rating',
      'rotary_knob_rating',
      'ride_modes_rating',
      'overall_experience_rating',
      'top_three_features',
      'overall_experience_comments',
    ]) {
      expect(header('Feedback')).toContain(column)
    }
  })

  it('reports the event and reconciliation counts', async () => {
    const summary = pairs((await readBack(FLYING_FLEA_ONLY)).getWorksheet('Summary'))

    expect(summary.get('Event')).toBe('ff-rc-2026-08-23')
    expect(summary.get('Reconciliation run')).toBe(RUN.runId)
    expect(summary.get('Registrations in run')).toBe('14')
    expect(summary.get('Feedback in run')).toBe('12')
    expect(summary.get('Matched registrations')).toBe('11')
    expect(summary.get('Possible duplicate registration pairs')).toBe('1')
  })

  it('reports response coverage', async () => {
    const summary = pairs((await readBack(FLYING_FLEA_ONLY)).getWorksheet('Summary'))

    expect(
      summary.get('Response coverage (registrations with any valid feedback)'),
    ).toBe('12')
    expect(summary.get('Response coverage %')).toBe('85.7')
    expect(summary.get('Responses by questionnaire')).toBe(
      'flying-flea-feedback-v1: 11',
    )
  })

  it('reports how many Flying Flea responses were analysed', async () => {
    const summary = pairs((await readBack(FLYING_FLEA_ONLY)).getWorksheet('Summary'))

    expect(summary.get('Flying Flea responses analysed')).toBe('11')
  })

  it('names all four questions in the campaign’s own words', async () => {
    const summary = pairs((await readBack(FLYING_FLEA_ONLY)).getWorksheet('Summary'))

    for (const key of RATING_KEYS) {
      // The canonical prompt, not the answer key: nobody opening a spreadsheet
      // should have to know what `rotaryKnobUsage` means.
      expect(summary.has(promptFor(key))).toBe(true)
    }
    expect(summary.has('rotaryKnobUsage')).toBe(false)
  })

  it('gives every rating question its average, its answered count and its spread', async () => {
    /*
     * Read positionally, because each question repeats the same sub-labels: the
     * rows under a prompt belong to that prompt.
     */
    const sheet = (await readBack(FLYING_FLEA_ONLY)).getWorksheet('Summary')
    const rows: [string, string][] = []
    sheet?.eachRow((row) => {
      rows.push([
        String(row.getCell(1).value ?? ''),
        String(row.getCell(2).value ?? ''),
      ])
    })

    for (const rating of CAMPAIGN.ratings) {
      const start = rows.findIndex(([measure]) => measure === rating.prompt)
      expect(start).toBeGreaterThan(-1)

      const block = new Map(rows.slice(start + 1, start + 11))

      expect(block.get('  Average out of 7')).toBe(String(rating.average))
      expect(block.get('  Answered')).toBe(String(rating.responses))

      for (const value of [7, 6, 5, 4, 3, 2, 1] as const) {
        expect(block.get(`  Rated ${value}`)).toBe(
          String(rating.distribution[value]),
        )
      }
    }
  })

  it('counts the free-text answers', async () => {
    const summary = pairs((await readBack(FLYING_FLEA_ONLY)).getWorksheet('Summary'))

    expect(summary.get('Wrote about top features')).toBe('8')
    expect(summary.get('Wrote about overall experience')).toBe('6')
  })

  it('states the legacy questionnaire as absent rather than as zeros', async () => {
    /*
     * The defect this pass fixes. A column of `feedback-v1` zeros at the top of
     * a Flying Flea workbook reads as "this event collected nothing", and it
     * was the first thing an organiser saw.
     */
    const summary = pairs((await readBack(FLYING_FLEA_ONLY)).getWorksheet('Summary'))

    expect(summary.has('No responses to this questionnaire')).toBe(true)
    expect(summary.get('No responses to this questionnaire')).toContain('feedback-v1')

    for (const legacy of [
      'Analytics responses (matched only)',
      'Average overall rating',
      'Rating 1',
      'Rating 5',
      'Experience excellent',
      'Recommend yes',
      'Recommend %',
    ]) {
      expect(summary.has(legacy)).toBe(false)
    }
  })

  it('puts the campaign figures above the legacy section', async () => {
    const sheet = (await readBack(FLYING_FLEA_ONLY)).getWorksheet('Summary')
    const measures: string[] = []
    sheet?.eachRow((row) => measures.push(String(row.getCell(1).value ?? '')))

    const campaign = measures.findIndex((m) => m.startsWith('FLYING FLEA FEEDBACK'))
    const legacy = measures.findIndex((m) => m.startsWith('LEGACY FEEDBACK'))
    const event = measures.indexOf('EVENT AND RECONCILIATION')

    expect(event).toBeGreaterThan(-1)
    expect(campaign).toBeGreaterThan(event)
    expect(legacy).toBeGreaterThan(campaign)
  })
})

describe('the workbook metadata', () => {
  it('lists every questionnaire the workbook can read', async () => {
    const metadata = pairs((await readBack(FLYING_FLEA_ONLY)).getWorksheet('Metadata'))

    expect(metadata.get('readableFormVersions')).toBe(
      'feedback-v1, flying-flea-feedback-v1',
    )
    expect(metadata.get('campaignFormVersion')).toBe('flying-flea-feedback-v1')
  })

  it('no longer names one questionnaire as the supported one', async () => {
    /*
     * `supportedFormVersion: feedback-v1` described the legacy analytics reader,
     * but in a workbook whose Feedback sheet is entirely Flying Flea it read as
     * "the only questionnaire this file understands".
     */
    const metadata = pairs((await readBack(FLYING_FLEA_ONLY)).getWorksheet('Metadata'))

    expect(metadata.has('supportedFormVersion')).toBe(false)
    expect(metadata.get('legacyAnalyticsFormVersion')).toBe('feedback-v1')
    expect(metadata.get('formVersionRule')).toContain('flying-flea-feedback-v1')
  })

  it('keeps the rules that explain what the numbers mean', async () => {
    const metadata = pairs((await readBack(FLYING_FLEA_ONLY)).getWorksheet('Metadata'))

    for (const rule of [
      'membershipRule',
      'analyticsInclusionRule',
      'coverageRule',
      'multipleFeedbackRule',
      'snapshotCaveat',
    ]) {
      expect(metadata.get(rule)?.length ?? 0).toBeGreaterThan(40)
    }
    expect(metadata.get('eventId')).toBe('ff-rc-2026-08-23')
  })
})

describe('a legacy workbook still reports its own figures', () => {
  const LEGACY_ONLY = overview(SOME_LEGACY, NO_CAMPAIGN, { 'feedback-v1': 4 })

  it('renders the feedback-v1 analytics unchanged', async () => {
    const summary = pairs((await readBack(LEGACY_ONLY)).getWorksheet('Summary'))

    expect(summary.get('Analytics responses (matched only)')).toBe('4')
    expect(summary.get('Average overall rating')).toBe('4.25')
    expect(summary.get('Rating 3')).toBe('1')
    expect(summary.get('Rating 5')).toBe('2')
    expect(summary.get('Experience excellent')).toBe('2')
    expect(summary.get('Recommend yes')).toBe('3')
    expect(summary.get('Recommend no')).toBe('1')
    expect(summary.get('Recommend %')).toBe('75')
  })

  it('omits the Flying Flea section when nobody answered it', async () => {
    const summary = pairs((await readBack(LEGACY_ONLY)).getWorksheet('Summary'))

    expect(summary.has('Flying Flea responses analysed')).toBe(false)
    expect(summary.has('Wrote about top features')).toBe(false)
  })
})

describe('an event that collected both questionnaires', () => {
  const BOTH = overview(SOME_LEGACY, CAMPAIGN, {
    'flying-flea-feedback-v1': 11,
    'feedback-v1': 4,
  })

  it('reports each on its own terms, in one workbook', async () => {
    const summary = pairs((await readBack(BOTH)).getWorksheet('Summary'))

    expect(summary.get('Flying Flea responses analysed')).toBe('11')
    expect(summary.get('Analytics responses (matched only)')).toBe('4')

    // Two scales, never mixed: 6.4 out of 7 and 4.25 out of 5 are both present
    // and neither has been folded into the other.
    expect(summary.get('Average overall rating')).toBe('4.25')
    expect(summary.get('Responses by questionnaire')).toBe(
      'flying-flea-feedback-v1: 11, feedback-v1: 4',
    )
  })
})
