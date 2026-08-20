import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { FLYING_FLEA_QUESTIONS } from './campaign.js'
import { buildWorkbook } from './exportXlsx.js'
import { FEEDBACK_CSV_HEADER, REGISTRATION_CSV_HEADER, DUPLICATE_CSV_HEADER } from './exportCsv.js'
import type { FeedbackExportRow, RegistrationExportRow } from './postgres.js'
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
    standaloneFeedback: 0,
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
      directResponses: 0,
    },
  }
}

/** Builds the workbook and reads it back, as an organiser's spreadsheet would. */
async function readBack(
  input: OverviewResponse,
  rows: {
    registrations?: readonly RegistrationExportRow[]
    feedback?: readonly FeedbackExportRow[]
  } = {},
): Promise<ExcelJS.Workbook> {
  const buffer = await buildWorkbook({
    overview: input,
    registrations: rows.registrations ?? [],
    feedback: rows.feedback ?? [],
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
  it('keeps every sheet an export has, with the readable one near the front', async () => {
    const workbook = await readBack(FLYING_FLEA_ONLY)

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Summary',
      'Participant Feedback',
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

/* ------------------------------------------------------------------ *
 * Participant Feedback
 *
 * The convenience join. Every case below is one the reconciliation engine can
 * actually produce, and the point of each is that the sheet reports what the
 * run decided rather than deciding anything itself.
 * ------------------------------------------------------------------ */

function registration(
  overrides: Partial<RegistrationExportRow> & { recordId: string },
): RegistrationExportRow {
  return {
    participantId: `participant-${overrides.recordId}`,
    publicCode: 'A1-B8EFD9-00001-X',
    name: 'Ada Lovelace',
    phone: '9876543210',
    email: 'ada@example.com',
    vehicle: 'Vehicle 2',
    interestedColour: 'Storm Black',
    location: 'Richardson & Cruddas',
    gender: 'Female',
    testRideAt: '2026-08-23T15:42',
    drivingLicence: 'KA0120200001234',
    pincode: '560048',
    createdAt: '2026-08-23T10:12:00.000Z',
    revision: 1,
    status: 'matched',
    validFeedbackCount: 1,
    potentialDuplicate: false,
    feedbackRecordId: null,
    captureMethod: null,
    overallRating: null,
    experience: null,
    recommend: null,
    comments: null,
    ...overrides,
  }
}

function response(
  overrides: Partial<FeedbackExportRow> & { recordId: string },
): FeedbackExportRow {
  return {
    publicCode: 'A1-B8EFD9-00001-X',
    participantId: null,
    captureMethod: 'qr',
    respondentName: null,
    respondentPhone: null,
    respondentEmail: null,
    formVersion: 'flying-flea-feedback-v1',
    createdAt: '2026-08-23T16:00:00.000Z',
    revision: 1,
    status: 'matched',
    matchMethod: 'qr_identity',
    registrationRecordId: null,
    registrationPublicCode: null,
    registrationName: null,
    registrationPhone: null,
    registrationEmail: null,
    overallRating: null,
    experience: null,
    recommend: null,
    comments: null,
    testRideExperienceRating: '6',
    rotaryKnobRating: '5',
    rideModesRating: '6',
    overallExperienceRating: '7',
    topThreeFeatures: 'Torque, silence, weight',
    overallExperienceComments: 'Best thing I have ridden.',
    ...overrides,
  }
}

/** The sheet as `column name -> value` per row, in sheet order. */
function participantRows(
  workbook: ExcelJS.Workbook,
): Map<string, string>[] {
  const sheet = workbook.getWorksheet('Participant Feedback')
  const header = ((sheet?.getRow(1).values ?? []) as unknown[])
    .slice(1)
    .map((value) => String(value))
  const rows: Map<string, string>[] = []

  sheet?.eachRow((row, index) => {
    if (index === 1) return
    const entry = new Map<string, string>()
    header.forEach((name, column) => {
      entry.set(name, String(row.getCell(column + 1).value ?? ''))
    })
    rows.push(entry)
  })

  return rows
}

describe('Participant Feedback: a matched rider', () => {
  const REG = registration({ recordId: 'reg-1' })
  const RES = response({ recordId: 'res-1', registrationRecordId: 'reg-1' })

  it('puts Point A and Point B on one row', async () => {
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [REG],
        feedback: [RES],
      }),
    )

    expect(rows).toHaveLength(1)
    const row = rows[0] as Map<string, string>

    expect(row.get('Status')).toBe('Matched')
    expect(row.get('Public Code')).toBe('A1-B8EFD9-00001-X')
    expect(row.get('Name')).toBe('Ada Lovelace')
    expect(row.get('Phone')).toBe('9876543210')
    expect(row.get('Email')).toBe('ada@example.com')
    expect(row.get('Driving Licence')).toBe('KA0120200001234')
    expect(row.get('Gender')).toBe('Female')
    expect(row.get('Pincode')).toBe('560048')
    expect(row.get('Vehicle')).toBe('Vehicle 2')
    expect(row.get('Interested Colour')).toBe('Storm Black')
    expect(row.get('Location')).toBe('Richardson & Cruddas')
    expect(row.get('Test Ride Date & Time')).toBe('2026-08-23T15:42')
  })

  it('carries all six Flying Flea answers', async () => {
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [REG],
        feedback: [RES],
      }),
    )
    const row = rows[0] as Map<string, string>

    expect(row.get('Feedback Capture Method')).toBe('qr')
    expect(row.get('Feedback Form Version')).toBe('flying-flea-feedback-v1')
    expect(row.get('Test Ride Experience / 7')).toBe('6')
    expect(row.get('Rotary Knob Usage / 7')).toBe('5')
    expect(row.get('Ride Modes Experience / 7')).toBe('6')
    expect(row.get('Overall Experience / 7')).toBe('7')
    expect(row.get('Top 3 Features')).toBe('Torque, silence, weight')
    expect(row.get('Overall Experience Comments')).toBe(
      'Best thing I have ridden.',
    )
  })

  it('carries both record identities and both timestamps', async () => {
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [REG],
        feedback: [RES],
      }),
    )
    const row = rows[0] as Map<string, string>

    expect(row.get('Reconciliation Run')).toBe(RUN.runId)
    expect(row.get('Registration Record ID')).toBe('reg-1')
    expect(row.get('Feedback Record ID')).toBe('res-1')
    expect(row.get('Registration Created At')).toBe('2026-08-23T10:12:00.000Z')
    expect(row.get('Feedback Created At')).toBe('2026-08-23T16:00:00.000Z')
  })
})

describe('Participant Feedback: a rider who did not respond', () => {
  it('still appears, with the answer columns blank', async () => {
    /*
     * Dropping these would turn the sheet into "riders who answered", which is
     * a different and much less useful question. Response coverage is a number
     * on the Summary sheet; this is the list behind it.
     */
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [
          registration({
            recordId: 'reg-2',
            status: 'without_feedback',
            validFeedbackCount: 0,
            name: 'Grace Hopper',
          }),
        ],
      }),
    )

    expect(rows).toHaveLength(1)
    const row = rows[0] as Map<string, string>

    expect(row.get('Status')).toBe('No response')
    expect(row.get('Name')).toBe('Grace Hopper')
    expect(row.get('Vehicle')).toBe('Vehicle 2')

    for (const column of [
      'Feedback Capture Method',
      'Feedback Form Version',
      'Test Ride Experience / 7',
      'Overall Experience / 7',
      'Top 3 Features',
      'Overall Experience Comments',
      'Feedback Record ID',
      'Feedback Created At',
    ]) {
      expect(row.get(column)).toBe('')
    }
  })
})

describe('Participant Feedback: a rider with several responses', () => {
  const REG = registration({
    recordId: 'reg-3',
    status: 'multiple_feedback',
    validFeedbackCount: 2,
    name: 'Katherine Johnson',
  })
  const FIRST = response({
    recordId: 'res-a',
    registrationRecordId: 'reg-3',
    status: 'multiple_feedback',
    overallExperienceRating: '4',
    createdAt: '2026-08-23T16:00:00.000Z',
  })
  const SECOND = response({
    recordId: 'res-b',
    registrationRecordId: 'reg-3',
    status: 'multiple_feedback',
    overallExperienceRating: '7',
    createdAt: '2026-08-23T16:30:00.000Z',
  })

  it('renders one row per response, with the rider repeated', async () => {
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [REG],
        feedback: [FIRST, SECOND],
      }),
    )

    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.get('Status')).toBe('Multiple responses')
      expect(row.get('Name')).toBe('Katherine Johnson')
      expect(row.get('Registration Record ID')).toBe('reg-3')
    }
  })

  it('chooses no winner between them', async () => {
    /*
     * The run refused to pick one, and so does this sheet. Both answers are
     * present, distinguishable by their own record IDs, and neither is marked
     * as the participant's.
     */
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [REG],
        feedback: [FIRST, SECOND],
      }),
    )

    expect(rows.map((row) => row.get('Feedback Record ID'))).toEqual([
      'res-a',
      'res-b',
    ])
    expect(rows.map((row) => row.get('Overall Experience / 7'))).toEqual([
      '4',
      '7',
    ])
  })

  it('keeps the rows adjacent', async () => {
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [
          registration({ recordId: 'reg-early', createdAt: '2026-08-23T09:00:00.000Z' }),
          REG,
          registration({
            recordId: 'reg-late',
            createdAt: '2026-08-23T11:00:00.000Z',
            status: 'without_feedback',
          }),
        ],
        feedback: [
          response({ recordId: 'res-early', registrationRecordId: 'reg-early' }),
          FIRST,
          SECOND,
        ],
      }),
    )

    expect(rows.map((row) => row.get('Registration Record ID'))).toEqual([
      'reg-early',
      'reg-3',
      'reg-3',
      'reg-late',
    ])
  })
})

describe('Participant Feedback: responses with no registration', () => {
  it('keeps a response whose rider was never registered', async () => {
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [],
        feedback: [
          response({
            recordId: 'res-orphan',
            status: 'without_registration',
            registrationRecordId: null,
            captureMethod: 'manual',
            publicCode: 'A1-B8EFD9-00042-K',
          }),
        ],
      }),
    )

    expect(rows).toHaveLength(1)
    const row = rows[0] as Map<string, string>

    expect(row.get('Status')).toBe('No registration')
    // The code the operator typed, which is the thing worth seeing.
    expect(row.get('Public Code')).toBe('A1-B8EFD9-00042-K')
    expect(row.get('Overall Experience / 7')).toBe('7')

    for (const column of ['Name', 'Phone', 'Email', 'Vehicle', 'Registration Record ID']) {
      expect(row.get(column)).toBe('')
    }
  })

  it('keeps an identity conflict without inventing a rider for it', async () => {
    /*
     * The engine sets `registration_record_id` to null for a conflict: it is
     * refusing to name a registration. This sheet honours the refusal rather
     * than re-deriving a relationship from the public code.
     */
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [registration({ recordId: 'reg-4' })],
        feedback: [
          response({
            recordId: 'res-conflict',
            status: 'identity_conflict',
            registrationRecordId: null,
          }),
        ],
      }),
    )

    const conflict = rows.find((row) => row.get('Feedback Record ID') === 'res-conflict')
    expect(conflict).toBeDefined()
    expect(conflict?.get('Status')).toBe('Identity conflict')

    for (const column of ['Name', 'Phone', 'Email', 'Registration Record ID']) {
      expect(conflict?.get(column)).toBe('')
    }

    // And it did not get attached to the registration that is also in the run.
    const registered = rows.find((row) => row.get('Registration Record ID') === 'reg-4')
    expect(registered?.get('Feedback Record ID')).toBe('')
  })

  it('places orphan responses after every registered rider', async () => {
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [
          registration({ recordId: 'reg-5', status: 'without_feedback' }),
        ],
        feedback: [
          response({
            recordId: 'res-orphan',
            status: 'without_registration',
            registrationRecordId: null,
            // Earlier than the registration, to prove ordering is by section
            // rather than by timestamp across the whole sheet.
            createdAt: '2026-08-23T08:00:00.000Z',
          }),
        ],
      }),
    )

    expect(rows.map((row) => row.get('Status'))).toEqual([
      'No response',
      'No registration',
    ])
  })
})

describe('Participant Feedback: questionnaire safety', () => {
  it('leaves the campaign columns blank for a feedback-v1 response', async () => {
    /*
     * Those columns are headed "out of 7". A `feedback-v1` rating is out of 5,
     * and printing one under a 7-point heading is a misreading this sheet must
     * not make possible.
     */
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [registration({ recordId: 'reg-6' })],
        feedback: [
          response({
            recordId: 'res-legacy',
            registrationRecordId: 'reg-6',
            formVersion: 'feedback-v1',
            overallRating: '4',
            experience: 'good',
            comments: 'Enjoyed it.',
          }),
        ],
      }),
    )
    const row = rows[0] as Map<string, string>

    expect(row.get('Feedback Form Version')).toBe('feedback-v1')
    expect(row.get('Status')).toBe('Matched')

    for (const column of [
      'Test Ride Experience / 7',
      'Rotary Knob Usage / 7',
      'Ride Modes Experience / 7',
      'Overall Experience / 7',
      'Top 3 Features',
      'Overall Experience Comments',
    ]) {
      expect(row.get(column)).toBe('')
    }
  })

  it('leaves them blank for a questionnaire this build has never seen', async () => {
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [registration({ recordId: 'reg-7' })],
        feedback: [
          response({
            recordId: 'res-future',
            registrationRecordId: 'reg-7',
            // A future questionnaire that happens to reuse the key names on a
            // different scale.
            formVersion: 'some-future-questionnaire-v3',
          }),
        ],
      }),
    )
    const row = rows[0] as Map<string, string>

    expect(row.get('Feedback Form Version')).toBe('some-future-questionnaire-v3')
    expect(row.get('Overall Experience / 7')).toBe('')
    expect(row.get('Top 3 Features')).toBe('')
  })
})

describe('Participant Feedback: spreadsheet safety', () => {
  const HOSTILE = "=cmd|'/c calc'!A0"

  it('writes every participant-derived cell as text, never as a formula', async () => {
    const workbook = await readBack(FLYING_FLEA_ONLY, {
      registrations: [
        registration({
          recordId: 'reg-8',
          name: HOSTILE,
          phone: '+919876543210',
          publicCode: '+A1-B8EFD9-00001-X',
          drivingLicence: '=KA0120200001234',
        }),
      ],
      feedback: [
        response({
          recordId: 'res-8',
          registrationRecordId: 'reg-8',
          topThreeFeatures: '@SUM(1,1)',
          overallExperienceComments: '-1+1',
        }),
      ],
    })

    const sheet = workbook.getWorksheet('Participant Feedback')
    const header = ((sheet?.getRow(1).values ?? []) as unknown[])
      .slice(1)
      .map((value) => String(value))
    const row = sheet?.getRow(2)

    for (const column of [
      'Name',
      'Phone',
      'Public Code',
      'Driving Licence',
      'Top 3 Features',
      'Overall Experience Comments',
    ]) {
      const cell = row?.getCell(header.indexOf(column) + 1)

      expect(cell?.type).toBe(ExcelJS.ValueType.String)
      expect(cell?.formula).toBeUndefined()
      // Text format, so Excel does not coerce it back on entry either.
      expect(cell?.numFmt).toBe('@')
    }
  })

  it('does not truncate a rider’s comment', async () => {
    const long = 'It was brilliant. '.repeat(100).trim()
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [registration({ recordId: 'reg-9' })],
        feedback: [
          response({
            recordId: 'res-9',
            registrationRecordId: 'reg-9',
            overallExperienceComments: long,
          }),
        ],
      }),
    )

    expect(rows[0]?.get('Overall Experience Comments')).toBe(long)
  })

  it('freezes the header and offers a filter', async () => {
    const sheet = (await readBack(FLYING_FLEA_ONLY)).getWorksheet(
      'Participant Feedback',
    )

    expect(sheet?.views?.[0]?.state).toBe('frozen')
    expect(sheet?.autoFilter).toBeDefined()
  })
})

/* ------------------------------------------------------------------ *
 * Participant Feedback: contact identity
 * ------------------------------------------------------------------ */

const RIDER_CONTACT = {
  respondentName: 'Grace Hopper',
  respondentPhone: '9876543210',
  respondentEmail: 'grace@example.com',
} as const

/** A response whose identity is the rider's own details. */
function contactResponse(
  overrides: Partial<FeedbackExportRow> & { recordId: string },
): FeedbackExportRow {
  return response({
    // No sticker, so neither identifier exists. Not empty strings.
    publicCode: null,
    participantId: null,
    captureMethod: 'contact',
    ...RIDER_CONTACT,
    ...overrides,
  })
}

describe('Participant Feedback: a direct response', () => {
  const DIRECT = contactResponse({
    recordId: 'res-direct',
    status: 'standalone',
    matchMethod: null,
    registrationRecordId: null,
  })

  it('names the rider rather than reporting them as anonymous', async () => {
    /*
     * The point of the whole path. A registration-first sheet would either drop
     * this rider or show them as a blank row, and they are the least anonymous
     * feedback the event collected: they typed their own name.
     */
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, { feedback: [DIRECT] }),
    )

    expect(rows).toHaveLength(1)
    const row = rows[0] as Map<string, string>

    expect(row.get('Status')).toBe('Direct feedback')
    expect(row.get('Name')).toBe('Grace Hopper')
    expect(row.get('Phone')).toBe('9876543210')
    expect(row.get('Email')).toBe('grace@example.com')
  })

  it('leaves the code blank and every Point A-only field blank', async () => {
    /*
     * Not an oversight to tidy up later. Nothing in this system knows this
     * rider's vehicle, licence, gender, pincode or ride slot, because nobody
     * ever asked them. A blank cell says exactly that.
     */
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, { feedback: [DIRECT] }),
    )
    const row = rows[0] as Map<string, string>

    expect(row.get('Public Code')).toBe('')
    for (const column of [
      'Driving Licence',
      'Gender',
      'Pincode',
      'Vehicle',
      'Interested Colour',
      'Test Ride Date & Time',
      'Registration Record ID',
      'Registration Created At',
    ]) {
      expect(row.get(column)).toBe('')
    }
  })

  it('carries all six answers and its own record ID', async () => {
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, { feedback: [DIRECT] }),
    )
    const row = rows[0] as Map<string, string>

    expect(row.get('Test Ride Experience / 7')).toBe('6')
    expect(row.get('Rotary Knob Usage / 7')).toBe('5')
    expect(row.get('Ride Modes Experience / 7')).toBe('6')
    expect(row.get('Overall Experience / 7')).toBe('7')
    expect(row.get('Top 3 Features')).toBe('Torque, silence, weight')
    expect(row.get('Feedback Record ID')).toBe('res-direct')
  })

  it('says where its identity came from', async () => {
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, { feedback: [DIRECT] }),
    )

    expect((rows[0] as Map<string, string>).get('Identity Source')).toBe(
      'Contact details, direct',
    )
  })

  it('reads differently from a sticker that resolved to nobody', async () => {
    /*
     * Two rows that look almost identical and mean opposite things: one is the
     * contact path working, the other is a code that led nowhere. If the sheet
     * could not tell them apart, an organiser would either chase riders who are
     * fine or ignore responses that need attention.
     */
    const orphanSticker = response({
      recordId: 'res-orphan',
      status: 'without_registration',
      matchMethod: null,
      registrationRecordId: null,
    })

    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, { feedback: [DIRECT, orphanSticker] }),
    )

    const statuses = rows.map((row) => row.get('Status'))
    expect(statuses).toContain('Direct feedback')
    expect(statuses).toContain('No registration')

    const orphan = rows.find(
      (row) => row.get('Feedback Record ID') === 'res-orphan',
    ) as Map<string, string>
    // A sticker response names nobody: its identity is a code, and the code
    // led nowhere. There is no person attached to it to name.
    expect(orphan.get('Name')).toBe('')
    expect(orphan.get('Public Code')).toBe('A1-B8EFD9-00001-X')
    expect(orphan.get('Identity Source')).toBe('QR sticker')
  })
})

describe('Participant Feedback: a contact response matched to Point A', () => {
  const REG = registration({
    recordId: 'reg-matched',
    name: 'Ada Lovelace',
    phone: '9876543210',
    email: 'ada@example.com',
  })
  const MATCHED = contactResponse({
    recordId: 'res-matched',
    status: 'matched',
    matchMethod: 'contact_identity',
    registrationRecordId: 'reg-matched',
    respondentName: 'Ada L',
    respondentPhone: '9876543210',
    respondentEmail: 'ada@example.com',
  })

  it('joins Point A and Point B on one row, like any other match', async () => {
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [REG],
        feedback: [MATCHED],
      }),
    )

    expect(rows).toHaveLength(1)
    const row = rows[0] as Map<string, string>

    expect(row.get('Status')).toBe('Matched')
    expect(row.get('Public Code')).toBe('A1-B8EFD9-00001-X')
    expect(row.get('Vehicle')).toBe('Vehicle 2')
    expect(row.get('Overall Experience / 7')).toBe('7')
    expect(row.get('Registration Record ID')).toBe('reg-matched')
    expect(row.get('Feedback Record ID')).toBe('res-matched')
  })

  it('shows the registration’s name in the main columns', async () => {
    // A compiled row about a rider shows what the event recorded about that
    // rider. The registration is what the event recorded.
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [REG],
        feedback: [MATCHED],
      }),
    )
    const row = rows[0] as Map<string, string>

    expect(row.get('Name')).toBe('Ada Lovelace')
    expect(row.get('Email')).toBe('ada@example.com')
  })

  it('keeps what the rider actually typed, in the audit columns', async () => {
    /*
     * The two are usually identical, and the times they are not are exactly the
     * times somebody needs both: a rider who gave a different name at the two
     * desks, a number transposed at one of them. Keeping only the
     * registration's copy hides the difference that explains the match.
     */
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [REG],
        feedback: [MATCHED],
      }),
    )
    const row = rows[0] as Map<string, string>

    expect(row.get('Respondent Name (as entered)')).toBe('Ada L')
    expect(row.get('Respondent Phone (as entered)')).toBe('9876543210')
    expect(row.get('Respondent Email (as entered)')).toBe('ada@example.com')
  })

  it('is traceable back to how it matched', async () => {
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [REG],
        feedback: [MATCHED],
      }),
    )

    expect((rows[0] as Map<string, string>).get('Identity Source')).toBe(
      'Contact details, matched to Point A',
    )
  })

  it('is distinguishable from a scanned match at a glance', async () => {
    const scanned = response({
      recordId: 'res-scanned',
      registrationRecordId: 'reg-scanned',
    })
    const scannedReg = registration({ recordId: 'reg-scanned' })

    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [REG, scannedReg],
        feedback: [MATCHED, scanned],
      }),
    )

    const sources = rows.map((row) => row.get('Identity Source'))
    expect(sources).toContain('Contact details, matched to Point A')
    expect(sources).toContain('QR sticker')
    // Both are matches, and the sheet says so without hiding how it knows.
    expect(rows.every((row) => row.get('Status') === 'Matched')).toBe(true)
  })

  it('leaves the audit columns blank on a sticker match', async () => {
    const scannedReg = registration({ recordId: 'reg-scanned' })
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [scannedReg],
        feedback: [
          response({ recordId: 'res-scanned', registrationRecordId: 'reg-scanned' }),
        ],
      }),
    )
    const row = rows[0] as Map<string, string>

    for (const column of [
      'Respondent Name (as entered)',
      'Respondent Phone (as entered)',
      'Respondent Email (as entered)',
    ]) {
      expect(row.get(column)).toBe('')
    }
  })
})

describe('Participant Feedback: an ambiguous contact identity', () => {
  const CONFLICT = contactResponse({
    recordId: 'res-conflict',
    status: 'identity_conflict',
    matchMethod: null,
    registrationRecordId: null,
  })

  it('keeps the rider’s details and invents no registration', async () => {
    /*
     * The phone and email pair matched more than one registration, so there is
     * no single rider this could be from. The run refused to choose and so does
     * the sheet, but the response is not thereby anonymous: the rider typed
     * their details and those are still the best account of who they are.
     */
    const unrelated = registration({ recordId: 'reg-unrelated' })

    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [unrelated],
        feedback: [CONFLICT],
      }),
    )

    const row = rows.find(
      (entry) => entry.get('Feedback Record ID') === 'res-conflict',
    ) as Map<string, string>

    expect(row.get('Status')).toBe('Identity conflict')
    expect(row.get('Name')).toBe('Grace Hopper')
    expect(row.get('Phone')).toBe('9876543210')
    expect(row.get('Email')).toBe('grace@example.com')
    expect(row.get('Registration Record ID')).toBe('')
    expect(row.get('Vehicle')).toBe('')
  })

  it('keeps the answers visible', async () => {
    // The response is preserved in full. It is the attribution that is in
    // doubt, not what the rider said.
    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, { feedback: [CONFLICT] }),
    )
    const row = rows[0] as Map<string, string>

    expect(row.get('Overall Experience / 7')).toBe('7')
    expect(row.get('Top 3 Features')).toBe('Torque, silence, weight')
    expect(row.get('Feedback Record ID')).toBe('res-conflict')
  })

  it('does not attach itself to an unrelated registration in the run', async () => {
    // The run's own status for a registration with nothing attached to it.
    const unrelated = registration({
      recordId: 'reg-unrelated',
      status: 'without_feedback',
      validFeedbackCount: 0,
    })

    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [unrelated],
        feedback: [CONFLICT],
      }),
    )

    const registrationRow = rows.find(
      (entry) => entry.get('Registration Record ID') === 'reg-unrelated',
    ) as Map<string, string>

    expect(registrationRow.get('Status')).toBe('No response')
    expect(registrationRow.get('Feedback Record ID')).toBe('')
  })
})

describe('Participant Feedback: all three paths in one sheet', () => {
  it('orders registered riders first and every orphan last', async () => {
    /*
     * A direct response timestamped before every registration still sorts to
     * the end. Ordering is by section, not by clock: the sheet's shape is what
     * makes it readable, and device clocks are never aligned anyway.
     */
    const reg = registration({
      recordId: 'reg-1',
      createdAt: '2026-08-23T12:00:00.000Z',
    })
    const scanned = response({
      recordId: 'res-scanned',
      registrationRecordId: 'reg-1',
      createdAt: '2026-08-23T13:00:00.000Z',
    })
    const early = contactResponse({
      recordId: 'res-early',
      status: 'standalone',
      matchMethod: null,
      registrationRecordId: null,
      createdAt: '2026-08-23T09:00:00.000Z',
    })

    const rows = participantRows(
      await readBack(FLYING_FLEA_ONLY, {
        registrations: [reg],
        feedback: [early, scanned],
      }),
    )

    expect(rows.map((row) => row.get('Feedback Record ID'))).toEqual([
      'res-scanned',
      'res-early',
    ])
  })

  it('is deterministic: the same run produces the same sheet', async () => {
    const reg = registration({ recordId: 'reg-1' })
    const input = {
      registrations: [reg],
      feedback: [
        response({ recordId: 'res-a', registrationRecordId: 'reg-1' }),
        contactResponse({
          recordId: 'res-b',
          status: 'standalone',
          matchMethod: null,
          registrationRecordId: null,
        }),
      ],
    }

    const first = participantRows(await readBack(FLYING_FLEA_ONLY, input))
    const second = participantRows(await readBack(FLYING_FLEA_ONLY, input))

    expect(second.map((row) => [...row])).toEqual(first.map((row) => [...row]))
  })

  it('writes the contact columns as text, with the formula guard applied', async () => {
    // Participant text is untrusted spreadsheet input whichever field it
    // arrived in. `=cmd|...` in a name must not become a formula.
    const workbook = await readBack(FLYING_FLEA_ONLY, {
      feedback: [
        contactResponse({
          recordId: 'res-hostile',
          status: 'standalone',
          matchMethod: null,
          registrationRecordId: null,
          respondentName: "=cmd|'/c calc'!A0",
          respondentPhone: '+919876543210',
        }),
      ],
    })

    const sheet = workbook.getWorksheet('Participant Feedback')
    const header = ((sheet?.getRow(1).values ?? []) as unknown[])
      .slice(1)
      .map((value) => String(value))

    for (const column of ['Name', 'Phone']) {
      const cell = sheet?.getRow(2).getCell(header.indexOf(column) + 1)
      expect(cell?.type).toBe(ExcelJS.ValueType.String)
      expect(cell?.formula).toBeUndefined()
      expect(cell?.numFmt).toBe('@')
    }
  })

  it('keeps the auto-filter across every column, new ones included', async () => {
    /*
     * Read back from a real file, where exceljs reports the filter as an A1
     * range rather than as the row/column object it was written with. The
     * assertion is on the width, which is the thing that would silently be
     * wrong: a filter stopping short of the new columns leaves them
     * unfilterable with nothing on screen to show it.
     */
    const workbook = await readBack(FLYING_FLEA_ONLY, { feedback: [] })
    const sheet = workbook.getWorksheet('Participant Feedback')
    const header = ((sheet?.getRow(1).values ?? []) as unknown[]).slice(1)
    const lastColumn = sheet?.getColumn(header.length).letter

    expect(sheet?.autoFilter).toBe(`A1:${lastColumn}1`)
  })
})

describe('the workbook explains where direct responses sit', () => {
  it('reports them on Summary, outside the coverage fraction', async () => {
    const withDirect = overview(NO_LEGACY, CAMPAIGN, {
      'flying-flea-feedback-v1': 11,
    })
    const summary = pairs(
      (
        await readBack({
          ...withDirect,
          run: { ...RUN, counts: { ...RUN.counts, standaloneFeedback: 3 } },
          coverage: { ...withDirect.coverage, directResponses: 3 },
        })
      ).getWorksheet('Summary'),
    )

    expect(summary.get('Direct responses (no Point A registration)')).toBe('3')
    // Coverage is untouched by them: 12 of 14 registrations, as before.
    expect(
      summary.get('Response coverage (registrations with any valid feedback)'),
    ).toBe('12')
    expect(summary.get('Response coverage %')).toBe('85.7')
  })

  it('states the inclusion rule in Metadata, in words', async () => {
    const metadata = pairs(
      (await readBack(FLYING_FLEA_ONLY)).getWorksheet('Metadata'),
    )

    expect(metadata.get('analyticsInclusionRule')).toContain('standalone')
    expect(metadata.get('standaloneRule')).toContain('not a reconciliation failure')
    expect(metadata.get('contactMatchRule')).toContain('Names are never matched on')
    expect(metadata.get('coverageRule')).toContain('neither the numerator')
  })

  it('reports the matched and standalone counts separately', async () => {
    const metadata = pairs(
      (
        await readBack({
          ...FLYING_FLEA_ONLY,
          run: { ...RUN, counts: { ...RUN.counts, standaloneFeedback: 3 } },
        })
      ).getWorksheet('Metadata'),
    )

    expect(metadata.get('matchedResponses')).toBe('11')
    expect(metadata.get('standaloneResponses')).toBe('3')
  })
})
