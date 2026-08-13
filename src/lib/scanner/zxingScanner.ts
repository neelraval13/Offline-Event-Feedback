import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
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
  unsupported: 'This browser cannot use the camera here.',
  failed: 'The scanner could not be started.',
}

function scannerError(kind: ScannerErrorKind): ScannerError {
  return { kind, message: MESSAGES[kind] }
}

/**
 * Maps a `getUserMedia` failure onto something staff can act on.
 *
 * The browser reports these as DOMException names; the raw message is never
 * shown, because "NotReadableError: Could not start video source" tells an
 * operator nothing they can use.
 */
function classify(error: unknown): ScannerError {
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

/** Releases every track behind a video element, so no camera light stays on. */
function releaseStream(video: HTMLVideoElement): void {
  const source = video.srcObject

  if (source !== null && typeof source === 'object' && 'getTracks' in source) {
    for (const track of (source as MediaStream).getTracks()) {
      track.stop()
    }
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
          /*
           * ZXing reports a NotFoundException for every frame without a QR in
           * it, which is most of them. Only genuine faults are surfaced.
           */
          if (error !== undefined && error.name !== 'NotFoundException') {
            options.onError(scannerError('failed'))
          }
        },
      )
    } catch (error) {
      this.#video = null
      throw classify(error)
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
