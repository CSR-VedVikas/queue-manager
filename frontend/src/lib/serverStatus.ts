// Tracks whether the API is slow to answer, which on the free hosting tier
// usually means the server was asleep and is starting up. Components read
// this through useServerWaking(); api.ts writes to it.
import { useSyncExternalStore } from 'react'

let slowRequests = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export function markSlow(delta: 1 | -1) {
  slowRequests = Math.max(0, slowRequests + delta)
  emit()
}

export function useServerWaking(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => slowRequests > 0,
  )
}
