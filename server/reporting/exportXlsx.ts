import ExcelJS from 'exceljs'
import { SUPPORTED_FORM_VERSION } from './analytics.js'
import {
  DUPLICATE_CSV_HEADER,
  FEEDBACK_CSV_HEADER,
  REGISTRATION_CSV_HEADER,
} from './exportCsv.js'
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
  const { run, analytics, coverage, freshness } = overview

  /* ---- Summary ---- */
  const summary = workbook.addWorksheet('Summary')
  addHeader(summary, ['Measure', 'Value'])

  const summaryRows: [string, unknown][] = [
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
  ]
  for (const entry of summaryRows) {
    appendTextRow(summary, entry)
  }
  summary.getColumn(1).width = 52
  summary.getColumn(2).width = 44

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
    ['supportedFormVersion', SUPPORTED_FORM_VERSION],
    ['unreadableFormVersions', analytics.unreadableFormVersions],
  ] as [string, unknown][]) {
    appendTextRow(metadata, entry)
  }
  metadata.getColumn(1).width = 30
  metadata.getColumn(2).width = 100

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
