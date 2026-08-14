import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
import {
  ChecksumException,
  FormatException,
  NotFoundException,
  Result,
} from '@zxing/library'
import { createZxingScanner, isOrdinaryDecodeMiss } from './zxingScanner'
import { isScannerError, type ScannerError } from './types'

/*
 * The adapter's job is the awkward part of the camera: telling a frame that did
 * not decode apart from a camera that is not working, and releasing hardware
 * afterwards. Both are testable without a camera.
 */

type DecodeCallback = (
  result: Result | undefined,
  error: Error | undefined,
  controls: IScannerControls,
) => void

const originalIsSecureContext = Object.getOwnPropertyDescriptor(
  window,
  'isSecureContext',
)
const originalMediaDevices = Object.getOwnPropertyDescriptor(
  navigator,
  'mediaDevices',
)

/** jsdom omits `isSecureContext`; real browsers always define it. */
function setSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    get: () => value,
  })
}

/** jsdom has no media stack at all; the adapter only checks it is present. */
function stubMediaDevices(): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  })
}

afterEach(() => {
  if (originalIsSecureContext === undefined) {
    Reflect.deleteProperty(window, 'isSecureContext')
  } else {
    Object.defineProperty(window, 'isSecureContext', originalIsSecureContext)
  }
  if (originalMediaDevices === undefined) {
    Reflect.deleteProperty(navigator, 'mediaDevices')
  } else {
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
  }
  vi.restoreAllMocks()
})

function videoElement(): HTMLVideoElement {
  return document.createElement('video')
}

describe('classifying decode misses', () => {
  it('recognises the three ordinary scan-loop exceptions', () => {
    // A continuous decoder reports one of these for essentially every frame it
    // looks at. None of them is a fault.
    expect(isOrdinaryDecodeMiss(new NotFoundException())).toBe(true)
    expect(isOrdinaryDecodeMiss(new ChecksumException())).toBe(true)
    expect(isOrdinaryDecodeMiss(new FormatException())).toBe(true)
  })

  it('still recognises them when the class name has been minified away', () => {
    /*
     * The regression that reached production. `@zxing/library` builds its
     * exceptions on `ts-custom-error`, which sets `name` from the constructor
     * *function's* name, so a minified build reports `name` as whatever single
     * letter the bundler chose. The old guard compared `error.name` against
     * 'NotFoundException' and therefore matched nothing in the built app.
     *
     * `kind` is a string literal on the class, so it survives minification.
     */
    class t extends Error {
      static kind = 'NotFoundException'
    }
    const minified = new t()

    expect(minified.name).not.toBe('NotFoundException')
    expect(isOrdinaryDecodeMiss(minified)).toBe(true)
  })

  it('reads kind through getKind() as well', () => {
    const viaMethod = { getKind: () => 'ChecksumException' }
    expect(isOrdinaryDecodeMiss(viaMethod)).toBe(true)
  })

  it('does not swallow genuinely unfamiliar errors', () => {
    expect(isOrdinaryDecodeMiss(new Error('something else'))).toBe(false)
    expect(isOrdinaryDecodeMiss(new TypeError('bad'))).toBe(false)
    expect(isOrdinaryDecodeMiss('a string')).toBe(false)
    expect(isOrdinaryDecodeMiss(null)).toBe(false)
    expect(isOrdinaryDecodeMiss(undefined)).toBe(false)
  })
})

describe('the running decode loop', () => {
  let callback: DecodeCallback
  let onDecode: Mock<(text: string) => void>
  let onFatalError: Mock<(error: ScannerError) => void>
  let onDecodeIssue: Mock<(error: unknown) => void>
  let stop: Mock<() => void>

  beforeEach(async () => {
    stubMediaDevices()
    onDecode = vi.fn<(text: string) => void>()
    onFatalError = vi.fn<(error: ScannerError) => void>()
    onDecodeIssue = vi.fn<(error: unknown) => void>()
    stop = vi.fn<() => void>()

    // Capture the callback ZXing would have been driving, so real exceptions
    // can be pushed through the real adapter without a camera.
    vi.spyOn(
      BrowserQRCodeReader.prototype,
      'decodeFromConstraints',
    ).mockImplementation(
      async (_constraints, _video, decodeCallback): Promise<IScannerControls> => {
        callback = decodeCallback as DecodeCallback
        return { stop } as IScannerControls
      },
    )

    const scanner = createZxingScanner()
    await scanner.start({
      video: videoElement(),
      onDecode,
      onFatalError,
      onDecodeIssue,
    })
  })

  function frame(error: Error): void {
    callback(undefined, error, { stop } as IScannerControls)
  }

  it('ignores a frame with no QR in it', () => {
    frame(new NotFoundException())

    expect(onFatalError).not.toHaveBeenCalled()
    expect(onDecodeIssue).not.toHaveBeenCalled()
    expect(onDecode).not.toHaveBeenCalled()
  })

  it('ignores a candidate symbol that fails its checksum', () => {
    frame(new ChecksumException())

    expect(onFatalError).not.toHaveBeenCalled()
    expect(onDecodeIssue).not.toHaveBeenCalled()
  })

  it('ignores a candidate symbol that fails to decode', () => {
    frame(new FormatException())

    expect(onFatalError).not.toHaveBeenCalled()
    expect(onDecodeIssue).not.toHaveBeenCalled()
  })

  it('survives thousands of consecutive misses', () => {
    // Roughly a minute of a camera pointed at a desk.
    for (let i = 0; i < 2_000; i += 1) {
      frame(new NotFoundException())
    }

    expect(onFatalError).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })

  it('still decodes a real QR after a long run of misses', () => {
    for (let i = 0; i < 500; i += 1) {
      frame(new NotFoundException())
    }

    const result = { getText: () => 'PAYLOAD' } as Result
    callback(result, undefined, { stop } as IScannerControls)

    expect(onDecode).toHaveBeenCalledExactlyOnceWith('PAYLOAD')
    expect(onFatalError).not.toHaveBeenCalled()
  })

  it('reports an unfamiliar decoder fault without treating it as fatal', () => {
    frame(new TypeError('decoder blew up'))

    expect(onDecodeIssue).toHaveBeenCalledTimes(1)
    expect(onFatalError).not.toHaveBeenCalled()
  })

  it('never routes a decode-loop error to the fatal channel', () => {
    for (const error of [
      new NotFoundException(),
      new ChecksumException(),
      new FormatException(),
      new TypeError('unfamiliar'),
      new Error('also unfamiliar'),
    ]) {
      frame(error)
    }

    expect(onFatalError).not.toHaveBeenCalled()
  })
})

describe('startup failures', () => {
  it('rejects when the camera cannot be started at all', async () => {
    stubMediaDevices()
    const denied = Object.assign(new Error('denied'), {
      name: 'NotAllowedError',
    })
    vi.spyOn(
      BrowserQRCodeReader.prototype,
      'decodeFromConstraints',
    ).mockRejectedValue(denied)

    const scanner = createZxingScanner()

    await expect(
      scanner.start({
        video: videoElement(),
        onDecode: vi.fn(),
        onFatalError: vi.fn(),
      }),
    ).rejects.toMatchObject({ kind: 'permission-denied' })
  })

  it('classifies a busy camera', async () => {
    stubMediaDevices()
    vi.spyOn(
      BrowserQRCodeReader.prototype,
      'decodeFromConstraints',
    ).mockRejectedValue(
      Object.assign(new Error('in use'), { name: 'NotReadableError' }),
    )

    const scanner = createZxingScanner()

    await expect(
      scanner.start({
        video: videoElement(),
        onDecode: vi.fn(),
        onFatalError: vi.fn(),
      }),
    ).rejects.toMatchObject({ kind: 'camera-busy' })
  })

  it('rejects with a staff-facing error rather than a TypeError', async () => {
    const scanner = createZxingScanner()

    await expect(
      scanner.start({
        video: videoElement(),
        onDecode: vi.fn(),
        onFatalError: vi.fn(),
      }),
    ).rejects.toSatisfy(isScannerError)
  })

  it('names the insecure origin when that is the cause', async () => {
    // `navigator.mediaDevices` is undefined outside a secure context. A venue
    // laptop serving over plain HTTP on a LAN address lands here, and it is
    // indistinguishable from "no camera" unless the adapter says so.
    setSecureContext(false)

    const scanner = createZxingScanner()

    await expect(
      scanner.start({
        video: videoElement(),
        onDecode: vi.fn(),
        onFatalError: vi.fn(),
      }),
    ).rejects.toMatchObject({
      kind: 'insecure-context',
      message: expect.stringContaining('secure'),
    })
  })

  it('never leaks a raw exception message to staff', async () => {
    const scanner = createZxingScanner()

    await scanner
      .start({
        video: videoElement(),
        onDecode: vi.fn(),
        onFatalError: vi.fn(),
      })
      .catch((error: unknown) => {
        expect(isScannerError(error)).toBe(true)
        if (isScannerError(error)) {
          expect(error.message).not.toMatch(
            /undefined|TypeError|Cannot read|null/i,
          )
        }
      })
  })
})

describe('losing the camera mid-shift', () => {
  it('reports a track that ends as fatal', async () => {
    stubMediaDevices()
    const listeners: (() => void)[] = []
    const track = {
      stop: vi.fn(),
      addEventListener: (_event: string, listener: () => void) => {
        listeners.push(listener)
      },
    }
    const video = videoElement()
    Object.defineProperty(video, 'srcObject', {
      writable: true,
      value: { getTracks: () => [track] },
    })

    vi.spyOn(
      BrowserQRCodeReader.prototype,
      'decodeFromConstraints',
    ).mockResolvedValue({ stop: vi.fn() } as IScannerControls)

    const onFatalError = vi.fn()
    const scanner = createZxingScanner()
    await scanner.start({ video, onDecode: vi.fn(), onFatalError })

    // A camera unplugged, or seized by another app. This, not a decoder
    // exception, is what a dead camera actually looks like.
    expect(listeners).toHaveLength(1)
    listeners[0]?.()

    expect(onFatalError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'camera-stopped' }),
    )
  })
})

describe('disposal', () => {
  it('stops every media track behind the video element', async () => {
    stubMediaDevices()
    const stop = vi.fn()
    const video = videoElement()
    Object.defineProperty(video, 'srcObject', {
      writable: true,
      value: {
        getTracks: () => [
          { stop, addEventListener: vi.fn() },
          { stop, addEventListener: vi.fn() },
        ],
      },
    })

    vi.spyOn(
      BrowserQRCodeReader.prototype,
      'decodeFromConstraints',
    ).mockResolvedValue({ stop: vi.fn() } as IScannerControls)

    const scanner = createZxingScanner()
    await scanner.start({
      video,
      onDecode: vi.fn(),
      onFatalError: vi.fn(),
    })
    await scanner.dispose()

    expect(stop).toHaveBeenCalledTimes(2)
    expect(video.srcObject).toBeNull()
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
