import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { formatClock } from '../lib/time'
import type { Range } from '../lib/types'
import { Button, Panel } from './ui'

const MODEL_NAMES: Record<string, string> = {
  'claude-fable-5-2': 'Claude Fable 5.2',
}

const PERIOD: Record<Range, string> = { '24h': 'the last 24 hours', '7d': 'the last 7 days', '30d': 'the last 30 days' }

// A short written read of the dashboard, from the server's AI endpoint.
// Nothing is requested until the manager asks: each answer is a paid model
// call. One answer per view is kept, so switching back shows it again.
export function InsightsPanel({ range, queueId, queueName }: { range: Range; queueId: number | null; queueName?: string }) {
  const insights = useQuery({
    queryKey: ['insights', range, queueId],
    queryFn: () => api.insights(range, queueId),
    enabled: false,
    retry: false,
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
  })
  const data = insights.data
  const busy = insights.isFetching
  const scope = queueName ?? 'all queues'

  return (
    <Panel className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            Summary
            <span className="rounded bg-signal px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-board">AI</span>
          </h2>
          {!data && !busy && !insights.isError && (
            <p className="text-[15px] text-slate">
              A short written read of {PERIOD[range]} for {scope}, with one thing to try next.
            </p>
          )}
        </div>
        <Button variant={data ? 'secondary' : 'primary'} disabled={busy}
          onClick={() => void insights.refetch()} aria-describedby="insights-status">
          {busy ? 'Summarizing…' : data ? 'Summarize again' : 'Summarize'}
        </Button>
      </div>

      <div id="insights-status" aria-live="polite">
        {busy && (
          <p className="mt-3 text-[15px] text-slate" role="status">
            Reading the numbers for {PERIOD[range]}. This can take up to a minute.
          </p>
        )}

        {!busy && insights.isError && (
          <p className="mt-3 font-semibold text-danger" role="alert">{insights.error.message}</p>
        )}

        {!busy && data && (
          <div className="mt-3 space-y-3">
            <p className="text-lg font-semibold leading-snug">{data.headline}</p>
            {data.points.length > 0 && (
              <ul className="space-y-1.5">
                {data.points.map((point, i) => (
                  <li key={i} className="flex gap-2.5 text-[15px]">
                    <span aria-hidden="true" className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-signal" />
                    <span className="min-w-0">{point}</span>
                  </li>
                ))}
              </ul>
            )}
            {data.suggestion && (
              <div className="rounded-md bg-ground px-4 py-3 text-[15px]">
                <span className="font-semibold">Try next: </span>
                {data.suggestion}
              </div>
            )}
            <p className="text-sm text-slate">
              {data.model
                ? `Written by ${MODEL_NAMES[data.model] ?? data.model} from the numbers on this page at ${formatClock(data.generated_at)}. Check it against the charts before acting on it.`
                : 'No AI was needed for this one.'}
            </p>
          </div>
        )}
      </div>
    </Panel>
  )
}
