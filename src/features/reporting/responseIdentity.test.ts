import { describe, expect, it } from 'vitest'
import type { FeedbackRow } from '../../lib/reporting/types'
import { captureLabel, codeLabel, participantLabel } from './responseIdentity'

/*
 * The response list, once a response can have three kinds of identity.
 *
 * The defect these exist to prevent is quiet rather than loud. Every column
 * here had an inline ternary that assumed a response has a code and belongs to
 * a registration, and a direct response has neither. Nothing would have thrown:
 * the Code column would render blank, the Captured column would say "Typed"
 * about a rider who typed nothing, and the Participant column would say "None"
 * about somebody who gave their full name and email address. All three read as
 * facts about the rider.
 */

function row(overrides: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    recordId: '019ffc65-4559-7125-9453-de82fb849ed8',
    publicCode: 'A1-B8EFD9-00001-X',
    participantId: null,
    captureMethod: 'qr',
    formVersion: 'flying-flea-feedback-v1',
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

const DIRECT = {
  publicCode: null,
  captureMethod: 'contact',
  reconciliationStatus: 'standalone',
  matchMethod: null,
  respondentName: 'Grace Hopper',
  respondentPhone: '9876543210',
  respondentEmail: 'grace@example.com',
} as const

describe('the Captured column', () => {
  it('says what actually happened, not a machine token', () => {
    expect(captureLabel(row({ captureMethod: 'qr' }))).toBe('Scanned')
    expect(captureLabel(row({ captureMethod: 'manual' }))).toBe('Typed')
    expect(captureLabel(row(DIRECT))).toBe('Contact details')
  })

  it('never calls a contact capture "typed"', () => {
    // The old ternary was `captureMethod === 'qr' ? 'Scanned' : 'Typed'`, which
    // would have described a rider who typed no code as having typed a code.
    expect(captureLabel(row(DIRECT))).not.toBe('Typed')
  })

  it('shows an unknown method rather than mislabelling it', () => {
    expect(
      captureLabel({ captureMethod: 'telepathy' as FeedbackRow['captureMethod'] }),
    ).toBe('telepathy')
  })
})

describe('the Code column', () => {
  it('shows the code when there is one', () => {
    expect(codeLabel(row())).toBe('A1-B8EFD9-00001-X')
  })

  it('says there is no code rather than rendering an empty cell', () => {
    /*
     * A blank in a column of codes reads as data that failed to load, and the
     * first thing anybody does about that is go looking for the missing code.
     * There is no missing code: this rider never had a sticker.
     */
    expect(codeLabel(row(DIRECT))).toBe('No code')
  })
})

describe('the Participant column', () => {
  it('prefers the matched registration’s name', () => {
    expect(
      participantLabel(
        row({
          linkedRegistration: {
            recordId: 'reg-1',
            publicCode: 'A1-B8EFD9-00001-X',
            name: 'Ada Lovelace',
          },
        }),
      ),
    ).toBe('Ada Lovelace')
  })

  it('names a direct respondent rather than reporting them as None', () => {
    expect(participantLabel(row(DIRECT))).toBe('Grace Hopper')
  })

  it('shows the registration’s name for a matched contact response', () => {
    // Both are present. The registration is what the event recorded about this
    // rider, and it is what every other screen calls them.
    expect(
      participantLabel(
        row({
          ...DIRECT,
          reconciliationStatus: 'matched',
          matchMethod: 'contact_identity',
          linkedRegistration: {
            recordId: 'reg-1',
            publicCode: 'A1-B8EFD9-00001-X',
            name: 'Ada Lovelace',
          },
        }),
      ),
    ).toBe('Ada Lovelace')
  })

  it('still says None for a sticker that resolved to nobody', () => {
    /*
     * The case `None` was always right for, and it stays. There genuinely is no
     * person attached to this response, only a code that led nowhere.
     */
    expect(
      participantLabel(
        row({ reconciliationStatus: 'without_registration', matchMethod: null }),
      ),
    ).toBe('None')
  })
})
