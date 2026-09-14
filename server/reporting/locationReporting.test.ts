import { describe, expect, it } from 'vitest'
import {
  compileParticipantFeedback,
  PARTICIPANT_FEEDBACK_HEADER,
  participantFeedbackCells,
} from './participantFeedback.js'
import {
  locationsDisagree,
  LOCATION_NOT_CAPTURED,
} from '../../shared/reporting/location.js'
import type {
  FeedbackExportRow,
  RegistrationExportRow,
} from './postgres.js'

/*
 * Reporting an event that ran in two cities.
 *
 * Three questions an organiser asks, and one they do not know to ask:
 *
 *   how did Bengaluru do, how did Hyderabad do, how did the event do
 *   and: is anything here disagreeing with itself?
 *
 * The first three are answered by grouping. The fourth is the reason the
 * Participant Feedback sheet carries both locations side by side instead of
 * one: a matched response has two independent statements about where it
 * happened, and when they differ neither the data nor this code can say which
 * is right.
 */

function registration(
  overrides: Partial<RegistrationExportRow> & { recordId: string },
): RegistrationExportRow {
  return {
    participantId: `p-${overrides.recordId}`,
    publicCode: 'A1-B8EFD9-00001-X',
    name: 'Ada Lovelace',
    phone: '9876543210',
    email: 'ada@example.com',
    vehicle: 'Vehicle 2',
    interestedColour: 'Storm Black',
    location: 'Bengaluru',
    gender: 'Female',
    testRideAt: '2026-09-20T15:42',
    drivingLicence: null,
    pincode: null,
    createdAt: '2026-09-20T10:12:00.000Z',
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
    location: 'Bengaluru',
    registrationLocation: 'Bengaluru',
    formVersion: 'flying-flea-feedback-v1',
    createdAt: '2026-09-20T16:00:00.000Z',
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
    topThreeFeatures: null,
    overallExperienceComments: null,
    ...overrides,
  }
}

/** A row's cells, addressed by column name rather than by position. */
function cellsByColumn(
  row: ReturnType<typeof compileParticipantFeedback>[number],
): Map<string, unknown> {
  const cells = participantFeedbackCells(row)
  return new Map(
    PARTICIPANT_FEEDBACK_HEADER.map((header, index) => [header, cells[index]]),
  )
}

describe('the Participant Feedback sheet’s location columns', () => {
  it('names them separately, so neither can be mistaken for the other', () => {
    /*
     * The previously unqualified `Location` is now `Registration Location`.
     * With two of them on one sheet an unqualified heading is read as whichever
     * one the reader had in mind, which is the worst possible outcome for a
     * column somebody is about to filter on.
     */
    expect(PARTICIPANT_FEEDBACK_HEADER).toContain('Registration Location')
    expect(PARTICIPANT_FEEDBACK_HEADER).toContain('Feedback Location')
    expect(PARTICIPANT_FEEDBACK_HEADER).toContain('Location Mismatch')
    expect(PARTICIPANT_FEEDBACK_HEADER).not.toContain('Location')
  })

  it('carries both locations on a matched row', () => {
    const rows = compileParticipantFeedback(
      'run-1',
      [registration({ recordId: 'r1', location: 'Hyderabad' })],
      [
        response({
          recordId: 'f1',
          registrationRecordId: 'r1',
          location: 'Hyderabad',
          registrationLocation: 'Hyderabad',
        }),
      ],
    )

    const cells = cellsByColumn(rows[0] as never)
    expect(cells.get('Registration Location')).toBe('Hyderabad')
    expect(cells.get('Feedback Location')).toBe('Hyderabad')
    expect(cells.get('Location Mismatch')).toBeNull()
  })

  it('flags a row whose two locations disagree, and keeps both', () => {
    /*
     * The diagnostic. A rider registered in Bengaluru and gave feedback in
     * Hyderabad, or a Point B device was left on the wrong city. The data
     * cannot say which, so nothing is corrected and both values stay on the
     * row with a marker beside them.
     */
    const rows = compileParticipantFeedback(
      'run-1',
      [registration({ recordId: 'r1', location: 'Bengaluru' })],
      [
        response({
          recordId: 'f1',
          registrationRecordId: 'r1',
          location: 'Hyderabad',
          registrationLocation: 'Bengaluru',
        }),
      ],
    )

    const cells = cellsByColumn(rows[0] as never)
    expect(cells.get('Location Mismatch')).toBe('Yes')
    // Neither is overwritten by the other.
    expect(cells.get('Registration Location')).toBe('Bengaluru')
    expect(cells.get('Feedback Location')).toBe('Hyderabad')
  })

  it('does not flag a row where one side was never captured', () => {
    /*
     * An August response matched to an August registration. Absence is not
     * disagreement: counting these would fill the diagnostic with every
     * historical row and bury the handful that are real.
     */
    const rows = compileParticipantFeedback(
      'run-1',
      [registration({ recordId: 'r1', location: null })],
      [
        response({
          recordId: 'f1',
          registrationRecordId: 'r1',
          location: null,
          registrationLocation: null,
        }),
      ],
    )

    const cells = cellsByColumn(rows[0] as never)
    expect(cells.get('Location Mismatch')).toBeNull()
    expect(cells.get('Feedback Location')).toBeNull()
  })

  it('does not flag a row where only the response has a city', () => {
    const rows = compileParticipantFeedback(
      'run-1',
      [registration({ recordId: 'r1', location: null })],
      [
        response({
          recordId: 'f1',
          registrationRecordId: 'r1',
          location: 'Bengaluru',
          registrationLocation: null,
        }),
      ],
    )

    expect(cellsByColumn(rows[0] as never).get('Location Mismatch')).toBeNull()
  })
})

describe('a direct response, which has no registration at all', () => {
  it('is attributable to a city from its own record', () => {
    /*
     * The case the whole field exists for. This rider never registered, so
     * there is no Point A row to read a city from, and the response's own
     * location is the only account of where it was given.
     */
    const rows = compileParticipantFeedback(
      'run-1',
      [],
      [
        response({
          recordId: 'f1',
          captureMethod: 'contact',
          publicCode: null,
          participantId: null,
          respondentName: 'Grace Hopper',
          respondentPhone: '9876543210',
          respondentEmail: 'grace@example.com',
          status: 'standalone',
          matchMethod: null,
          registrationRecordId: null,
          registrationLocation: null,
          location: 'Hyderabad',
        }),
      ],
    )

    expect(rows).toHaveLength(1)
    const cells = cellsByColumn(rows[0] as never)

    expect(cells.get('Status')).toBe('Direct feedback')
    expect(cells.get('Feedback Location')).toBe('Hyderabad')
    // No registration to draw from, and none invented.
    expect(cells.get('Registration Location')).toBeNull()
    // And never flagged as a mismatch: there is nothing to disagree with.
    expect(cells.get('Location Mismatch')).toBeNull()
  })

  it('can be grouped by city alongside registered riders', () => {
    /*
     * The grouping an organiser actually performs on this sheet: filter the
     * Feedback Location column. A direct response has to appear under its city
     * exactly as a matched one does, or a per-city response count silently
     * omits every rider who did not register.
     */
    const rows = compileParticipantFeedback(
      'run-1',
      [registration({ recordId: 'r1', location: 'Hyderabad' })],
      [
        response({
          recordId: 'f1',
          registrationRecordId: 'r1',
          location: 'Hyderabad',
          registrationLocation: 'Hyderabad',
        }),
        response({
          recordId: 'f2',
          captureMethod: 'contact',
          publicCode: null,
          respondentName: 'Grace Hopper',
          respondentPhone: '9876543210',
          respondentEmail: 'grace@example.com',
          status: 'standalone',
          matchMethod: null,
          registrationRecordId: null,
          registrationLocation: null,
          location: 'Hyderabad',
        }),
        response({
          recordId: 'f3',
          publicCode: 'A1-B8EFD9-00009-X',
          status: 'without_registration',
          matchMethod: null,
          registrationRecordId: null,
          registrationLocation: null,
          location: 'Bengaluru',
        }),
      ],
    )

    const inHyderabad = rows.filter(
      (row) => row.feedbackLocation === 'Hyderabad',
    )
    const inBengaluru = rows.filter(
      (row) => row.feedbackLocation === 'Bengaluru',
    )

    expect(inHyderabad).toHaveLength(2)
    expect(inBengaluru).toHaveLength(1)
    // Every response is in exactly one city, and none is lost.
    expect(inHyderabad.length + inBengaluru.length).toBe(3)
  })
})

describe('the shared disagreement rule', () => {
  it('is true only when both sides are present and different', () => {
    expect(locationsDisagree('Bengaluru', 'Hyderabad')).toBe(true)
    expect(locationsDisagree('Bengaluru', 'Bengaluru')).toBe(false)
  })

  it('treats every kind of absence as not a disagreement', () => {
    for (const absent of [null, undefined, '']) {
      expect(locationsDisagree(absent, 'Hyderabad')).toBe(false)
      expect(locationsDisagree('Hyderabad', absent)).toBe(false)
      expect(locationsDisagree(absent, absent)).toBe(false)
    }
  })

  it('offers a label for an uncaptured location, never a guessed city', () => {
    expect(LOCATION_NOT_CAPTURED).toBe('Not captured')
    expect(LOCATION_NOT_CAPTURED).not.toContain('Bengaluru')
    expect(LOCATION_NOT_CAPTURED).not.toContain('Hyderabad')
  })
})
