import type { OfflineReadiness } from '@/lib/pwa/offlineShell'
import { useOfflineShellState } from '@/lib/pwa/useOfflineShell'
import { StatusPill } from './StatusPill'
import type { StatusKey } from './status'
import { useConnection } from './useConnection'

/*
 * The shell's operational indicator.
 *
 * ## Why this is not an ONLINE/OFFLINE badge any more
 *
 * It was, and the wording was backwards. `navigator.onLine` answers "is there
 * an interface up right now", which is the least useful fact this product has
 * about itself, and it answers it in the least reassuring way: at the exact
 * moment a venue's wifi drops, the one indicator in the shell flipped to
 * OFFLINE and stayed there, which reads as a fault in a product whose entire
 * selling point is that this is fine.
 *
 * The fact an operator actually needs is whether the device is *prepared* to
 * lose the network, and the application already knows it. `Offline ready` is
 * true whether or not there is a network, so it keeps meaning something at the
 * moment connectivity disappears, which is the moment it is read.
 *
 * ## What this is allowed to touch
 *
 * Nothing. `useOfflineShellState` is a `useSyncExternalStore` subscription to
 * state the offline shell has already computed; it registers nothing, requests
 * nothing, and returns `unsupported` when no shell has been installed. There is
 * no probe, no reachability check and no timer here, and there must never be
 * one: a design-system component that started making requests to decide how to
 * colour a badge is precisely the change that breaks a device at a venue.
 *
 * `useConnection` is likewise two event listeners and no traffic.
 *
 * ## Why the two are combined rather than shown side by side
 *
 * Two badges in a phone header is the chrome this phase is removing. One badge
 * that answers the more important question, with the other fact in its tooltip,
 * costs nothing and says more.
 */

export interface OperationalStatusView {
  readonly status: StatusKey
  /** Short enough for a phone header. Overrides the canonical label. */
  readonly label: string
  /** Both facts, for a pointer. Never the only place either one appears. */
  readonly title: string
}

const NETWORK_NOTE: Readonly<Record<'true' | 'false', string>> = {
  true: 'Network connected.',
  false: 'No network.',
}

/**
 * Resolves what the shell shows, from readiness and connectivity.
 *
 * Pure, and exported so the table below is testable rather than something that
 * has to be reasoned about from a screenshot.
 */
export function resolveOperationalStatus(
  readiness: OfflineReadiness,
  online: boolean,
): OperationalStatusView {
  const network = NETWORK_NOTE[online ? 'true' : 'false']

  switch (readiness) {
    /*
     * The reassuring case, and the important one. Shown identically whether or
     * not there is a network, because that is the claim: this device does not
     * need one.
     */
    case 'ready':
      return {
        status: 'offline-ready',
        label: 'Offline ready',
        title: `This device holds everything it needs to work without a network. ${network}`,
      }

    case 'preparing':
      /*
       * Preparing cannot finish without a network, so claiming to be preparing
       * while offline would be a promise the device cannot keep. Offline is the
       * honest answer, and it is the one that tells the operator what to do:
       * find a connection before leaving.
       */
      return online
        ? {
            status: 'offline-preparing',
            label: 'Preparing',
            title: `Caching this device for offline use. ${network}`,
          }
        : {
            status: 'offline',
            label: 'Offline',
            title:
              'Not yet ready for offline use, and no network to finish preparing. Connect this device before the event.',
          }

    case 'failed':
      return {
        status: 'offline-failed',
        label: 'Not offline ready',
        title: `This device is not prepared to work without a network. ${network}`,
      }

    /*
     * No service worker: a dev build, or a browser without support. There is no
     * readiness to report, so the indicator falls back to the plain fact it can
     * still substantiate rather than inventing a reassurance.
     */
    case 'unsupported':
      return online
        ? { status: 'online', label: 'Online', title: 'Network connected.' }
        : {
            status: 'offline',
            label: 'Offline',
            title: 'No network. Records are held on this device.',
          }
  }
}

export function OperationalStatus({
  className,
}: {
  readonly className?: string
}) {
  const online = useConnection()
  const { readiness } = useOfflineShellState()
  const view = resolveOperationalStatus(readiness, online)

  return (
    <StatusPill
      status={view.status}
      label={view.label}
      title={view.title}
      {...(className === undefined ? {} : { className })}
    />
  )
}
