import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
import {
  ChecksumException,
  FormatException,
  NotFoundException,
} from '@zxing/library'
import type {
  QrScanner,
  ScannerError,
  ScannerErrorKind,
  ScannerStartOptions,
} from './types'

/*
 * ZXing adapter.
 *
 * `BrowserQRCodeReader` decodes QR only — the multi-format readers try every
 * barcode symbology on every frame, which costs CPU on a tablet and can only
 * produce results this app would reject anyway.
 *
 * Everything is local: the library is bundled, decoding happens on frames in
 * this process, and no image ever leaves the device.
 */

/** Rear camera where there is one; browsers fall back on their own if not. */
const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: 'environment' },
  audio: false,
}

const MESSAGES: Record<ScannerErrorKind, string> = {
  'permission-denied':
    'Camera access was refused. Allow the camera in the browser, or enter the code manually.',
  'no-camera': 'No camera was found on this device.',
  'camera-busy':
    'The camera is in use by another app. Close it and try again, or enter the code manually.',
  'insecure-context':
    'The browser only allows camera access over a secure (https) address.',
  'camera-stopped':
    'The camera stopped. Start it again, or enter the code manually.',
  unsupported: 'This browser cannot use the camera here.',
  failed: 'The scanner could not be started.',
}

function scannerError(kind: ScannerErrorKind): ScannerError {
  return { kind, message: MESSAGES[kind] }
}

/*
 * Ordinary scan-loop conditions.
 *
 * A continuous decoder reports one of these for essentially every frame it
 * looks at. `NotFoundException` means "no QR in this frame", which is the
 * normal state of a camera pointed at a desk; `ChecksumException` and
 * `FormatException` mean a candidate symbol was spotted but could not be
 * validated or decoded — a sticker at a bad angle, half out of frame, or
 * blurred by motion. ZXing itself treats all three as retryable.
 *
 * Classification is by `instanceof`, not by name. `@zxing/library` builds its
 * exceptions on `ts-custom-error`, which sets `name` from the *constructor
 * function's* name — so a minified production build reports `name` as whatever
 * single letter the bundler chose, and any string comparison against
 * 'NotFoundException' silently stops matching. That is precisely the bug this
 * replaced.
 */
const DECODE_MISS_KINDS: ReadonlySet<string> = new Set([
  'NotFoundException',
  'ChecksumException',
  'FormatException',
])

/**
 * Reads ZXing's static `kind` discriminator from an exception.
 *
 * A belt-and-braces fallback behind `instanceof`: `kind` is a string *literal*
 * on the class, so unlike the function name it survives minification intact,
 * and it still matches if two copies of the library ever end up loaded (where
 * `instanceof` would compare different constructors and fail).
 */
function kindOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }

  const constructor = (error as { constructor?: { kind?: unknown } }).constructor
  if (typeof constructor?.kind === 'string') {
    return constructor.kind
  }

  const getKind = (error as { getKind?: () => unknown }).getKind
  if (typeof getKind === 'function') {
    const kind = getKind.call(error)
    if (typeof kind === 'string') {
      return kind
    }
  }

  return null
}

/** Whether this is a frame that simply did not decode. */
export function isOrdinaryDecodeMiss(error: unknown): boolean {
  if (
    error instanceof NotFoundException ||
    error instanceof ChecksumException ||
    error instanceof FormatException
  ) {
    return true
  }

  const kind = kindOf(error)
  return kind !== null && DECODE_MISS_KINDS.has(kind)
}

/**
 * Maps a `getUserMedia` failure onto something staff can act on.
 *
 * The browser reports these as DOMException names; the raw message is never
 * shown, because "NotReadableError: Could not start video source" tells an
 * operator nothing they can use.
 */
function classifyStartFailure(error: unknown): ScannerError {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : ''

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return scannerError('permission-denied')
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return scannerError('no-camera')
    case 'NotReadableError':
    case 'TrackStartError':
      return scannerError('camera-busy')
    default:
      return scannerError('failed')
  }
}

/** The tracks behind a video element, if a stream is attached. */
function tracksOf(video: HTMLVideoElement): MediaStreamTrack[] {
  const source: unknown = video.srcObject

  if (
    typeof source === 'object' &&
    source !== null &&
    'getTracks' in source &&
    typeof (source as MediaStream).getTracks === 'function'
  ) {
    return (source as MediaStream).getTracks()
  }

  return []
}

/** Releases every track behind a video element, so no camera light stays on. */
function releaseStream(video: HTMLVideoElement): void {
  for (const track of tracksOf(video)) {
    track.stop()
  }
  video.srcObject = null
}

class ZxingQrScanner implements QrScanner {
  #reader = new BrowserQRCodeReader()
  #controls: IScannerControls | null = null
  #video: HTMLVideoElement | null = null
  #paused = false
  #disposed = false

  async start(options: ScannerStartOptions): Promise<void> {
    if (this.#controls !== null) {
      // Already running; treat a second start as a resume rather than opening
      // a second camera stream.
      this.resume()
      return
    }

    if (
      typeof navigator === 'undefined' ||
      navigator.mediaDevices === undefined
    ) {
      /*
       * `navigator.mediaDevices` is undefined outside a secure context. A
       * venue laptop serving over plain HTTP on a LAN address hits exactly
       * this, and it is indistinguishable from "no camera" unless we say so.
       */
      throw scannerError(
        typeof window !== 'undefined' && window.isSecureContext === false
          ? 'insecure-context'
          : 'unsupported',
      )
    }

    this.#video = options.video
    this.#paused = false
    this.#disposed = false

    try {
      this.#controls = await this.#reader.decodeFromConstraints(
        VIDEO_CONSTRAINTS,
        options.video,
        (result, error) => {
          if (this.#paused || this.#disposed) {
            return
          }

          if (result !== undefined) {
            options.onDecode(result.getText())
            return
          }

          if (error === undefined) {
            return
          }

          /*
           * Everything below this line is a frame that did not decode. None of
           * it is fatal, none of it stops the scanner, and none of it reaches
           * `onFatalError`. The loop simply looks at the next frame.
           */
          if (isOrdinaryDecodeMiss(error)) {
            return
          }

          // Unfamiliar, so worth surfacing — but still not a reason to stop.
          options.onDecodeIssue?.(error)
        },
      )
    } catch (error) {
      // Startup failure: the only channel that reports a camera that never ran.
      this.#video = null
      throw classifyStartFailure(error)
    }

    this.#watchForCameraLoss(options)
  }

  /**
   * The genuine mid-shift fault signal.
   *
   * A camera that is unplugged, or seized by another application, ends its
   * track. That — not a decoder exception — is what "the camera died" actually
   * looks like, and it is the only thing besides a failed start that may reach
   * `onFatalError`.
   */
  #watchForCameraLoss(options: ScannerStartOptions): void {
    for (const track of tracksOf(options.video)) {
      // Defensive: this runs after the scanner is already live, so a failure to
      // attach a watcher must never propagate out of `start()` and be reported
      // as the camera having failed to start.
      if (typeof track.addEventListener !== 'function') {
        continue
      }

      track.addEventListener(
        'ended',
        () => {
          if (!this.#disposed) {
            options.onFatalError(scannerError('camera-stopped'))
          }
        },
        { once: true },
      )
    }
  }

  pause(): void {
    this.#paused = true
  }

  resume(): void {
    this.#paused = false
  }

  async dispose(): Promise<void> {
    this.#disposed = true
    this.#paused = true

    this.#controls?.stop()
    this.#controls = null

    if (this.#video !== null) {
      releaseStream(this.#video)
      this.#video = null
    }
  }
}

/** Builds a scanner backed by the bundled ZXing reader. */
export function createZxingScanner(): QrScanner {
  return new ZxingQrScanner()
}
