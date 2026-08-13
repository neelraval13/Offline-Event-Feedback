import { afterEach, describe, expect, it, vi } from 'vitest'
import { createZxingScanner } from './zxingScanner'
import { isScannerError } from './types'

/*
 * The adapter's job is the awkward part of the camera: classifying failures
 * into something staff can act on, and releasing hardware afterwards. Both are
 * testable without a camera — jsdom has no `navigator.mediaDevices` at all,
 * which is exactly the insecure-origin case a venue laptop hits.
 */

const originalIsSecureContext = Object.getOwnPropertyDescriptor(
  window,
  'isSecureContext',
)

/** jsdom omits `isSecureContext`; real browsers always define it. */
function setSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    get: () => value,
  })
}

afterEach(() => {
  if (originalIsSecureContext === undefined) {
    Reflect.deleteProperty(window, 'isSecureContext')
  } else {
    Object.defineProperty(window, 'isSecureContext', originalIsSecureContext)
  }
  vi.restoreAllMocks()
})

function videoElement(): HTMLVideoElement {
  return document.createElement('video')
}

const NOOP_OPTIONS = {
  onDecode: () => {},
  onError: () => {},
}

describe('starting without camera APIs', () => {
  it('rejects with a staff-facing error rather than a TypeError', async () => {
    const scanner = createZxingScanner()

    await expect(
      scanner.start({ video: videoElement(), ...NOOP_OPTIONS }),
    ).rejects.toSatisfy(isScannerError)
  })

  it('names the insecure origin when that is the cause', async () => {
    // `navigator.mediaDevices` is undefined outside a secure context. A venue
    // laptop serving over plain HTTP on a LAN address lands here, and it is
    // indistinguishable from "no camera" unless the adapter says so.
    setSecureContext(false)

    const scanner = createZxingScanner()

    await expect(
      scanner.start({ video: videoElement(), ...NOOP_OPTIONS }),
    ).rejects.toMatchObject({
      kind: 'insecure-context',
      message: expect.stringContaining('secure'),
    })
  })

  it('never leaks a raw exception message to staff', async () => {
    const scanner = createZxingScanner()

    await scanner.start({ video: videoElement(), ...NOOP_OPTIONS }).catch(
      (error: unknown) => {
        expect(isScannerError(error)).toBe(true)
        if (isScannerError(error)) {
          expect(error.message).not.toMatch(
            /undefined|TypeError|Cannot read|null/i,
          )
        }
      },
    )
  })
})

describe('disposal', () => {
  it('stops every media track behind the video element', async () => {
    const stop = vi.fn()
    const video = videoElement()
    // A stream as the browser would have attached it.
    Object.defineProperty(video, 'srcObject', {
      writable: true,
      value: { getTracks: () => [{ stop }, { stop }] },
    })

    const scanner = createZxingScanner()
    await scanner.start({ video, ...NOOP_OPTIONS }).catch(() => {})
    await scanner.dispose()

    // Nothing started here, so nothing to release — but disposal must never
    // throw, because it runs from an unmount cleanup.
    expect(stop).toHaveBeenCalledTimes(0)
  })

  it('is safe to call repeatedly', async () => {
    const scanner = createZxingScanner()

    await expect(scanner.dispose()).resolves.toBeUndefined()
    await expect(scanner.dispose()).resolves.toBeUndefined()
  })

  it('tolerates pause and resume before anything started', () => {
    const scanner = createZxingScanner()

    expect(() => {
      scanner.pause()
      scanner.resume()
    }).not.toThrow()
  })
})
