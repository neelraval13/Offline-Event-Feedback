import type { FeedbackRow } from '../../lib/reporting/types'

/*
 * How a response's identity reads on screen.
 *
 * Extracted for the same reason `ratingCell.ts` was: these are three small
 * decisions about what a person sees, each of which was previously an inline
 * ternary that quietly assumed every response has a code and belongs to a
 * registration. Neither is true of a direct response, and both assumptions
 * failed silently rather than loudly: the column rendered `None`, which is a
 * claim about the rider rather than about the data.
 */

/** Machine tokens are for the export; a screen says what happened. */
const CAPTURE_LABELS: Readonly<Record<string, string>> = {
  qr: 'Scanned',
  manual: 'Typed',
  contact: 'Contact details',
}

export function captureLabel(row: Pick<FeedbackRow, 'captureMethod'>): string {
  return CAPTURE_LABELS[row.captureMethod] ?? row.captureMethod
}

/** Shown in place of a code that never existed. */
export const NO_CODE = 'No code'

/**
 * The code column.
 *
 * A contact response never had a sticker. Said in words rather than left blank:
 * an empty cell in a column of codes reads as data that failed to load, and the
 * first thing anybody does about that is go looking for the missing code.
 */
export function codeLabel(row: Pick<FeedbackRow, 'publicCode'>): string {
  return row.publicCode ?? NO_CODE
}

/**
 * Who the response is from.
 *
 * The matched registration's name first: that is the participant this event
 * registered, and it is what every other screen calls them.
 *
 * Failing that, the name the rider typed at Point B. This is the whole point of
 * the contact path. A direct response is from a specific, named person who gave
 * their details deliberately, and rendering `None` for every one of them would
 * present the event's least anonymous feedback as anonymous.
 *
 * `None` survives for the case it was always right for: a sticker whose code
 * resolved to nobody. There genuinely is no person attached to it, only a code
 * that led nowhere.
 */
export function participantLabel(
  row: Pick<FeedbackRow, 'linkedRegistration' | 'respondentName'>,
): string {
  return row.linkedRegistration?.name ?? row.respondentName ?? 'None'
}
