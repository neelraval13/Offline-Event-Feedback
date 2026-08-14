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
    ...overrides,
  }
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
