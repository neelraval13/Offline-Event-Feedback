/*
 * The camera boundary.
 *
 * React components talk to this interface and never to ZXing. Two reasons: the
 * scanner's lifecycle is genuinely awkward (a live MediaStream that must be
 * released on unmount, or the camera light stays on), and tests must be able to
 * drive decode callbacks without a camera.
 */

/**
 * Why the camera is unavailable, classified into the cases staff can act on.
 *
 * The distinction that matters operationally is "you can fix this" (permission,
 * another app holding the camera) versus "this device cannot do it" (no camera,
 * insecure origin) — but every one of them leaves manual entry working, so the
 * UI treats them alike and only the wording differs.
 */
export type ScannerErrorKind =
  | 'permission-denied'
  | 'no-camera'
  | 'camera-busy'
  | 'insecure-context'
  | 'unsupported'
  | 'failed'

export interface ScannerError {
  readonly kind: ScannerErrorKind
  /** Wording for staff. Never a raw exception message or a stack trace. */
  readonly message: string
}

export interface ScannerStartOptions {
  /** Element the camera preview is attached to. */
  readonly video: HTMLVideoElement
  /**
   * Called for every successful decode, which for a stationary sticker means
   * many times a second. Callers are responsible for acting once — see
   * `usePointBTerminal`.
   */
  readonly onDecode: (text: string) => void
  /** Called for failures that occur after a successful start. */
  readonly onError: (error: ScannerError) => void
}

/**
 * A QR scanner bound to one video element.
 *
 * `pause` and `resume` exist separately from `dispose` on purpose: pausing
 * stops acting on decodes while the camera stays authorised and running, so
 * moving to the next participant does not re-prompt for permission or pay the
 * camera warm-up cost again. `dispose` is the one that releases hardware.
 */
export interface QrScanner {
  /** Requests camera access and begins decoding. Rejects with {@link ScannerError}. */
  start(options: ScannerStartOptions): Promise<void>
  /** Stops delivering decodes. The camera keeps running. */
  pause(): void
  /** Resumes delivering decodes after {@link pause}. */
  resume(): void
  /** Stops decoding, releases the camera and all media tracks. Idempotent. */
  dispose(): Promise<void>
}

export type QrScannerFactory = () => QrScanner

/** Type guard for the rejection shape {@link QrScanner.start} produces. */
export function isScannerError(value: unknown): value is ScannerError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'message' in value
  )
}
