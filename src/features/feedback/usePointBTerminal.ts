import { useCallback, useEffect, useRef, useState } from 'react'
import { recordContextFor } from '../../config/recordContext'
import { useEventLocation } from '../../lib/location/useEventLocation'
import { EVENT_CONFIG } from '../../config/event'
import type { EventLocation } from '../../config/eventLocations'
import {
  countFeedbackForEvent,
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
  type StickerIdentity,
} from './identityCapture'
import {
  FLYING_FLEA_FORM_VERSION,
  type FlyingFleaFeedbackV1Answers,
} from '../../types'

/*
 * Point B's workflow, as one explicit state machine.
 *
 *                    +-----------------------------+
 *                    v                             |
 *   idle -> starting-camera -> scanning -> feedback -> saving -> success
 *     |       |                   |  |                  |          |
 *     |       v                   |  +-> already-recorded          |
 *     |  camera-error <-----------+                     |          |
 *     |       |                   |                     v          |
 *     |       +---> manual-entry -+              (failure returns   |
 *     |       |                                    to feedback)     |
 *     |       +---> contact-entry ------------------------+         |
 *     +-----------------+  (failure stays put, everything kept)     |
 *                    ^                                              |
 *                    +----------------- next participant -----------+
 *
 * A single discriminated union rather than a handful of booleans: with flags,
 * "saving" and "already recorded" and "camera error" can all be true at once,
 * and the screen has to guess which one to believe. Here they cannot be.
 *
 * `contact-entry` carries its own `busy` flag instead of having a separate
 * saving state, and that is deliberate. The contact form owns a draft with a
 * name, a phone number, an email address and six answers in it; a separate
 * status would unmount and remount the form around the save, and a failed write
 * would greet the rider with an empty form. One state, one mounted component,
 * everything still there.
 *
 * ## The location gate sits in front of the whole machine
 *
 * Every entry point below returns early when this device has no city chosen,
 * and so does every save. That is stricter than Point A, which lets the form be
 * filled in and refuses at submit, and the asymmetry is deliberate: a response
 * is captured in seconds with a rider waiting, and discovering at the end of it
 * that the device was never configured would mean asking them to answer six
 * questions again. Refusing to start costs nobody anything.
 *
 * The gate is here rather than only in the screen because the screen is one
 * caller. A guard on the state machine is a guard on every path into it.
 *
 * ## The city is frozen for the duration of a response
 *
 * The selector stays visible so an operator can always see which city the
 * device is recording, but the value a response is saved with is the one that
 * was selected when THAT response started, carried on the state itself.
 *
 * The alternative, reading the current selection at submit, has a failure mode
 * nobody would catch: a rider answers six questions, the operator changes the
 * city for some unrelated reason, and the answers are filed under a city the
 * rider was never in. Nothing on screen would show it and nothing downstream
 * could detect it.
 *
 * So changing the selector mid-response affects the NEXT response, never the
 * one in progress, and the screen disables the control while a response is open
 * so that the rule is visible rather than merely true.
 */
export type PointBState =
  /** Camera not started yet. Manual and contact entry are available here. */
  | { readonly status: 'idle' }
  | { readonly status: 'starting-camera' }
  /** Decoding. `notice` carries a transient rejection message. */
  | { readonly status: 'scanning'; readonly notice: string | null }
  | { readonly status: 'camera-error'; readonly message: string }
  | { readonly status: 'manual-entry'; readonly error: string | null }
  /** The no-sticker path: contact details and the questionnaire, together. */
  | {
      readonly status: 'contact-entry'
      readonly busy: boolean
      /** Set when a save was attempted and failed. Everything typed is kept. */
      readonly saveError: string | null
      /** Frozen when this flow started. See the note on freezing below. */
      readonly location: EventLocation
    }
  | {
      readonly status: 'feedback'
      readonly identity: StickerIdentity
      /** Set when a save was attempted and failed. Answers are kept. */
      readonly saveError: string | null
      /** Frozen when this flow started. See the note on freezing below. */
      readonly location: EventLocation
    }
  | {
      readonly status: 'saving'
      readonly identity: StickerIdentity
      readonly location: EventLocation
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

  /*
   * The city, read once and remembered between riders.
   *
   * Owned here rather than in the screen so that the guards below and the
   * selector the operator sees can never disagree about which city is set.
   */
  const { location, setLocation, ready } = useEventLocation()

  /*
   * The current selection, readable from a closure that may be stale.
   *
   * `scanner.start` captures `onDecode` once, so a scan that happens after the
   * operator changes the city would otherwise freeze whatever the city was when
   * the camera started. A ref is always current, so the flow freezes what is
   * selected at the moment the participant is accepted, which is what "frozen
   * when the flow started" has to mean.
   */
  const locationRef = useRef<EventLocation | null>(location)
  locationRef.current = location

  const [state, setState] = useState<PointBState>({ status: 'idle' })
  const [savedCount, setSavedCount] = useState(0)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerRef = useRef<QrScanner | null>(null)
  const scannerRunningRef = useRef(false)
  const mountedRef = useRef(true)

  /*
   * The latch. A stationary sticker decodes on every video frame, dozens of
   * callbacks for one participant, so acceptance is gated on a ref that flips
   * synchronously, before any await. React state cannot do this job: it
   * updates on the next render, by which time five more frames have arrived.
   */
  const acceptingRef = useRef(false)
  /** Last rejected payload, so one wrong sticker does not re-render forever. */
  const lastRejectedRef = useRef<string | null>(null)
  /** Guards the submit path against a double tap. */
  const submittingRef = useRef(false)

  const refreshCount = useCallback(async () => {
    /*
     * This event's responses, not the table's lifetime total.
     *
     * The number is rider-facing: it answers "how is this event going". A
     * device re-used from a previous event without being wiped would otherwise
     * open the shift already reading forty, which is both wrong and alarming.
     */
    const total = await countFeedbackForEvent(db, EVENT_CONFIG.eventId)
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

  /**
   * Moves to the feedback form, unless this device already has a response.
   *
   * Sticker paths only. The duplicate guard is a question about a public code,
   * and a contact capture has none: see `hasFeedbackForPublicCode` for why no
   * equivalent guard exists on contact details.
   */
  const acceptIdentity = useCallback(
    async (identity: StickerIdentity) => {
      /*
       * The city is read here, at the moment this participant is accepted, and
       * carried on the state from now until the response is saved or abandoned.
       * Read from the ref rather than the closure so a scan that arrives after
       * the operator changed the selector uses the city that is selected now.
       */
      const capturedIn = locationRef.current
      if (capturedIn === null) {
        return
      }

      /*
       * Scoped to this event. A code from a previous event that happens to
       * match must not turn a real rider away; see the note on the store's
       * function.
       */
      const alreadyRecorded = await hasFeedbackForPublicCode(
        db,
        identity.publicCode,
        EVENT_CONFIG.eventId,
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

      setState({
        status: 'feedback',
        identity,
        saveError: null,
        location: capturedIn,
      })
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
    if (video === null || location === null) {
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
         * Fatal only. Frames that fail to decode never arrive here; they are
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
      // Unmounted while the permission prompt was open, do not leak the stream.
      void scanner.dispose()
      return
    }

    scannerRunningRef.current = true
    acceptingRef.current = true
    lastRejectedRef.current = null
    setState({ status: 'scanning', notice: null })
  }, [createScanner, handleDecode, location])

  const openManualEntry = useCallback(() => {
    if (location === null) {
      return
    }
    acceptingRef.current = false
    scannerRef.current?.pause()
    setState({ status: 'manual-entry', error: null })
  }, [location])

  /** The no-sticker path. Reachable from every screen that offers a way out. */
  const openContactEntry = useCallback(() => {
    if (location === null) {
      return
    }
    acceptingRef.current = false
    scannerRef.current?.pause()
    setState({
      status: 'contact-entry',
      busy: false,
      saveError: null,
      location,
    })
  }, [location])

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

  /*
   * Takes the answers rather than owning a draft.
   *
   * The questionnaire is the campaign's business and it validates its own
   * answers; this hook's business is identity capture, the save, and the
   * duplicate guard. Keeping a `feedback-v1` draft here was what made the old
   * questionnaire structurally hard to replace.
   */
  const submitFeedback = useCallback(
    async (answers: FlyingFleaFeedbackV1Answers) => {
      if (state.status !== 'feedback' || submittingRef.current) {
        return
      }

      /*
       * The city this response was started in, not the one currently selected.
       * Changing the selector while a rider is answering must not re-file their
       * answers under a city they were never in.
       */
      const capturedIn = state.location

    // Synchronous guard: a double tap lands both events before React re-renders,
    // and the database deliberately permits repeated public codes.
    submittingRef.current = true

    const { identity } = state
    setState({ status: 'saving', identity, location: capturedIn })

    try {
      const deviceId = await getOrCreateDeviceId(db)
      await createFeedback(db, {
        ...recordContextFor('feedback', deviceId),
        identity,
        location: capturedIn,
        formVersion: FLYING_FLEA_FORM_VERSION,
        answers,
      })
    } catch (error) {
      // Nothing committed. Stay on the form with every answer intact, still
      // filed under the city this response started in.
      if (mountedRef.current) {
        setState({
          status: 'feedback',
          identity,
          saveError: describe(error),
          location: capturedIn,
        })
      }
      submittingRef.current = false
      return
    }

      submittingRef.current = false

      if (mountedRef.current) {
        setState({ status: 'success' })
      }
      await refreshCount()
    },
    [refreshCount, state],
  )

  /**
   * Saves a response whose identity is the rider's own contact details.
   *
   * Structurally the same as `submitFeedback` and deliberately separate rather
   * than a branch inside it: this path carries its identity in with the answers
   * (the one form produces both together), where the sticker path captured its
   * identity several screens earlier and holds it in the state machine.
   *
   * Note what does not happen before the write: no lookup, no registration
   * search, no network call of any kind. The rider's details are what they are.
   * Whether they match a registration is a question the central server answers
   * later, and asking it here would make the flow depend on a connection that
   * an offline tablet at a venue does not have.
   */
  const submitContactFeedback = useCallback(
    async (
      identity: Extract<
        CapturedParticipantIdentity,
        { captureMethod: 'contact' }
      >,
      answers: FlyingFleaFeedbackV1Answers,
    ) => {
      if (state.status !== 'contact-entry' || submittingRef.current) {
        return
      }

      // The city this response started in, for the same reason as the sticker
      // path, and it matters more here: a direct response has no registration
      // anywhere that could be used to recover its city afterwards.
      const capturedIn = state.location

      submittingRef.current = true
      setState({
        status: 'contact-entry',
        busy: true,
        saveError: null,
        location: capturedIn,
      })

      try {
        const deviceId = await getOrCreateDeviceId(db)
        await createFeedback(db, {
          ...recordContextFor('feedback', deviceId),
          identity,
          location: capturedIn,
          formVersion: FLYING_FLEA_FORM_VERSION,
          answers,
        })
      } catch (error) {
        /*
         * Nothing committed. Stay exactly where we are: the form is still
         * mounted, so the name, phone, email and all six answers are still on
         * screen and the rider can press the button again.
         */
        if (mountedRef.current) {
          setState({
            status: 'contact-entry',
            busy: false,
            saveError: describe(error),
            location: capturedIn,
          })
        }
        submittingRef.current = false
        return
      }

      submittingRef.current = false

      if (mountedRef.current) {
        setState({ status: 'success' })
      }
      await refreshCount()
    },
    [refreshCount, state],
  )

  /**
   * Whether a response is open and therefore has a city already frozen to it.
   *
   * The screen disables the selector while this is true. Changing it would not
   * corrupt the open response, which carries its own city, but a control that
   * silently applies to the next rider rather than the one in front of the
   * operator is a control that will be misread. Disabling makes the rule
   * visible instead of merely correct.
   */
  const responseInProgress =
    state.status === 'feedback' ||
    state.status === 'saving' ||
    state.status === 'contact-entry'

  return {
    state,
    savedCount,
    location,
    setLocation,
    responseInProgress,
    /** False until a city is chosen. The screen shows the selector alone. */
    locationReady: ready,
    videoRef,
    startScanner,
    openManualEntry,
    openContactEntry,
    submitManualCode,
    returnToScanner,
    submitFeedback,
    submitContactFeedback,
  }
}
