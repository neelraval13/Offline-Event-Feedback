/*
 * The camera boundary.
 *
 * React components talk to this interface and never to ZXing. Two reasons: the
 * scanner's lifecycle is genuinely awkward (a live MediaStream that must be
 * released on unmount, or the camera light stays on), and tests must be able to
 * drive decode callbacks without a camera.
 *
 * The interface draws one distinction above all others: **a frame that did not
 * decode is not an error**. A continuous scanner spends almost all of its life
 * looking at frames with no readable QR in them, and the decoder reports each
 * one as an exception. Those are the normal operating condition of a scan loop,
 * not a fault, and they must never reach anything that can stop the scanner.
 * The two channels below are separate so that confusion is not expressible.
 */

/**
 * Why the camera is unavailable, classified into the cases staff can act on.
 *
 * Every one of them leaves manual entry working, so the UI treats them alike
 * and only the wording differs.
 */
export type ScannerErrorKind =
  | 'permission-denied'
  | 'no-camera'
  | 'camera-busy'
  | 'insecure-context'
  | 'unsupported'
  /** The camera was running and stopped — unplugged, or taken by another app. */
  | 'camera-stopped'
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

  /**
   * The scanner has **stopped working** and will produce no further decodes.
   *
   * Reserved for genuine hardware or permission faults — a camera unplugged
   * mid-shift, a track ended by the browser. It is never called because a frame
   * failed to decode. A caller may safely transition to a camera-error state
   * from here; that is the whole point of the name.
   */
  readonly onFatalError: (error: ScannerError) => void

  /**
   * Diagnostic only: an unexpected error surfaced by the decode loop that is
   * **not** one of the ordinary "no QR in this frame" conditions.
   *
   * Non-fatal by definition. The scanner keeps running, and callers must not
   * change state in response — it exists so an unfamiliar decoder fault can be
   * observed rather than silently swallowed.
   */
  readonly onDecodeIssue?: (error: unknown) => void
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
  /**
   * Requests camera access and begins decoding.
   *
   * Rejects with a {@link ScannerError} when the camera cannot be started at
   * all. **Startup failure is a rejection of this promise** — it is the only
   * way a start problem is reported, and it is deliberately a different channel
   * from anything the running decode loop emits.
   */
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
