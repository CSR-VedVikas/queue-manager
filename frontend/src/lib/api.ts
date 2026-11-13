import { markSlow } from './serverStatus'
import type { Analytics, AuthResponse, Manager, QueueDetail, QueueSummary, Range } from './types'

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')
const TOKEN_KEY = 'qm.token'
const SLOW_AFTER_MS = 2500
const TIMEOUT_MS = 90_000 // long enough for a free-tier server to wake up

export const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

// ---------- session token. localStorage can throw (private mode, blocked
// storage), so every access is guarded and the app still works for the tab.

let memoryToken: string | null = null

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}

export function setToken(token: string | null) {
  memoryToken = token
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable: keep the in-memory copy */
  }
}

// ---------- errors

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type UnauthorisedHandler = () => void
let onUnauthorised: UnauthorisedHandler = () => {}
export function setUnauthorisedHandler(fn: UnauthorisedHandler) {
  onUnauthorised = fn
}

function messageFrom(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  // FastAPI validation errors: [{ loc, msg }, ...]
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: string }
    if (first?.msg) return first.msg.replace(/^Value error, /, '')
  }
  if (status >= 500) return 'The server ran into a problem. Try again in a moment.'
  return `Request failed (${status})`
}

// ---------- one function every request goes through

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body) headers.set('Content-Type', 'application/json')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let flaggedSlow = false
  const slowTimer = setTimeout(() => {
    flaggedSlow = true
    markSlow(1)
  }, SLOW_AFTER_MS)

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers, signal: controller.signal })
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.")
  } finally {
    clearTimeout(timeout)
    clearTimeout(slowTimer)
    if (flaggedSlow) markSlow(-1)
  }

  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorised()
    throw new ApiError(res.status, messageFrom(body, res.status))
  }
  return body as T
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

// ---------- endpoints

export const api = {
  health: () => request<{ status: string }>('/api/health'),

  signup: (name: string, email: string, password: string) =>
    post<AuthResponse>('/api/auth/signup', { name, email, password }),
  login: (email: string, password: string) => post<AuthResponse>('/api/auth/login', { email, password }),
  me: () => request<Manager>('/api/auth/me'),

  listQueues: () => request<QueueSummary[]>(`/api/queues?tz=${encodeURIComponent(timezone)}`),
  createQueue: (name: string) => post<QueueDetail>('/api/queues', { name }),
  getQueue: (id: number) => request<QueueDetail>(`/api/queues/${id}`),
  deleteQueue: (id: number) => request<void>(`/api/queues/${id}`, { method: 'DELETE' }),

  addToken: (queueId: number, label: string) =>
    post<QueueDetail>(`/api/queues/${queueId}/tokens`, { label: label || null }),
  moveToken: (queueId: number, tokenId: number, direction: 'up' | 'down') =>
    post<QueueDetail>(`/api/queues/${queueId}/tokens/${tokenId}/move`, { direction }),
  cancelToken: (queueId: number, tokenId: number) =>
    post<QueueDetail>(`/api/queues/${queueId}/tokens/${tokenId}/cancel`),
  serveNext: (queueId: number) => post<QueueDetail>(`/api/queues/${queueId}/serve-next`),
  complete: (queueId: number) => post<QueueDetail>(`/api/queues/${queueId}/complete`),

  analytics: (range: Range, queueId: number | null) => {
    const params = new URLSearchParams({ range, tz: timezone })
    if (queueId !== null) params.set('queue_id', String(queueId))
    return request<Analytics>(`/api/analytics?${params}`)
  },
}
