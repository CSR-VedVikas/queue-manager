export type TokenStatus = 'waiting' | 'serving' | 'served' | 'cancelled'

export interface Manager {
  id: number
  name: string
  email: string
}

export interface AuthResponse {
  access_token: string
  token_type: 'bearer'
  manager: Manager
}

export interface Token {
  id: number
  number: number
  label: string | null
  status: TokenStatus
  created_at: string
  serving_at: string | null
  served_at: string | null
  cancelled_at: string | null
}

export interface QueueSummary {
  id: number
  name: string
  created_at: string
  waiting_count: number
  serving: Token | null
  served_today: number
}

export interface QueueDetail {
  id: number
  name: string
  created_at: string
  serving: Token | null
  waiting: Token[]
  recent: Token[]
  server_time: string
}

export type Range = '24h' | '7d' | '30d'

export interface Analytics {
  range: Range
  timezone: string
  granularity: 'hour' | 'day'
  since: string
  generated_at: string
  summary: {
    arrived: number
    served: number
    cancelled: number
    cancellation_rate: number | null
    avg_wait_sec: number | null
    median_wait_sec: number | null
    p90_wait_sec: number | null
    avg_service_sec: number | null
    waiting_now: number
    longest_wait_now_sec: number | null
  }
  series: {
    bucket: string
    arrived: number
    served: number
    avg_wait_sec: number | null
    peak_queue_length: number
  }[]
  arrivals_by_hour: { hour: number; arrived: number }[]
  queues: {
    id: number
    name: string
    waiting_now: number
    served: number
    cancelled: number
    avg_wait_sec: number | null
  }[]
}

export interface Insights {
  headline: string
  points: string[]
  suggestion: string | null
  model: string | null
  generated_at: string
  cached: boolean
}

export interface Features {
  ai_summaries: boolean
}
