import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useToast } from '../components/Toasts'
import { Button, ErrorNote, Icon, IconButton, LiveDot, Loading, Panel, Pill, TextField } from '../components/ui'
import { ApiError, api } from '../lib/api'
import { clockOffset, formatClock, formatDuration, tokenCode, useNow } from '../lib/time'
import type { QueueDetail, Token } from '../lib/types'

function who(t: Token) {
  return t.label ?? 'No name given'
}

export function QueuePage() {
  const { queueId } = useParams()
  const id = Number(queueId)
  const queryClient = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const now = useNow(15_000)

  const [label, setLabel] = useState('')
  const [cancelTarget, setCancelTarget] = useState<Token | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const queue = useQuery({
    queryKey: ['queue', id],
    queryFn: () => api.getQueue(id),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: 5_000, // keeps other tabs/devices in sync
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  })

  // One mutation for every queue action. Each returns the full updated
  // queue, which replaces the cached copy directly.
  const action = useMutation({
    mutationFn: (run: () => Promise<QueueDetail>) => run(),
    onMutate: async () => {
      // Cancel any poll already in flight. Otherwise a response that left
      // the server *before* this action could arrive *after* it and put the
      // old order back on screen.
      await queryClient.cancelQueries({ queryKey: ['queue', id] })
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(['queue', id], detail)
      void queryClient.invalidateQueries({ queryKey: ['queues'] })
    },
    onError: (err) => {
      toast(err.message, 'error')
      void queryClient.invalidateQueries({ queryKey: ['queue', id] }) // resync with the server
    },
  })

  const remove = useMutation({
    mutationFn: () => api.deleteQueue(id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['queue', id] })
      void queryClient.invalidateQueries({ queryKey: ['queues'] })
      toast(`Deleted "${queue.data?.name}"`)
      navigate('/queues')
    },
    onError: (err) => toast(err.message, 'error'),
  })

  const busy = action.isPending || remove.isPending
  const validId = Number.isInteger(id) && id > 0

  if (validId && queue.isPending) return <Loading what="the queue" />
  if (!validId || queue.isError) {
    if (!validId || (queue.error instanceof ApiError && queue.error.status === 404)) {
      return (
        <Panel className="px-6 py-16 text-center">
          <p className="text-xl font-semibold tracking-tight">This queue doesn't exist</p>
          <p className="mt-2 text-slate">It may have been deleted, or the link is wrong.</p>
          <Link to="/queues"
            className="mt-5 inline-block font-medium underline decoration-line decoration-2 underline-offset-4 hover:decoration-ink">
            Back to queues
          </Link>
        </Panel>
      )
    }
    return <ErrorNote message={queue.error?.message ?? 'Something went wrong'} onRetry={() => void queue.refetch()} />
  }
  if (!queue.data) return <Loading what="the queue" />

  const q = queue.data
  // Measure elapsed time on the server's clock (see lib/time.ts).
  const serverNow = now + clockOffset(q.server_time, queue.dataUpdatedAt)
  const waitedSec = (iso: string) => (serverNow - new Date(iso).getTime()) / 1000
  const next = q.waiting[0]

  function addPerson(e: FormEvent) {
    e.preventDefault()
    const text = label.trim()
    action.mutate(() => api.addToken(id, text), {
      onSuccess: (d) => {
        setLabel('')
        const added = d.waiting[d.waiting.length - 1]
        toast(`Token ${tokenCode(added.number)} added${added.label ? ` for ${added.label}` : ''}`)
      },
    })
  }

  // Rendered under the board on phones (so adding someone never means
  // scrolling past the whole line) and in the side column on wide screens.
  const addPanel = (where: 'mobile' | 'desktop') => (
    <Panel className="p-5">
      <h2 className="text-lg font-semibold tracking-tight">Add a person</h2>
      <p className="mt-0.5 text-sm text-slate">They get the next token and join the back of the line.</p>
      <form onSubmit={addPerson} className="mt-4">
        <TextField id={`token-label-${where}`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80}
          placeholder="Who is this token for?"
          label={<>Name <span className="font-normal text-slate">(optional)</span></>} />
        <Button type="submit" size="lg" className="mt-3 w-full" disabled={busy}>
          Issue token
        </Button>
      </form>
    </Panel>
  )

  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link to="/queues"
            className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 text-sm font-medium text-slate transition-colors hover:text-ink">
            {Icon.back}
            All queues
          </Link>
          <h1 className="mt-1.5 text-[30px] font-semibold leading-tight tracking-tight sm:text-[34px]">{q.name}</h1>
        </div>
        <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy}>
          Delete queue
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {/* ---- the counter display */}
          <section aria-label="Now serving" className="board on-board rounded-2xl p-6 text-white shadow-pop sm:p-8">
            <p className="flex items-center gap-2.5 text-sm font-medium uppercase tracking-[0.14em] text-white/60">
              {q.serving ? <LiveDot /> : <span className="size-2 rounded-full bg-white/25" aria-hidden="true" />}
              Now serving
            </p>
            {q.serving ? (
              <div className="mt-3 flex flex-wrap items-end gap-x-7 gap-y-3">
                <span className="font-mono text-[clamp(76px,13vw,128px)] font-semibold leading-[0.85] tracking-tighter text-signal">
                  {tokenCode(q.serving.number)}
                </span>
                <span className="pb-1.5">
                  <span className="block text-2xl font-semibold tracking-tight">{who(q.serving)}</span>
                  <span className="text-white/60">
                    Called {formatDuration(waitedSec(q.serving.serving_at!))} ago · waited{' '}
                    {formatDuration((new Date(q.serving.serving_at!).getTime() - new Date(q.serving.created_at).getTime()) / 1000)}
                  </span>
                </span>
              </div>
            ) : (
              <p className="mt-3 text-4xl font-semibold leading-tight tracking-tight text-white/35 sm:text-5xl">Counter is free</p>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button variant="signal" size="xl" disabled={busy || (!next && !q.serving)}
                onClick={() => action.mutate(() => api.serveNext(id))}>
                {next ? `Call next: ${tokenCode(next.number)}` : q.serving ? 'Finish (no one waiting)' : 'No one waiting'}
              </Button>
              {q.serving && (
                <>
                  <Button variant="board" size="xl" disabled={busy} onClick={() => action.mutate(() => api.complete(id))}>
                    Mark as done
                  </Button>
                  <button type="button" disabled={busy} onClick={() => setCancelTarget(q.serving)}
                    className="rounded-lg px-3 py-2 text-[15px] font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white disabled:text-white/30 disabled:hover:bg-transparent">
                    Didn't show up
                  </button>
                </>
              )}
            </div>
          </section>

          <div className="lg:hidden">{addPanel('mobile')}</div>

          {/* ---- the line */}
          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="text-lg font-semibold tracking-tight">Waiting</h2>
              <Pill>
                {q.waiting.length} {q.waiting.length === 1 ? 'person' : 'people'}
              </Pill>
            </div>
            {q.waiting.length === 0 ? (
              <p className="px-5 py-14 text-center text-slate">
                No one is waiting. Add people with the form to issue them a token.
              </p>
            ) : (
              <ol className="divide-y divide-line">
                {q.waiting.map((t, i) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-ground/70 sm:gap-4 sm:px-5">
                    <span className="w-5 shrink-0 text-right text-sm text-faint sm:w-6" aria-label={`Position ${i + 1}`}>{i + 1}</span>
                    <span className={`min-w-[58px] shrink-0 rounded-lg border px-2 py-1.5 text-center font-mono text-xl font-semibold leading-none tracking-tight sm:min-w-[66px] sm:text-[22px] ${
                      i === 0 ? 'border-signal/40 bg-signal-soft text-signal-ink' : 'border-line bg-ground'
                    }`}>
                      {tokenCode(t.number)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={`block truncate font-medium ${t.label ? '' : 'text-slate'}`}>{who(t)}</span>
                        {i === 0 && <Pill tone="signal">Next</Pill>}
                      </span>
                      <span className="block whitespace-nowrap text-sm text-slate">
                        Waiting {formatDuration(waitedSec(t.created_at))}
                        <span className="hidden sm:inline"> · joined {formatClock(t.created_at)}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <IconButton label={`Move ${tokenCode(t.number)} up`} disabled={busy || i === 0}
                        onClick={() => action.mutate(() => api.moveToken(id, t.id, 'up'))}>
                        {Icon.up}
                      </IconButton>
                      <IconButton label={`Move ${tokenCode(t.number)} down`} disabled={busy || i === q.waiting.length - 1}
                        onClick={() => action.mutate(() => api.moveToken(id, t.id, 'down'))}>
                        {Icon.down}
                      </IconButton>
                      <IconButton label={`Cancel ${tokenCode(t.number)}`} tone="danger" disabled={busy}
                        onClick={() => setCancelTarget(t)}>
                        {Icon.cross}
                      </IconButton>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <div className="hidden lg:block">{addPanel('desktop')}</div>

          <Panel className="overflow-hidden">
            <h2 className="border-b border-line px-5 py-4 text-lg font-semibold tracking-tight">Recently finished</h2>
            {q.recent.length === 0 ? (
              <p className="px-5 py-8 text-slate">Served and cancelled tokens will appear here.</p>
            ) : (
              <ul className="divide-y divide-line">
                {q.recent.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="min-w-11 font-mono text-[15px] font-medium text-slate">{tokenCode(t.number)}</span>
                    <span className="min-w-0 flex-1 truncate text-[15px]">{who(t)}</span>
                    <span className="flex shrink-0 items-center gap-2 text-sm text-slate">
                      <Pill tone={t.status === 'served' ? 'ok' : 'neutral'}>{t.status === 'served' ? 'Served' : 'Cancelled'}</Pill>
                      {formatClock((t.served_at ?? t.cancelled_at)!)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={cancelTarget !== null}
        title={cancelTarget ? `Cancel token ${tokenCode(cancelTarget.number)}?` : ''}
        body={
          cancelTarget?.status === 'serving'
            ? `${who(cancelTarget)} will be recorded as a no-show and removed from the counter.`
            : `${cancelTarget ? who(cancelTarget) : ''} will be removed from the queue. This can't be undone.`
        }
        confirmLabel="Cancel token"
        busy={action.isPending}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => {
          const t = cancelTarget
          if (!t) return
          action.mutate(() => api.cancelToken(id, t.id), {
            onSettled: () => setCancelTarget(null),
            onSuccess: () => toast(`Token ${tokenCode(t.number)} cancelled`),
          })
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${q.name}"?`}
        body="The queue, everyone waiting in it and its history will be deleted. This can't be undone."
        confirmLabel="Delete queue"
        busy={remove.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}
