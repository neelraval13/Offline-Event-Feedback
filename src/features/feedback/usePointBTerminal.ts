import { useCallback, useEffect, useRef, useState } from 'react'
import { recordContextFor } from '../../config/recordContext'
import {
  countFeedback,
  createFeedback,
  db,
  getOrCreateDeviceId,
  hasFeedbackForPublicCode,
} from '../../lib/storage'
import {
  createZxingScanner,
  isScannerError,
  type QrScanner,
  type QrScannerFactory,
} from '../../lib/scanner'
import type {
  CapturedParticipantIdentity,
  PublicParticipantCode,
} from '../../types'
import {
  captureIdentityFromManualCode,
  captureIdentityFromQr,
} from './identityCapture'
import {
  EMPTY_DRAFT,
  FEEDBACK_FORM_VERSION,
  validateFeedbackDraft,
  type FeedbackDraft,
  type FeedbackFieldErrors,
} from './questionnaire'

/*
 * Point B's workflow, as one explicit state machine.
 *
 *                    +-----------------------------+
 *                    v                             |
 *   idle -> starting-camera -> scanning -> feedback -> saving -> success
 *             |                   |  |                  |          |
 *             v                   |  +-> already-recorded          |
 *        camera-error <-----------+                     |          |
 *             |                   |                     v          |
 *             +---> manual-entry -+              (failure returns   |
 *                                                 to feedback)      |
 *                    ^                                              |
 *                    +----------------- next participant -----------+
 *
 * A single discriminated union rather than a handful of booleans: with flags,
 * "saving" and "already recorded" and "camera error" can all be true at once,
 * and the screen has to guess which one to believe. Here they cannot be.
 */
export type PointBState =
  /** Camera not started yet. Manual entry is available from here. */
  | { readonly status: 'idle' }
  | { readonly status: 'starting-camera' }
  /** Decoding. `notice` carries a transient rejection message. */
  | { readonly status: 'scanning'; readonly notice: string | null }
  | { readonly status: 'camera-error'; readonly message: string }
  | { readonly status: 'manual-entry'; readonly error: string | null }
  | {
      readonly status: 'feedback'
      readonly identity: CapturedParticipantIdentity
      /** Set when a save was attempted and failed. Answers are kept. */
      readonly saveError: string | null
    }
  | {
      readonly status: 'saving'
      readonly identity: CapturedParticipantIdentity
    }
  | {
      readonly status: 'already-recorded'
      readonly publicCode: PublicParticipantCode
    }
  | { readonly status: 'success' }

function describe(error: unknown): string {
  if (isScannerError(error)) {
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

export interface UsePointBTerminalOptions {
  /** Swapped for a fake in tests; the real one owns a camera. */
  readonly createScanner?: QrScannerFactory
}

export function usePointBTerminal(options: UsePointBTerminalOptions = {}) {
  const createScanner = options.createScanner ?? createZxingScanner

  const [state, setState] = useState<PointBState>({ status: 'idle' })
  const [draft, setDraft] = useState<FeedbackDraft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<FeedbackFieldErrors>({})
  const [savedCount, setSavedCount] = useState(0)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerRef = useRef<QrScanner | null>(null)
  const scannerRunningRef = useRef(false)
  const mountedRef = useRef(true)

  /*
   * The latch. A stationary sticker decodes on every video frame — dozens of
   * callbacks for one participant — so acceptance is gated on a ref that flips
   * synchronously, before any await. React state cannot do this job: it
   * updates on the next render, by which time five more frames have arrived.
   */
  const acceptingRef = useRef(false)
  /** Last rejected payload, so one wrong sticker does not re-render forever. */
  const lastRejectedRef = useRef<string | null>(null)
  /** Guards the submit path against a double tap. */
  const submittingRef = useRef(false)

  const refreshCount = useCallback(async () => {
    const total = await countFeedback(db)
    if (mountedRef.current) {
      setSavedCount(total)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    // Warm the device identity and the counter so the first participant of the
    // shift does not wait for either.
    void (async () => {
      try {
        await getOrCreateDeviceId(db)
        await refreshCount()
      } catch {
        // Diagnosed on the admin screen; Point B stays usable meanwhile.
      }
    })()

    return () => {
      mountedRef.current = false
      acceptingRef.current = false
      scannerRunningRef.current = false
      // Releasing the camera on unmount is not optional: without this the
      // capture light stays on after navigating away from Point B.
      void scannerRef.current?.dispose()
      scannerRef.current = null
    }
  }, [refreshCount])

  /** Moves to the feedback form, unless this device already has a response. */
  const acceptIdentity = useCallback(
    async (identity: CapturedParticipantIdentity) => {
      const alreadyRecorded = await hasFeedbackForPublicCode(
        db,
        identity.publicCode,
      )
      if (!mountedRef.current) {
        return
      }

      if (alreadyRecorded) {
        setState({
          status: 'already-recorded',
          publicCode: identity.publicCode,
        })
        return
      }

      setDraft(EMPTY_DRAFT)
      setErrors({})
      setState({ status: 'feedback', identity, saveError: null })
    },
    [],
  )

  const handleDecode = useCallback(
    (decoded: string) => {
      if (!acceptingRef.current) {
        return
      }

      const result = captureIdentityFromQr(decoded)

      if (!result.ok) {
        // Stay on the scanner. Repeating the same bad sticker is silent.
        if (lastRejectedRef.current !== decoded) {
          lastRejectedRef.current = decoded
          setState({ status: 'scanning', notice: result.message })
        }
        return
      }

      // Latch first, then stop decoding: between these two lines more frames
      // may arrive, and the ref is what turns them away.
      acceptingRef.current = false
      lastRejectedRef.current = null
      scannerRef.current?.pause()

      void acceptIdentity(result.identity)
    },
    [acceptIdentity],
  )

  const startScanner = useCallback(async () => {
    const video = videoRef.current
    if (video === null) {
      return
    }

    setState({ status: 'starting-camera' })

    const scanner = scannerRef.current ?? createScanner()
    scannerRef.current = scanner

    try {
      await scanner.start({
        video,
        onDecode: handleDecode,
        /*
         * Fatal only. Frames that fail to decode never arrive here — they are
         * the normal condition of a scan loop, and treating them as faults is
         * what previously killed the camera on its first frame.
         */
        onFatalError: (error) => {
          if (mountedRef.current) {
            acceptingRef.current = false
            scannerRunningRef.current = false
            setState({ status: 'camera-error', message: error.message })
          }
        },
      })
    } catch (error) {
      if (mountedRef.current) {
        scannerRunningRef.current = false
        setState({ status: 'camera-error', message: describe(error) })
      }
      return
    }

    if (!mountedRef.current) {
      // Unmounted while the permission prompt was open — do not leak the stream.
      void scanner.dispose()
      return
    }

    scannerRunningRef.current = true
    acceptingRef.current = true
    lastRejectedRef.current = null
    setState({ status: 'scanning', notice: null })
  }, [createScanner, handleDecode])

  const openManualEntry = useCallback(() => {
    acceptingRef.current = false
    scannerRef.current?.pause()
    setState({ status: 'manual-entry', error: null })
  }, [])

  const submitManualCode = useCallback(
    async (typed: string) => {
      const result = captureIdentityFromManualCode(typed)

      if (!result.ok) {
        setState({ status: 'manual-entry', error: result.message })
        return
      }

      await acceptIdentity(result.identity)
    },
    [acceptIdentity],
  )

  /** Returns to the camera, or to the start screen if it was never running. */
  const returnToScanner = useCallback(() => {
    setDraft(EMPTY_DRAFT)
    setErrors({})
    lastRejectedRef.current = null

    if (scannerRunningRef.current) {
      // Reuse the authorised stream rather than re-prompting for permission.
      scannerRef.current?.resume()
      acceptingRef.current = true
      setState({ status: 'scanning', notice: null })
      return
    }

    acceptingRef.current = false
    setState({ status: 'idle' })
  }, [])

  const updateDraft = useCallback((patch: Partial<FeedbackDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
  }, [])

  const submitFeedback = useCallback(async () => {
    if (state.status !== 'feedback' || submittingRef.current) {
      return
    }

    const validation = validateFeedbackDraft(draft)
    if (!validation.ok) {
      setErrors(validation.errors)
      return
    }

    // Synchronous guard: a double tap lands both events before React re-renders,
    // and the database deliberately permits repeated public codes.
    submittingRef.current = true
    setErrors({})

    const { identity } = state
    setState({ status: 'saving', identity })

    try {
      const deviceId = await getOrCreateDeviceId(db)
      await createFeedback(db, {
        ...recordContextFor('feedback', deviceId),
        identity,
        formVersion: FEEDBACK_FORM_VERSION,
        answers: validation.answers,
      })
    } catch (error) {
      // Nothing committed. Stay on the form with every answer intact.
      if (mountedRef.current) {
        setState({ status: 'feedback', identity, saveError: describe(error) })
      }
      submittingRef.current = false
      return
    }

    submittingRef.current = false

    if (mountedRef.current) {
      setState({ status: 'success' })
    }
    await refreshCount()
  }, [draft, refreshCount, state])

  return {
    state,
    draft,
    errors,
    savedCount,
    videoRef,
    startScanner,
    openManualEntry,
    submitManualCode,
    returnToScanner,
    updateDraft,
    submitFeedback,
  }
}
