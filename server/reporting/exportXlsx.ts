import ExcelJS from 'exceljs'
import {
  FLYING_FLEA_FORM_VERSION,
  READABLE_FORM_VERSIONS,
  SUPPORTED_FORM_VERSION,
} from './analytics.js'
import {
  DUPLICATE_CSV_HEADER,
  FEEDBACK_CSV_HEADER,
  REGISTRATION_CSV_HEADER,
} from './exportCsv.js'
import {
  compileParticipantFeedback,
  participantFeedbackCells,
  PARTICIPANT_FEEDBACK_HEADER,
  PARTICIPANT_FEEDBACK_WIDTHS,
} from './participantFeedback.js'
import type { FeedbackExportRow, RegistrationExportRow } from './postgres.js'
import type { DuplicateCandidateRow, OverviewResponse } from './types.js'

/*
 * XLSX workbook.
 *
 * Generated server-side. `exceljs` is a server dependency and is deliberately
 * never imported from `src/`; it would add megabytes to a bundle that has to
 * be precached onto a tablet for offline use.
 *
 * Every participant-derived value is written as an explicit **string cell**.
 * Excel will happily interpret a leading `=` or `+` as a formula otherwise, and
 * every international phone number in this export begins with `+`.
 */

export interface WorkbookInput {
  readonly overview: OverviewResponse
  readonly registrations: readonly RegistrationExportRow[]
  readonly feedback: readonly FeedbackExportRow[]
  readonly duplicates: readonly DuplicateCandidateRow[]
  readonly generatedAt: Date
}

/** Writes a value as text, never as something a spreadsheet might evaluate. */
function textCell(row: ExcelJS.Row, column: number, value: unknown): void {
  const cell = row.getCell(column)

  if (value === null || value === undefined) {
    cell.value = ''
  } else {
    cell.value = String(value)
  }

  // Explicit text format: without it Excel may still coerce something that
  // looks numeric, and a public code or phone number must survive intact.
  cell.numFmt = '@'
}

function appendTextRow(
  sheet: ExcelJS.Worksheet,
  values: readonly unknown[],
): void {
  const row = sheet.addRow([])
  values.forEach((value, index) => textCell(row, index + 1, value))
  row.commit()
}

/** `flying-flea-feedback-v1: 12, feedback-v1: 3`, or a plain statement of none. */
function describeFormVersions(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts).sort(([, a], [, b]) => b - a)

  return entries.length === 0
    ? 'none'
    : entries.map(([version, count]) => `${version}: ${count}`).join(', ')
}

function addHeader(sheet: ExcelJS.Worksheet, header: readonly string[]): void {
  const row = sheet.addRow([...header])
  row.font = { bold: true }
  row.commit()
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

export async function buildWorkbook(input: WorkbookInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.created = input.generatedAt

  const { overview } = input
  const { run, analytics, campaignAnalytics, coverage, freshness } = overview

  /* ---- Summary ----
   *
   * Three sections, in the order a reader needs them: what the run counted,
   * then the questionnaire this event actually asked, then the legacy one.
   *
   * The sectioning exists because a single flat list put `feedback-v1`
   * analytics at the top of every workbook. At a Flying Flea event those rows
   * are all zero, correctly, since no rider answered that questionnaire; but a
   * reader opening the file sees "Average overall rating: (blank)" above two
   * dozen zeros and concludes the event collected nothing. The figures were
   * always in the Feedback sheet and on the Overview screen. What was missing
   * was a summary that named the questionnaire it was summarising.
   *
   * Neither questionnaire is ever folded into the other's numbers.
   */
  const summary = workbook.addWorksheet('Summary')
  addHeader(summary, ['Measure', 'Value'])

  const summaryRows: [string, unknown][] = [
    ['EVENT AND RECONCILIATION', ''],
    ['Event', overview.eventId],
    ['Reconciliation run', run.runId],
    ['Reconciliation completed', run.completedAt],
    ['Registrations in run', run.counts.registrationCount],
    ['Feedback in run', run.counts.feedbackCount],
    ['Matched registrations', run.counts.matchedRegistrations],
    ['Registrations without feedback', run.counts.registrationsWithoutFeedback],
    ['Registrations with multiple feedback', run.counts.registrationsWithMultipleFeedback],
    ['Feedback without registration', run.counts.feedbackWithoutRegistration],
    ['Feedback identity conflicts', run.counts.feedbackIdentityConflicts],
    ['Feedback in multiple-feedback groups', run.counts.feedbackInMultipleGroups],
    ['Possible duplicate registration pairs', run.counts.duplicateRegistrationCandidateCount],
    ['Response coverage (registrations with any valid feedback)', coverage.registrationsWithFeedback],
    ['Response coverage %', coverage.percentage ?? ''],
    ['Responses by questionnaire', describeFormVersions(overview.responsesByFormVersion)],
    ['Responses this build cannot read', overview.unreadableResponses],
  ]

  /* ---- Flying Flea ---- */
  if (campaignAnalytics.analysedResponses > 0) {
    summaryRows.push(
      ['', ''],
      [`FLYING FLEA FEEDBACK (${campaignAnalytics.formVersion})`, ''],
      ['Flying Flea responses analysed', campaignAnalytics.analysedResponses],
    )

    /*
     * The prompts come from `campaignAnalytics.ratings`, which carries the
     * canonical wording from `shared/campaign/flyingFlea.ts`. Typing the four
     * questions out here would be a fifth copy, and the copy in a spreadsheet
     * is the one nobody notices has drifted from what the rider was shown.
     */
    for (const rating of campaignAnalytics.ratings) {
      summaryRows.push(
        ['', ''],
        [rating.prompt, ''],
        ['  Average out of 7', rating.average ?? ''],
        ['  Answered', rating.responses],
      )
      // Highest first: a reader scanning for "how many loved it" reads down.
      for (const value of [7, 6, 5, 4, 3, 2, 1] as const) {
        summaryRows.push([`  Rated ${value}`, rating.distribution[value]])
      }
    }

    summaryRows.push(
      ['', ''],
      ['Wrote about top features', campaignAnalytics.textAnswers.topThreeFeatures],
      [
        'Wrote about overall experience',
        campaignAnalytics.textAnswers.overallExperienceComments,
      ],
      [
        '  Free-text answers are in the Feedback sheet',
        'columns top_three_features and overall_experience_comments',
      ],
    )
  }

  /* ---- Legacy ----
   *
   * Kept for an event that collected `feedback-v1`, and stated as absent rather
   * than printed as zeros for one that did not.
   */
  summaryRows.push(['', ''], [`LEGACY FEEDBACK (${SUPPORTED_FORM_VERSION})`, ''])

  if (analytics.analysedResponses > 0) {
    summaryRows.push(
      ['Analytics responses (matched only)', analytics.analysedResponses],
      ['Average overall rating', analytics.averageOverallRating ?? ''],
      ['Rating 1', analytics.ratingCounts['1']],
      ['Rating 2', analytics.ratingCounts['2']],
      ['Rating 3', analytics.ratingCounts['3']],
      ['Rating 4', analytics.ratingCounts['4']],
      ['Rating 5', analytics.ratingCounts['5']],
      ['Experience very_poor', analytics.experienceCounts.very_poor],
      ['Experience poor', analytics.experienceCounts.poor],
      ['Experience okay', analytics.experienceCounts.okay],
      ['Experience good', analytics.experienceCounts.good],
      ['Experience excellent', analytics.experienceCounts.excellent],
      ['Recommend yes', analytics.recommendYes],
      ['Recommend no', analytics.recommendNo],
      ['Recommend %', analytics.recommendPercentage ?? ''],
    )
  } else {
    summaryRows.push([
      'No responses to this questionnaire',
      `This event collected no ${SUPPORTED_FORM_VERSION} responses, so its figures are not reported. Zeros here would describe a questionnaire nobody was asked.`,
    ])
  }

  for (const entry of summaryRows) {
    appendTextRow(summary, entry)
  }
  summary.getColumn(1).width = 64
  summary.getColumn(2).width = 44

  /* ---- Participant Feedback ----
   *
   * Second, directly after Summary, because it is the sheet most readers want
   * and the three that follow are audit sheets. It is a view over them and
   * never a source of truth: see `participantFeedback.ts`.
   */
  const participants = workbook.addWorksheet('Participant Feedback')
  addHeader(participants, PARTICIPANT_FEEDBACK_HEADER)

  for (const row of compileParticipantFeedback(
    run.runId,
    input.registrations,
    input.feedback,
  )) {
    appendTextRow(participants, participantFeedbackCells(row))
  }

  PARTICIPANT_FEEDBACK_WIDTHS.forEach((width, index) => {
    participants.getColumn(index + 1).width = width
  })

  // Filter the header, so an organiser can narrow to one status or one vehicle
  // without writing anything.
  participants.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: PARTICIPANT_FEEDBACK_HEADER.length },
  }

  /* ---- Registrations ---- */
  const registrations = workbook.addWorksheet('Registrations')
  addHeader(registrations, REGISTRATION_CSV_HEADER)
  for (const row of input.registrations) {
    appendTextRow(registrations, [
      run.runId,
      run.completedAt,
      row.recordId,
      row.participantId,
      row.publicCode,
      row.name,
      row.phone,
      row.email,
      row.vehicle,
      row.interestedColour,
      row.location,
      row.gender,
      row.testRideAt,
      row.drivingLicence,
      row.pincode,
      row.createdAt,
      row.revision,
      row.status,
      row.validFeedbackCount,
      row.potentialDuplicate ? 'true' : 'false',
      row.feedbackRecordId,
      row.captureMethod,
      row.overallRating,
      row.experience,
      row.recommend,
      row.comments,
    ])
  }

  /* ---- Feedback ---- */
  const feedback = workbook.addWorksheet('Feedback')
  addHeader(feedback, FEEDBACK_CSV_HEADER)
  for (const row of input.feedback) {
    appendTextRow(feedback, [
      run.runId,
      row.recordId,
      row.publicCode,
      row.participantId,
      row.captureMethod,
      row.formVersion,
      row.createdAt,
      row.revision,
      row.status,
      row.matchMethod,
      row.registrationRecordId,
      row.registrationPublicCode,
      row.registrationName,
      row.registrationPhone,
      row.registrationEmail,
      row.overallRating,
      row.experience,
      row.recommend,
      row.comments,
      row.testRideExperienceRating,
      row.rotaryKnobRating,
      row.rideModesRating,
      row.overallExperienceRating,
      row.topThreeFeatures,
      row.overallExperienceComments,
    ])
  }

  /* ---- Duplicate candidates ---- */
  const duplicates = workbook.addWorksheet('Duplicate Candidates')
  addHeader(duplicates, DUPLICATE_CSV_HEADER)
  for (const row of input.duplicates) {
    appendTextRow(duplicates, [
      run.runId,
      row.matchBasis,
      row.left.recordId,
      row.left.publicCode,
      row.left.name,
      row.left.phone,
      row.left.email,
      row.right.recordId,
      row.right.publicCode,
      row.right.name,
      row.right.phone,
      row.right.email,
    ])
  }

  /* ---- Metadata ---- */
  const metadata = workbook.addWorksheet('Metadata')
  addHeader(metadata, ['Field', 'Value'])
  for (const entry of [
    ['eventId', overview.eventId],
    ['runId', run.runId],
    ['engineVersion', run.engineVersion],
    ['reconciliationCompletedAt', run.completedAt],
    ['reportGeneratedAt', input.generatedAt.toISOString()],
    ['dataChangedSinceRun', String(freshness.dataChangedSinceRun)],
    ['currentRegistrationCount', freshness.currentRegistrationCount],
    ['currentFeedbackCount', freshness.currentFeedbackCount],
    ['registrationsAddedSinceRun', freshness.registrationsAddedSinceRun],
    ['feedbackAddedSinceRun', freshness.feedbackAddedSinceRun],
    ['latestContentChangeAt', freshness.latestContentChangeAt ?? ''],
    [
      'membershipRule',
      'This workbook contains exactly the registrations and responses the named reconciliation run classified. Records that arrived after it completed are not present; the counts above say how many.',
    ],
    [
      'analyticsInclusionRule',
      'Rating, experience and recommend figures use only feedback classified matched by this reconciliation run. Responses in multiple-feedback groups, identity conflicts and feedback without a registration are excluded.',
    ],
    [
      'coverageRule',
      'Response coverage counts registrations with at least one valid feedback record (matched + multiple_feedback), which is a different measure from the analytics sample.',
    ],
    [
      'multipleFeedbackRule',
      'Where a registration has several valid responses, no winner is chosen: the Registrations sheet leaves answer columns blank and every individual response appears in the Feedback sheet.',
    ],
    [
      'snapshotCaveat',
      'Reconciliation statuses are historical for the selected run. Names, phone numbers, emails and answers are the current canonical values and may have been revised after the run completed.',
    ],
    /*
     * Which questionnaires this workbook understands, stated in full.
     *
     * `supportedFormVersion: feedback-v1` used to be the only row here, and in
     * a workbook whose Feedback sheet is entirely `flying-flea-feedback-v1` it
     * reads as "the only questionnaire this file understands", which is false
     * and alarming. It described the legacy analytics reader; it is now named
     * for that, and the full list is stated beside it.
     */
    ['readableFormVersions', READABLE_FORM_VERSIONS.join(', ')],
    ['campaignFormVersion', FLYING_FLEA_FORM_VERSION],
    ['legacyAnalyticsFormVersion', SUPPORTED_FORM_VERSION],
    [
      'formVersionRule',
      `This workbook reads ${READABLE_FORM_VERSIONS.join(' and ')}. Each questionnaire is summarised on its own terms and its own scale, and neither is folded into the other's averages. Answers to any other questionnaire are still exported in full on the Feedback sheet; only their summary figures are withheld.`,
    ],
    ['legacyUnreadableFormVersions', analytics.unreadableFormVersions],
    ['campaignUnreadableFormVersions', campaignAnalytics.unreadableFormVersions],
    ['unreadableResponses', overview.unreadableResponses],
  ] as [string, unknown][]) {
    appendTextRow(metadata, entry)
  }
  metadata.getColumn(1).width = 30
  metadata.getColumn(2).width = 100

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
