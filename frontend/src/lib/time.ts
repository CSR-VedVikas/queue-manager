import { useEffect, useState } from 'react'

/** "4 min", "1 h 12 min", "35 s". Used for every duration in the app. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—'
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  const minutes = Math.round(s / 60)
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function tokenCode(n: number): string {
  return String(n).padStart(3, '0')
}

/** Current time, refreshed on an interval so "waited 5 min" keeps counting. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/**
 * Milliseconds to add to the browser clock to get the server clock.
 * Every queue response carries server_time; using the server's clock keeps
 * "waited 5 min" right even if this computer's clock is wrong.
 */
export function clockOffset(serverTimeIso: string, receivedAt: number): number {
  return new Date(serverTimeIso).getTime() - receivedAt
}
