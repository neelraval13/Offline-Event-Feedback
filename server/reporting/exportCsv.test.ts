import { describe, expect, it } from 'vitest'
import {
  csvField,
  duplicateCandidatesCsv,
  exportFileName,
  feedbackCsv,
  FEEDBACK_CSV_HEADER,
  neutralizeFormula,
  REGISTRATION_CSV_HEADER,
  registrationsCsv,
} from './exportCsv'
import type { FeedbackExportRow, RegistrationExportRow } from './postgres'
import type { DuplicateCandidateRow, RunDescriptor } from './types'

const RUN: RunDescriptor = {
  runId: '11111111-1111-4111-8111-111111111111',
  eventId: 'evt-dev-001',
  engineVersion: 'reconciliation-v1',
  startedAt: '2026-01-01T11:59:00.000Z',
  completedAt: '2026-01-01T12:00:00.000Z',
  counts: {
    registrationCount: 0,
    feedbackCount: 0,
    matchedRegistrations: 0,
    registrationsWithoutFeedback: 0,
    registrationsWithMultipleFeedback: 0,
    matchedFeedback: 0,
    feedbackWithoutRegistration: 0,
    feedbackIdentityConflicts: 0,
    feedbackInMultipleGroups: 0,
    duplicateRegistrationCandidateCount: 0,
  },
}

function registration(
  overrides: Partial<RegistrationExportRow> = {},
): RegistrationExportRow {
  return {
    recordId: 'r1',
    participantId: 'p1',
    publicCode: 'A1-B8EFD9-00001-X',
    name: 'Ada Lovelace',
    phone: '+44 20 7946 0958',
    email: 'ada@example.com',
    vehicle: 'Vehicle 1',
    interestedColour: 'Flea Green',
    location: 'Prestige Tech Park',
    gender: 'Female',
    testRideAt: '2026-01-01T10:30',
    drivingLicence: 'KA0120200001234',
    pincode: '560048',
    createdAt: '2026-01-01T09:00:00.000Z',
    revision: 1,
    status: 'matched',
    validFeedbackCount: 1,
    potentialDuplicate: false,
    feedbackRecordId: 'f1',
    captureMethod: 'qr',
    overallRating: '5',
    experience: 'excellent',
    recommend: 'true',
    comments: 'Great event',
    ...overrides,
  }
}

function feedbackRow(overrides: Partial<FeedbackExportRow> = {}): FeedbackExportRow {
  return {
    recordId: 'f1',
    publicCode: 'A1-B8EFD9-00001-X',
    participantId: 'p1',
    captureMethod: 'qr',
    formVersion: 'feedback-v1',
    createdAt: '2026-01-01T10:00:00.000Z',
    revision: 1,
    status: 'matched',
    matchMethod: 'qr_identity',
    registrationRecordId: 'r1',
    registrationPublicCode: 'A1-B8EFD9-00001-X',
    registrationName: 'Ada Lovelace',
    registrationPhone: '+44 20 7946 0958',
    registrationEmail: 'ada@example.com',
    overallRating: '5',
    experience: 'excellent',
    recommend: 'true',
    comments: 'Great event',
    // A `feedback-v1` row carries no campaign answers, and vice versa.
    testRideExperienceRating: null,
    rotaryKnobRating: null,
    rideModesRating: null,
    overallExperienceRating: null,
    topThreeFeatures: null,
    overallExperienceComments: null,
    ...overrides,
  }
}

/** A campaign response: the v1 columns are blank and the campaign ones are not. */
function campaignFeedbackRow(
  overrides: Partial<FeedbackExportRow> = {},
): FeedbackExportRow {
  return feedbackRow({
    formVersion: 'flying-flea-feedback-v1',
    overallRating: null,
    experience: null,
    recommend: null,
    comments: null,
    testRideExperienceRating: '7',
    rotaryKnobRating: '6',
    rideModesRating: '5',
    overallExperienceRating: '7',
    topThreeFeatures: 'Torque, brakes, the noise',
    overallExperienceComments: 'Brilliant',
    ...overrides,
  })
}

describe('neutralizeFormula', () => {
  it('neutralises every character a spreadsheet treats as a formula lead', () => {
    for (const prefix of ['=', '+', '-', '@', '\t', '\r', '\n']) {
      expect(neutralizeFormula(`${prefix}cmd`)).toBe(`'${prefix}cmd`)
    }
  })

  it('leaves ordinary text untouched', () => {
    expect(neutralizeFormula('Ada Lovelace')).toBe('Ada Lovelace')
    expect(neutralizeFormula('')).toBe('')
    // Only the leading character matters.
    expect(neutralizeFormula('2+2')).toBe('2+2')
  })
})

describe('csvField', () => {
  it('neutralises the classic injection payload', () => {
    expect(csvField('=HYPERLINK("http://evil.example","click")')).toBe(
      `"'=HYPERLINK(""http://evil.example"",""click"")"`,
    )
  })

  it('preserves an international phone number as text', () => {
    // Every +91/+44 number is a formula to Excel without this.
    expect(csvField('+919876543210')).toBe(`"'+919876543210"`)
  })

  it('quotes commas, quotes and newlines', () => {
    expect(csvField('Lovelace, Ada')).toBe('"Lovelace, Ada"')
    expect(csvField('she said "hi"')).toBe('"she said ""hi"""')
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
  })

  it('writes an empty field for null and undefined', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
  })
})

describe('registrationsCsv', () => {
  it('emits the header and one row per registration', () => {
    const csv = registrationsCsv(RUN, [registration(), registration({ recordId: 'r2' })])
    const lines = csv.trimEnd().split('\r\n')

    expect(lines[0]).toBe(REGISTRATION_CSV_HEADER.join(','))
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain(RUN.runId)
  })

  it('leaves the answer columns blank when the run chose no winner', () => {
    const csv = registrationsCsv(RUN, [
      registration({
        status: 'multiple_feedback',
        validFeedbackCount: 2,
        feedbackRecordId: null,
        captureMethod: null,
        overallRating: null,
        experience: null,
        recommend: null,
        comments: null,
      }),
    ])
    const fields = (csv.trimEnd().split('\r\n')[1] ?? '').split(',')

    // Last six columns: feedback record, capture, rating, experience,
    // recommend, comments — all empty. Reporting does not pick a response.
    expect(fields.slice(-6)).toEqual(['', '', '', '', '', ''])
    expect(fields).toContain('multiple_feedback')
  })

  it('neutralises a hostile comment without losing it', () => {
    const csv = registrationsCsv(RUN, [
      registration({ comments: '=1+1', name: '@admin' }),
    ])

    expect(csv).toContain(`"'=1+1"`)
    expect(csv).toContain(`"'@admin"`)
  })
})

describe('feedbackCsv', () => {
  it('emits every response, including ones with no registration', () => {
    const csv = feedbackCsv(RUN, [
      feedbackRow(),
      feedbackRow({
        recordId: 'f2',
        status: 'without_registration',
        matchMethod: null,
        registrationRecordId: null,
        registrationPublicCode: null,
        registrationName: null,
        registrationPhone: null,
        registrationEmail: null,
      }),
    ])
    const lines = csv.trimEnd().split('\r\n')

    expect(lines[0]).toBe(FEEDBACK_CSV_HEADER.join(','))
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('without_registration')
  })
})

describe('the two questionnaires in one export', () => {
  it('keeps each questionnaire in its own columns', () => {
    const csv = feedbackCsv(RUN, [feedbackRow(), campaignFeedbackRow()])
    const rows = csv.trimEnd().split('\r\n')
    const header = (rows[0] ?? '').split(',')
    const v1 = (rows[1] ?? '').split(',')
    const campaign = (rows[2] ?? '').split(',')

    const at = (name: string) => header.indexOf(name)

    // The old questionnaire's answers, and no campaign answers.
    expect(v1[at('overall_rating')]).toBe('5')
    expect(v1[at('test_ride_experience_rating')]).toBe('')
    expect(v1[at('overall_experience_rating')]).toBe('')

    // The campaign's answers, and no v1 answers. A 1-7 rating must never land
    // in a column an analyst reads as 1-5.
    expect(campaign[at('overall_rating')]).toBe('')
    expect(campaign[at('experience')]).toBe('')
    expect(campaign[at('recommend')]).toBe('')
    expect(campaign[at('test_ride_experience_rating')]).toBe('7')
    expect(campaign[at('rotary_knob_rating')]).toBe('6')
    expect(campaign[at('ride_modes_rating')]).toBe('5')
    expect(campaign[at('overall_experience_rating')]).toBe('7')
  })

  it('exports an old feedback-v1 record unchanged', () => {
    // Records collected before the campaign stay exportable, with the same
    // columns and the same values they always had.
    const csv = feedbackCsv(RUN, [feedbackRow()])

    expect(csv).toContain('feedback-v1')
    expect(csv).toContain('excellent')
    expect(csv).toContain('Great event')
  })

  it('neutralises formulas in both campaign free-text answers', () => {
    const csv = feedbackCsv(RUN, [
      campaignFeedbackRow({
        topThreeFeatures: '=cmd|"/c calc"!A0',
        overallExperienceComments: '+1 for the brakes',
      }),
    ])

    expect(csv).toContain(`"'=cmd`)
    expect(csv).toContain(`"'+1 for the brakes"`)
  })

  it('carries the campaign registration fields', () => {
    const csv = registrationsCsv(RUN, [registration()])
    const header = (csv.split('\r\n')[0] ?? '').split(',')

    for (const column of [
      'vehicle',
      'interested_colour',
      'location',
      'gender',
      'test_ride_at',
      'driving_licence',
      'pincode',
    ]) {
      expect(header).toContain(column)
    }

    expect(csv).toContain('Vehicle 1')
    expect(csv).toContain('Flea Green')
    expect(csv).toContain('560048')
  })

  it('leaves campaign columns blank for a pre-campaign registration', () => {
    const csv = registrationsCsv(RUN, [
      registration({
        vehicle: null,
        interestedColour: null,
        location: null,
        gender: null,
        testRideAt: null,
        drivingLicence: null,
        pincode: null,
      }),
    ])
    const header = (csv.split('\r\n')[0] ?? '').split(',')
    const row = (csv.split('\r\n')[1] ?? '').split(',')

    // Blank, never a default: the registration genuinely has no vehicle.
    expect(row[header.indexOf('vehicle')]).toBe('')
    expect(row[header.indexOf('driving_licence')]).toBe('')
  })
})

describe('duplicateCandidatesCsv', () => {
  it('writes both sides of each candidate pair', () => {
    const candidate: DuplicateCandidateRow = {
      matchBasis: 'phone_only',
      left: {
        recordId: 'r1',
        publicCode: 'A1-B8EFD9-00001-X',
        name: 'Ada Lovelace',
        phone: '+44 20 7946 0958',
        email: 'ada@example.com',
      },
      right: {
        recordId: 'r2',
        publicCode: 'A1-B8EFD9-00002-X',
        name: 'A. Lovelace',
        phone: '+44 20 7946 0958',
        email: '',
      },
    }

    const csv = duplicateCandidatesCsv(RUN, [candidate])
    expect(csv).toContain('phone_only')
    expect(csv).toContain('A1-B8EFD9-00001-X')
    expect(csv).toContain('A1-B8EFD9-00002-X')
  })
})

describe('exportFileName', () => {
  const at = new Date('2026-01-02T15:04:05.000Z')

  it('names the event, the kind and the date — never a participant', () => {
    expect(exportFileName('evt-dev-001', 'registrations', 'csv', at)).toBe(
      'evt-dev-001-registrations-2026-01-02.csv',
    )
  })

  it('sanitises an event id so it cannot escape the filename', () => {
    const name = exportFileName('../../etc/passwd', 'report', 'xlsx', at)

    expect(name).not.toContain('/')
    expect(name).toBe('.._.._etc_passwd-report-2026-01-02.xlsx')
  })
})
