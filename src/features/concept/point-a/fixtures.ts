import { renderQrSvg } from '@/lib/qr/qrCode'

/*
 * Invented data for the Point A concept.
 *
 * Nothing here touches storage, identity or the registration path. There is no
 * `createRegistration`, no `useRegistrationTerminal`, no device id, no sequence
 * counter and no IndexedDB. The concept renders these constants and nothing
 * else, which is what makes it safe to open on a machine that also has real
 * event data on it.
 *
 * ## Why the QR is real rather than a grey square
 *
 * `renderQrSvg` is a pure function: a payload string in, deterministic SVG out.
 * Calling it with an invented payload produces a sticker that looks exactly
 * like the printed article, at the right density, with the right quiet zone,
 * which is the whole point of reviewing a sticker treatment. A drawn rectangle
 * would let a layout pass review that the real symbol would break.
 *
 * The payload is deliberately not a real one. It is not built by
 * `qrPayloadForRegistration`, it encodes a participant id that no device could
 * mint, and scanning it at Point B would find nothing.
 */

/** A public code in the real shape, for a participant who does not exist. */
export const CONCEPT_PUBLIC_CODE = 'A1-C0NCPT-00042-K'

/** Invented, and deliberately not the real payload contract. */
const CONCEPT_QR_PAYLOAD = `concept-only:${CONCEPT_PUBLIC_CODE}`

/** The sticker symbol, rendered once. */
export const CONCEPT_QR_SVG = renderQrSvg(CONCEPT_QR_PAYLOAD)

/** A filled-in rider, for the states that show a form with values in it. */
export const CONCEPT_RIDER = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '9876543210',
  pincode: '400001',
  gender: 'Female',
  drivingLicence: 'MH0120199012345',
} as const

/** What the recovery strip lists. Codes and times only, never a name. */
export const CONCEPT_RECENT: readonly {
  readonly code: string
  readonly time: string
}[] = [
  { code: 'A1-C0NCPT-00042-K', time: '14:12:41' },
  { code: 'A1-C0NCPT-00041-M', time: '14:09:03' },
  { code: 'A1-C0NCPT-00040-X', time: '14:04:55' },
  { code: 'A1-C0NCPT-00039-B', time: '13:58:20' },
  { code: 'A1-C0NCPT-00038-R', time: '13:51:07' },
]

/** The message the real screen shows when local storage is unreachable. */
export const CONCEPT_DEVICE_ERROR =
  'QuotaExceededError: the database could not be opened'

/** The message a QR rendering failure produces. */
export const CONCEPT_STICKER_ERROR = 'the symbol exceeds the maximum QR version'

/** The message a failed write produces. */
export const CONCEPT_SAVE_ERROR = 'the database transaction was aborted'
