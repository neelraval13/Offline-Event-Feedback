import { useSyncExternalStore } from 'react'
import { matchRoute, type RoutePath } from './hashRoute'

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('hashchange', onStoreChange)
  return () => window.removeEventListener('hashchange', onStoreChange)
}

function getHashSnapshot(): string {
  return window.location.hash
}

/** The currently active route, or `null` when the hash matches no route. */
export function useHashRoute(): RoutePath | null {
  const hash = useSyncExternalStore(subscribe, getHashSnapshot, () => '')
  return matchRoute(hash)
}
