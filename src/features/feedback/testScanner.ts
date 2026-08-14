import type {
  QrScanner,
  ScannerError,
  ScannerStartOptions,
} from '../../lib/scanner'

/**
 * A scanner with no camera.
 *
 * Tests drive decode callbacks directly, which is the only way to exercise the
 * cases that matter: a sticker decoding on forty consecutive frames, a
 * permission refusal, a camera dying mid-shift, and (the one that reached
 * production) thousands of ordinary frames containing no QR at all.
 */
export class FakeScanner implements QrScanner {
  startCalls = 0
  disposeCalls = 0
  running = false
  paused = false
  disposed = false

  /** Set to make the next `start` reject, as a refused permission would. */
  startFailure: ScannerError | null = null

  #options: ScannerStartOptions | null = null

  async start(options: ScannerStartOptions): Promise<void> {
    this.startCalls += 1

    if (this.startFailure !== null) {
      throw this.startFailure
    }

    this.#options = options
    this.running = true
    this.paused = false
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1
    this.disposed = true
    this.running = false
    this.#options = null
  }

  /** One decoded frame, as a well-behaved scanner would deliver it. */
  emit(text: string): void {
    if (this.running && !this.paused) {
      this.#options?.onDecode(text)
    }
  }

  /**
   * A decode delivered regardless of pause state.
   *
   * Real frames are already in flight when `pause()` is called, so they arrive
   * afterwards. This is the harsher test: the latch, not the pause, is what has
   * to hold.
   */
  emitRaw(text: string): void {
    this.#options?.onDecode(text)
  }

  /**
   * An unfamiliar decoder fault: the diagnostic channel.
   *
   * Non-fatal by contract. A real adapter routes anything it does not recognise
   * here, and the terminal must not change state because of it.
   */
  emitDecodeIssue(error: unknown): void {
    this.#options?.onDecodeIssue?.(error)
  }

  /**
   * The camera has genuinely stopped, unplugged, or seized by another app.
   *
   * The only non-startup path that may put Point B into a camera error.
   */
  fail(error: ScannerError): void {
    this.#options?.onFatalError(error)
  }
}
