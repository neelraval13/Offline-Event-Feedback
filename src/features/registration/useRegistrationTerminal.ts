import { useCallback, useEffect, useRef, useState } from 'react'
import { recordContextFor } from '../../config/recordContext'
import {
  qrPayloadForRegistration,
  serializeQrPayload,
} from '../../lib/identity/qrPayload'
import { printDocument } from '../../lib/print/print'
import { renderQrSvg } from '../../lib/qr/qrCode'
import {
  createRegistration,
  db,
  getOrCreateDeviceId,
  listRecentRegistrations,
  updateRegistration,
} from '../../lib/storage'
import type { RecordId, RegistrationRecord } from '../../types'
import type { RegistrationFormValues } from './validation'

/** How many recent records the reprint/recovery list keeps in view. */
export const RECENT_REGISTRATION_LIMIT = 8

/**
 * Progress of the sticker for the registration currently in hand.
 *
 * Deliberately separate from the registration's own state: a registration is
 * saved or it is not, and that fact never depends on what the QR renderer or
 * the printer did afterwards.
 */
export type StickerState =
  | { readonly status: 'rendering' }
  | { readonly status: 'ready'; readonly qrSvg: string }
  | { readonly status: 'failed'; readonly message: string }

export type TerminalPhase =
  /** Taking details for a participant. */
  | { readonly status: 'entry' }
  /** A save is in flight. Submissions are refused until it settles. */
  | { readonly status: 'saving' }
  /** Committed to IndexedDB. `record` is the authority for everything printed. */
  | {
      readonly status: 'saved'
      readonly record: RegistrationRecord
      readonly sticker: StickerState
      /**
       * Whether `print()` has been invoked for the record currently in hand.
       *
       * Screen state and nothing else. It is never written to IndexedDB, never
       * put on the wire, never part of a `RegistrationRecord` and never moves
       * `revision`: a registration is the same registration whether or not
       * somebody has pressed print, and persisting this would be inventing a
       * fact about a participant out of a UI event.
       *
       * It also means less than it sounds like. The browser cannot tell us
       * whether a label came out, whether the printer was on, or whether the
       * operator cancelled the dialog, so this records exactly one thing: the
       * print path was invoked. That is enough for the only thing it is used
       * for, which is deciding whether the obvious next action is "print this"
       * or "next rider".
       *
       * It resets whenever the active record changes: a new save starts false,
       * and so does bringing an earlier record back through `reprint`. A
       * sticker retry keeps it, because the rider in hand has not changed.
       */
      readonly printAttempted: boolean
    }
  /** Nothing was written. Safe to correct the details and try again. */
  | { readonly status: 'save-failed'; readonly message: string }

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Point A's orchestration.
 *
 * The ordering here is the system's first invariant, and it is the only reason
 * this hook exists rather than the screen calling storage directly:
 *
 *   validate -> save -> await the IndexedDB commit -> render QR -> print
 *
 * A sticker cannot be produced before the record is committed, because the
 * record returned by `createRegistration` is the sole input to the QR payload
 * and there is no other path to a `Sticker`. If the save throws, the phase goes
 * to `save-failed`, no sticker state exists, and nothing can be printed.
 *
 * Identity is never minted here. `createRegistration` owns participant IDs,
 * public codes and the sequence counter; this hook passes it contact details
 * and provenance, and treats what comes back as fact.
 */
export function useRegistrationTerminal() {
  const [phase, setPhase] = useState<TerminalPhase>({ status: 'entry' })
  const [recent, setRecent] = useState<RegistrationRecord[]>([])
  const [deviceReady, setDeviceReady] = useState(false)
  const [deviceError, setDeviceError] = useState<string | null>(null)

  /* Guards a second submit while the first is still in the transaction. State
   * updates are async, so the boolean phase alone cannot close the window
   * between two fast Enter presses. */
  const savingRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refreshRecent = useCallback(async () => {
    const records = await listRecentRegistrations(db, RECENT_REGISTRATION_LIMIT)
    if (mountedRef.current) {
      setRecent(records)
    }
  }, [])

  /* Provision device identity and load recent records once, on open. Doing it
   * here means the first participant of the day does not wait for it. */
  useEffect(() => {
    void (async () => {
      try {
        await getOrCreateDeviceId(db)
        if (mountedRef.current) {
          setDeviceReady(true)
        }
        await refreshRecent()
      } catch (error) {
        if (mountedRef.current) {
          setDeviceError(describe(error))
        }
      }
    })()
  }, [refreshRecent])

  /**
   * Renders the sticker for an already-saved record. Never creates anything.
   *
   * `printAttempted` is carried in rather than reset here, because this is
   * reached from three places that disagree about it: a new save and a reprint
   * both start a fresh record and pass `false`, while a sticker retry is the
   * same rider still in hand and passes whatever was already true.
   */
  const renderStickerFor = useCallback(
    async (record: RegistrationRecord, printAttempted: boolean) => {
      try {
        const payload = serializeQrPayload(qrPayloadForRegistration(record))
        const qrSvg = await renderQrSvg(payload)

        if (mountedRef.current) {
          setPhase({
            status: 'saved',
            record,
            sticker: { status: 'ready', qrSvg },
            printAttempted,
          })
        }
      } catch (error) {
        // The registration is already safe. This is a rendering problem, and the
        // operator must not be told to register the participant again.
        if (mountedRef.current) {
          setPhase({
            status: 'saved',
            record,
            sticker: { status: 'failed', message: describe(error) },
            printAttempted,
          })
        }
      }
    },
    [],
  )

  const submit = useCallback(
    async (values: RegistrationFormValues) => {
      if (savingRef.current) {
        return
      }
      savingRef.current = true
      setPhase({ status: 'saving' })

      let saved: RegistrationRecord
      try {
        const deviceId = await getOrCreateDeviceId(db)
        const context = recordContextFor('registration', deviceId)

        saved = await createRegistration(db, { ...context, ...values })
      } catch (error) {
        // Nothing committed, so nothing to print. The form keeps its values.
        if (mountedRef.current) {
          setPhase({ status: 'save-failed', message: describe(error) })
        }
        savingRef.current = false
        return
      }

      savingRef.current = false

      // Past this line the participant exists on disk. Everything that follows
      // is recoverable and must never invalidate the record.
      if (mountedRef.current) {
        setPhase({
          status: 'saved',
          record: saved,
          sticker: { status: 'rendering' },
          printAttempted: false,
        })
      }
      await renderStickerFor(saved, false)
      await refreshRecent()
    },
    [refreshRecent, renderStickerFor],
  )

  /** Retries QR rendering for the saved record after a rendering failure. */
  const retrySticker = useCallback(async () => {
    if (phase.status !== 'saved') {
      return
    }
    // The same rider is still in hand, so whether they have been printed for is
    // still whatever it was. Only the sticker is being redone.
    const { record, printAttempted } = phase
    setPhase({ status: 'saved', record, sticker: { status: 'rendering' }, printAttempted })
    await renderStickerFor(record, printAttempted)
  }, [phase, renderStickerFor])

  /**
   * Brings an earlier record back as the active sticker: the recovery path
   * after a refresh, and the reprint path for a jam noticed later.
   *
   * Re-renders the QR from the stored record, so the symbol is identical to
   * the original. No new record, no new identity, no counter movement.
   */
  const reprint = useCallback(
    async (record: RegistrationRecord) => {
      /*
       * A different rider is now in hand, so the print question starts again.
       * Recovering a label from three riders ago and being told the obvious
       * next action is "next rider" would be the screen answering a question
       * about somebody else.
       */
      setPhase({
        status: 'saved',
        record,
        sticker: { status: 'rendering' },
        printAttempted: false,
      })
      await renderStickerFor(record, false)
    },
    [renderStickerFor],
  )

  /**
   * Hands the current document to the browser's print dialog.
   *
   * Recording the attempt is the whole of the state change. Nothing is written,
   * nothing is synced, and the record is not touched: the only thing that moves
   * is which button the screen offers next.
   */
  const print = useCallback(() => {
    if (phase.status === 'saved' && phase.sticker.status === 'ready') {
      printDocument()
      setPhase((current) =>
        current.status === 'saved' && !current.printAttempted
          ? { ...current, printAttempted: true }
          : current,
      )
    }
  }, [phase])

  /**
   * Clears the desk for the next participant.
   *
   * Only touches screen state. The record stays in IndexedDB and in the recent
   * list, which is what makes a late "the sticker never came out" recoverable.
   */
  const nextParticipant = useCallback(() => {
    setPhase({ status: 'entry' })
  }, [])

  /** Corrects contact details on a saved record without touching its identity. */
  const correctContactDetails = useCallback(
    async (recordId: RecordId, values: RegistrationFormValues) => {
      const updated = await updateRegistration(db, recordId, values)

      if (mountedRef.current) {
        setPhase((current) =>
          current.status === 'saved' &&
          current.record.recordId === updated.recordId
            ? { ...current, record: updated }
            : current,
        )
      }
      await refreshRecent()
      return updated
    },
    [refreshRecent],
  )

  return {
    phase,
    recent,
    deviceReady,
    deviceError,
    submit,
    retrySticker,
    reprint,
    print,
    nextParticipant,
    correctContactDetails,
  }
}
