/*
 * Storage bounds for contact details.
 *
 * Three independent readers enforce these, the sync wire schema, the backup
 * validator and the central column widths, and a bound that disagreed between
 * them would be a record one layer accepts and another refuses: a response that
 * restores and will not upload, or uploads and will not restore.
 *
 * They are bounds and nothing else. What a well-formed name or phone number
 * looks like is decided at the desk, by a person looking at the human in front
 * of them; see `src/features/registration/validation.ts` for the form's own
 * stricter rules. These exist only so that a stuck key or a pasted document
 * cannot produce a record too large to sync.
 *
 * The same numbers apply to a registration's `name`/`phone`/`email` and to a
 * contact capture's `respondentName`/`respondentPhone`/`respondentEmail`,
 * because they hold the same kind of value about the same kind of person.
 */

export const MAX_PERSON_NAME_LENGTH = 200

/** Generous: an international number with a country code and formatting. */
export const MAX_PERSON_PHONE_LENGTH = 64

/** The RFC 5321 maximum for a forward path. */
export const MAX_PERSON_EMAIL_LENGTH = 320
