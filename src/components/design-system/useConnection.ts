import { useEffect, useState } from 'react'

/*
 * Whether the browser currently believes it has a network.
 *
 * A read-only observer. It subscribes to two events and nothing else: no
 * polling, no probe request, no reachability check against the sync endpoint.
 * That restraint is the point. This product's defining property is that it
 * works without a network, and a design-system component that quietly started
 * making requests to decide how to colour a badge would be exactly the kind of
 * change that breaks an offline device at a venue.
 *
 * `navigator.onLine` is famously weak: it reports whether an interface exists,
 * not whether anything is reachable through it, so it says `true` on a tablet
 * connected to a venue's captive-portal wifi that goes nowhere. That is
 * acceptable here because nothing depends on it. It drives an indicator, and
 * the sync panel reports what actually happened on the last real attempt,
 * which is the authoritative answer.
 */

/** Reads the current value, tolerating an environment without `navigator`. */
function readOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

export function useConnection(): boolean {
  const [online, setOnline] = useState(readOnline)

  useEffect(() => {
    const update = () => {
      setOnline(readOnline())
    }

    window.addEventListener('online', update)
    window.addEventListener('offline', update)

    /*
     * Re-read on mount. The events fire on transitions, so a component that
     * mounted while already offline would otherwise keep the value from the
     * render that happened before the transition.
     */
    update()

    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return online
}
