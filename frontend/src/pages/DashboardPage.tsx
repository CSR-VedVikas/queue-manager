import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ErrorNote, Loading, PageTitle, Panel } from '../components/ui'
import { api } from '../lib/api'
import { formatDuration } from '../lib/time'
import type { Analytics, Range } from '../lib/types'

const COLORS = { ink: '#17212e', slate: '#5a6676', line: '#d5dce4', signal: '#f2a900', soft: '#9aa6b5' }
const RANGES: { value: Range; label: string }[] = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
]

function bucketLabel(bucket: string, granularity: Analytics['granularity']) {
  // Buckets are local wall-clock times without an offset, e.g. "2026-11-13T17:00:00".
  const [date, time] = bucket.split('T')
  if (granularity === 'hour') return time.slice(0, 5)
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

const minutes = (sec: number | null) => (sec === null ? null : Math.round((sec / 60) * 10) / 10)

export function DashboardPage() {
  const [range, setRange] = useState<Range>('7d')
  const [queueId, setQueueId] = useState<number | null>(null)

  const queues = useQuery({ queryKey: ['queues'], queryFn: api.listQueues })
  const data = useQuery({
    queryKey: ['analytics', range, queueId],
    queryFn: () => api.analytics(range, queueId),
    refetchInterval: 60_000,
    placeholderData: (previous) => previous, // keep the old charts on screen while switching
  })

  return (
    <>
      <PageTitle
        aside={
          <div className="flex flex-wrap items-center gap-3">
            <label className="sr-only" htmlFor="queue-filter">Queue</label>
            <select id="queue-filter" value={queueId ?? ''}
              onChange={(e) => setQueueId(e.target.value ? Number(e.target.value) : null)}
              className="h-10 rounded-md border border-line bg-white px-3 text-[15px] font-semibold hover:border-slate focus:border-ink focus:outline-none">
              <option value="">All queues</option>
              {queues.data?.map((q) => (
                <option key={q.id} value={q.id}>{q.name}</option>
              ))}
            </select>
            <div role="group" aria-label="Time range" className="flex rounded-md border border-line bg-white p-0.5">
              {RANGES.map((r) => (
                <button key={r.value} type="button" aria-pressed={range === r.value} onClick={() => setRange(r.value)}
                  className={`rounded px-3 py-1.5 text-[15px] font-semibold transition-colors ${
                    range === r.value ? 'bg-ink text-white' : 'text-slate hover:text-ink'
                  }`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        }
      >
        Dashboard
      </PageTitle>

      {data.isPending && <Loading what="analytics" />}
      {data.isError && <ErrorNote message={data.error.message} onRetry={() => void data.refetch()} />}
      {data.data && <DashboardBody a={data.data} showQueues={queueId === null} />}
    </>
  )
}

function DashboardBody({ a, showQueues }: { a: Analytics; showQueues: boolean }) {
  const s = a.summary
  const series = a.series.map((b) => ({
    label: bucketLabel(b.bucket, a.granularity),
    wait: minutes(b.avg_wait_sec),
    peak: b.peak_queue_length,
    arrived: b.arrived,
    served: b.served,
  }))
  const busiest = Math.max(...a.arrivals_by_hour.map((h) => h.arrived))
  const per = a.granularity === 'hour' ? 'hour' : 'day'
  const empty = s.arrived === 0 && s.served === 0 && s.waiting_now === 0

  return (
    <div className="space-y-6">
      {empty && (
        <Panel className="px-5 py-4 text-slate">
          Nothing happened in this period yet. Charts will fill in as people join and are served.
        </Panel>
      )}

      {/* Wait-time figures lead: they are what the people in the line feel. */}
      <Panel className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Figure value={formatDuration(s.median_wait_sec)} label="Typical wait"
          note="Half of people waited less than this." />
        <Figure value={formatDuration(s.p90_wait_sec)} label="Long wait"
          note="9 in 10 people waited less than this." />
        <Figure value={formatDuration(s.avg_service_sec)} label="Time at the counter"
          note={`Average once called. Mean wait: ${formatDuration(s.avg_wait_sec)}.`} />
      </Panel>

      <div className="grid gap-6 sm:grid-cols-3">
        <SmallFigure value={s.served} label="Served" />
        <SmallFigure value={s.cancelled}
          label={s.cancellation_rate === null ? 'Cancelled' : `Cancelled (${Math.round(s.cancellation_rate * 100)}%)`} />
        <SmallFigure value={s.waiting_now}
          label={s.longest_wait_now_sec ? `Waiting now, longest ${formatDuration(s.longest_wait_now_sec)}` : 'Waiting now'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartPanel title="Average wait" subtitle={`Minutes from joining to being called, per ${per}`}>
          <LineChart data={series} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.line} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: COLORS.slate, fontSize: 12 }} tickLine={false} axisLine={{ stroke: COLORS.line }} minTickGap={16} />
            <YAxis tick={{ fill: COLORS.slate, fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip formatter={(v) => [`${v} min`, 'Average wait']} />
            <Line type="monotone" dataKey="wait" stroke={COLORS.ink} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ChartPanel>

        <ChartPanel title="Longest line" subtitle={`Most people waiting at the same time, per ${per}`}>
          <BarChart data={series} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.line} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: COLORS.slate, fontSize: 12 }} tickLine={false} axisLine={{ stroke: COLORS.line }} minTickGap={16} />
            <YAxis tick={{ fill: COLORS.slate, fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip formatter={(v) => [v, 'People in line']} cursor={{ fill: 'rgba(23,33,46,0.05)' }} />
            <Bar dataKey="peak" fill={COLORS.ink} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartPanel>

        <ChartPanel title="Arrivals and people served" subtitle={`Tokens issued and tokens served, per ${per}`}>
          <BarChart data={series} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.line} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: COLORS.slate, fontSize: 12 }} tickLine={false} axisLine={{ stroke: COLORS.line }} minTickGap={16} />
            <YAxis tick={{ fill: COLORS.slate, fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip cursor={{ fill: 'rgba(23,33,46,0.05)' }} />
            <Legend iconType="square" wrapperStyle={{ fontSize: 13, color: COLORS.slate }} />
            <Bar dataKey="arrived" name="Arrived" fill={COLORS.soft} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="served" name="Served" fill={COLORS.ink} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartPanel>

        <ChartPanel title="Busiest hours" subtitle="Arrivals by hour of day across the whole period">
          <BarChart data={a.arrivals_by_hour} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.line} vertical={false} />
            <XAxis dataKey="hour" tick={{ fill: COLORS.slate, fontSize: 12 }} tickLine={false} axisLine={{ stroke: COLORS.line }}
              tickFormatter={(h: number) => `${String(h).padStart(2, '0')}`} interval={2} />
            <YAxis tick={{ fill: COLORS.slate, fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip labelFormatter={(h) => `${String(h).padStart(2, '0')}:00–${String((Number(h) + 1) % 24).padStart(2, '0')}:00`}
              formatter={(v) => [v, 'Arrivals']} cursor={{ fill: 'rgba(23,33,46,0.05)' }} />
            <Bar dataKey="arrived" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {a.arrivals_by_hour.map((h) => (
                <Cell key={h.hour} fill={busiest > 0 && h.arrived === busiest ? COLORS.signal : COLORS.ink} />
              ))}
            </Bar>
          </BarChart>
        </ChartPanel>
      </div>

      {showQueues && a.queues.length > 0 && (
        <Panel className="overflow-x-auto">
          <h2 className="border-b border-line px-5 py-4 text-xl font-semibold">By queue</h2>
          <table className="w-full min-w-[520px] text-left text-[15px]">
            <thead className="text-sm text-slate">
              <tr>
                <th className="px-5 py-3 font-semibold">Queue</th>
                <th className="px-5 py-3 text-right font-semibold">Waiting now</th>
                <th className="px-5 py-3 text-right font-semibold">Served</th>
                <th className="px-5 py-3 text-right font-semibold">Cancelled</th>
                <th className="px-5 py-3 text-right font-semibold">Average wait</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {a.queues.map((q) => (
                <tr key={q.id}>
                  <td className="px-5 py-3 font-semibold">{q.name}</td>
                  <td className="px-5 py-3 text-right">{q.waiting_now}</td>
                  <td className="px-5 py-3 text-right">{q.served}</td>
                  <td className="px-5 py-3 text-right">{q.cancelled}</td>
                  <td className="px-5 py-3 text-right">{formatDuration(q.avg_wait_sec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <p className="text-sm text-slate">Times shown in {a.timezone}.</p>
    </div>
  )
}

function Figure({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="px-6 py-5">
      <p className="font-semibold">{label}</p>
      <p className="mt-1 font-display text-[44px] font-semibold leading-none tracking-tight">{value}</p>
      <p className="mt-2 text-sm text-slate">{note}</p>
    </div>
  )
}

function SmallFigure({ value, label }: { value: number; label: string }) {
  return (
    <Panel className="flex items-baseline gap-3 px-5 py-4">
      <span className="font-display text-3xl font-semibold leading-none">{value}</span>
      <span className="text-slate">{label}</span>
    </Panel>
  )
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <Panel className="p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-slate">{subtitle}</p>
      <div className="mt-4 h-60">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}
