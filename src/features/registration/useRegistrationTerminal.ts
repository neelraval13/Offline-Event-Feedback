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

  /** Renders the sticker for an already-saved record. Never creates anything. */
  const renderStickerFor = useCallback(async (record: RegistrationRecord) => {
    try {
      const payload = serializeQrPayload(qrPayloadForRegistration(record))
      const qrSvg = await renderQrSvg(payload)

      if (mountedRef.current) {
        setPhase({ status: 'saved', record, sticker: { status: 'ready', qrSvg } })
      }
    } catch (error) {
      // The registration is already safe. This is a rendering problem, and the
      // operator must not be told to register the participant again.
      if (mountedRef.current) {
        setPhase({
          status: 'saved',
          record,
          sticker: { status: 'failed', message: describe(error) },
        })
      }
    }
  }, [])

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
        setPhase({ status: 'saved', record: saved, sticker: { status: 'rendering' } })
      }
      await renderStickerFor(saved)
      await refreshRecent()
    },
    [refreshRecent, renderStickerFor],
  )

  /** Retries QR rendering for the saved record after a rendering failure. */
  const retrySticker = useCallback(async () => {
    if (phase.status !== 'saved') {
      return
    }
    const { record } = phase
    setPhase({ status: 'saved', record, sticker: { status: 'rendering' } })
    await renderStickerFor(record)
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
      setPhase({ status: 'saved', record, sticker: { status: 'rendering' } })
      await renderStickerFor(record)
    },
    [renderStickerFor],
  )

  /** Hands the current document to the browser's print dialog. */
  const print = useCallback(() => {
    if (phase.status === 'saved' && phase.sticker.status === 'ready') {
      printDocument()
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
