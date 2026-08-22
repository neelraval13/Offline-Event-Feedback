/*
 * Invented data for the Point B concept.
 *
 * Nothing here touches storage, the scanner, identity capture or the terminal
 * state machine. There is no `usePointBTerminal`, no `createFeedback`, no
 * `createZxingScanner`, no camera and no IndexedDB. The concept renders these
 * constants and the campaign's own question definitions, which is what makes it
 * safe to open on a machine that also holds real event data.
 *
 * The camera is a drawn fixture rather than a paused video element. A concept
 * that opened a real camera to show what a camera looks like would be asking a
 * reviewer for a permission prompt in order to review a layout.
 */

/** A public code in the real printed shape, for a rider who does not exist. */
export const CONCEPT_PUBLIC_CODE = 'A1-C0NCPT-00042-K'

/** Real wording, from `identityCapture.ts`. */
export const CONCEPT_QR_REJECTION =
  'This QR is not a valid participant sticker for this event.'

/** Real wording, from `identityCapture.ts`. */
export const CONCEPT_CODE_REJECTION =
  'That code is not valid. Check it and type it again.'

/** Real wording, from `zxingScanner.ts`. The most common camera failure. */
export const CONCEPT_CAMERA_ERROR =
  'Camera access was refused. Allow the camera in the browser, or enter the code manually.'

/** What a failed local write produces. */
export const CONCEPT_SAVE_ERROR = 'the database transaction was aborted'

/** A rider who typed their own details, for the contact path. */
export const CONCEPT_RIDER = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '9876543210',
} as const

/** What the operator typed wrong, for the manual-code error state. */
export const CONCEPT_TYPED_CODE = 'A1-C0NCPT-00042-B'

/** Quiet operational metadata, not a dashboard metric. */
export const CONCEPT_SAVED_COUNT = 128
