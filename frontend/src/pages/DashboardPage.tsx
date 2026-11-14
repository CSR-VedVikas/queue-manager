import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ErrorNote, Loading, PageTitle, Panel } from '../components/ui'
import { api } from '../lib/api'
import { formatDuration } from '../lib/time'
import type { Analytics, Range } from '../lib/types'

const COLORS = { ink: '#0c1322', slate: '#5c667a', line: '#e4e7ed', signal: '#f5a623', soft: '#c3cad6' }
const RANGES: { value: Range; label: string; short: string }[] = [
  { value: '24h', label: 'Last 24 hours', short: '24 h' },
  { value: '7d', label: 'Last 7 days', short: '7 d' },
  { value: '30d', label: 'Last 30 days', short: '30 d' },
]

// Shared chart styling, so the four charts read as one set.
const AXIS_TICK = { fill: COLORS.slate, fontSize: 12 }
const HOVER_BAND = { fill: 'rgba(12,19,34,0.04)' }
const TOOLTIP = {
  contentStyle: {
    borderRadius: 10,
    border: `1px solid ${COLORS.line}`,
    boxShadow: '0 14px 34px -10px rgba(12,19,34,0.2)',
    padding: '8px 12px',
    fontSize: 13,
  },
  labelStyle: { fontWeight: 600, color: COLORS.ink, marginBottom: 2 },
  itemStyle: { color: COLORS.slate, padding: 0 },
}

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
        subtitle="How long people wait, and when the line is longest."
        aside={
          <div className="flex flex-wrap items-center gap-3">
            <label className="sr-only" htmlFor="queue-filter">Queue</label>
            <select id="queue-filter" value={queueId ?? ''}
              onChange={(e) => setQueueId(e.target.value ? Number(e.target.value) : null)}
              className="h-10 rounded-lg border border-line bg-white px-3 text-[15px] font-medium shadow-card transition-[border-color,box-shadow] duration-150 hover:border-ink/25 focus:border-ink focus:shadow-focus focus:outline-none">
              <option value="">All queues</option>
              {queues.data?.map((q) => (
                <option key={q.id} value={q.id}>{q.name}</option>
              ))}
            </select>
            <div role="group" aria-label="Time range" className="flex h-10 items-center rounded-lg border border-line bg-ink/[0.04] p-1">
              {RANGES.map((r) => (
                <button key={r.value} type="button" aria-pressed={range === r.value} aria-label={r.label}
                  onClick={() => setRange(r.value)}
                  className={`h-full rounded-md px-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-150 ${
                    range === r.value ? 'bg-white text-ink shadow-card' : 'text-slate hover:text-ink'
                  }`}>
                  <span className="sm:hidden">{r.short}</span>
                  <span className="hidden sm:inline">{r.label}</span>
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
        <div className="rounded-xl border border-dashed border-ink/15 bg-white/60 px-5 py-4 text-slate">
          Nothing happened in this period yet. Charts will fill in as people join and are served.
        </div>
      )}

      {/* Wait-time figures lead: they are what the people in the line feel. */}
      <Panel className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Figure value={formatDuration(s.median_wait_sec)} label="Typical wait" dot="bg-ink"
          note="Half of people waited less than this." />
        <Figure value={formatDuration(s.p90_wait_sec)} label="Long wait" dot="bg-signal"
          note="9 in 10 people waited less than this." />
        <Figure value={formatDuration(s.avg_service_sec)} label="Time at the counter" dot="bg-faint"
          note={`Average once called. Mean wait: ${formatDuration(s.avg_wait_sec)}.`} />
      </Panel>

      <div className="grid gap-4 sm:grid-cols-3 sm:gap-6">
        <SmallFigure value={s.served} label="Served" />
        <SmallFigure value={s.cancelled}
          label={s.cancellation_rate === null ? 'Cancelled' : `Cancelled (${Math.round(s.cancellation_rate * 100)}%)`} />
        <SmallFigure value={s.waiting_now}
          label={s.longest_wait_now_sec ? `Waiting now, longest ${formatDuration(s.longest_wait_now_sec)}` : 'Waiting now'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartPanel title="Average wait" subtitle={`Minutes from joining to being called, per ${per}`}>
          <AreaChart data={series} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="wait-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.ink} stopOpacity={0.16} />
                <stop offset="100%" stopColor={COLORS.ink} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={COLORS.line} strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: COLORS.line }} minTickGap={16} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...TOOLTIP} formatter={(v) => [`${v} min`, 'Average wait']} cursor={{ stroke: COLORS.soft }} />
            <Area type="monotone" dataKey="wait" stroke={COLORS.ink} strokeWidth={2.25} fill="url(#wait-fill)" dot={false}
              activeDot={{ r: 4.5, fill: COLORS.signal, stroke: '#fff', strokeWidth: 2 }} connectNulls isAnimationActive={false} />
          </AreaChart>
        </ChartPanel>

        <ChartPanel title="Longest line" subtitle={`Most people waiting at the same time, per ${per}`}>
          <BarChart data={series} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.line} strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: COLORS.line }} minTickGap={16} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...TOOLTIP} formatter={(v) => [v, 'People in line']} cursor={HOVER_BAND} />
            <Bar dataKey="peak" fill={COLORS.ink} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          </BarChart>
        </ChartPanel>

        <ChartPanel title="Arrivals and people served" subtitle={`Tokens issued and tokens served, per ${per}`}>
          <BarChart data={series} margin={{ top: 8, right: 12, left: -12, bottom: 0 }} barGap={2}>
            <CartesianGrid stroke={COLORS.line} strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: COLORS.line }} minTickGap={16} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...TOOLTIP} cursor={HOVER_BAND} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 13, color: COLORS.slate }} />
            <Bar dataKey="arrived" name="Arrived" fill={COLORS.soft} radius={[4, 4, 0, 0]} maxBarSize={20} isAnimationActive={false} />
            <Bar dataKey="served" name="Served" fill={COLORS.ink} radius={[4, 4, 0, 0]} maxBarSize={20} isAnimationActive={false} />
          </BarChart>
        </ChartPanel>

        <ChartPanel title="Busiest hours" subtitle="Arrivals by hour of day across the whole period">
          <BarChart data={a.arrivals_by_hour} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.line} strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="hour" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: COLORS.line }}
              tickFormatter={(h: number) => `${String(h).padStart(2, '0')}`} interval={2} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...TOOLTIP}
              labelFormatter={(h) => `${String(h).padStart(2, '0')}:00–${String((Number(h) + 1) % 24).padStart(2, '0')}:00`}
              formatter={(v) => [v, 'Arrivals']} cursor={HOVER_BAND} />
            <Bar dataKey="arrived" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {a.arrivals_by_hour.map((h) => (
                <Cell key={h.hour} fill={busiest > 0 && h.arrived === busiest ? COLORS.signal : COLORS.ink} />
              ))}
            </Bar>
          </BarChart>
        </ChartPanel>
      </div>

      {showQueues && a.queues.length > 0 && (
        <Panel className="overflow-x-auto">
          <h2 className="border-b border-line px-5 py-4 text-lg font-semibold tracking-tight">By queue</h2>
          <table className="w-full min-w-[520px] text-left text-[15px]">
            <thead className="bg-ground/70 text-xs uppercase tracking-wider text-slate">
              <tr>
                <th className="px-5 py-2.5 font-medium">Queue</th>
                <th className="px-5 py-2.5 text-right font-medium">Waiting now</th>
                <th className="px-5 py-2.5 text-right font-medium">Served</th>
                <th className="px-5 py-2.5 text-right font-medium">Cancelled</th>
                <th className="px-5 py-2.5 text-right font-medium">Average wait</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {a.queues.map((q) => (
                <tr key={q.id} className="transition-colors duration-150 hover:bg-ground/60">
                  <td className="px-5 py-3 font-medium">{q.name}</td>
                  <td className="px-5 py-3 text-right font-mono text-sm">{q.waiting_now}</td>
                  <td className="px-5 py-3 text-right font-mono text-sm">{q.served}</td>
                  <td className="px-5 py-3 text-right font-mono text-sm">{q.cancelled}</td>
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

function Figure({ value, label, note, dot }: { value: string; label: string; note: string; dot: string }) {
  return (
    <div className="px-6 py-6">
      <p className="flex items-center gap-2 text-sm font-medium text-slate">
        <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
        {label}
      </p>
      <p className="mt-3 text-[42px] font-semibold leading-none tracking-tight">{value}</p>
      <p className="mt-3 text-sm text-slate">{note}</p>
    </div>
  )
}

// The number comes first in the markup and the label second; flex-col-reverse
// shows the label on top.
function SmallFigure({ value, label }: { value: number; label: string }) {
  return (
    <Panel className="flex flex-col-reverse gap-2 px-5 py-4">
      <span className="font-mono text-[28px] font-semibold leading-none tracking-tight">{value}</span>
      <span className="text-sm text-slate">{label}</span>
    </Panel>
  )
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <Panel className="p-5">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-slate">{subtitle}</p>
      <div className="mt-5 h-60">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}
