import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useToast } from '../components/Toasts'
import { Button, ErrorNote, Icon, IconButton, Loading, Panel } from '../components/ui'
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
        <Panel className="px-6 py-14 text-center">
          <p className="text-xl font-semibold">This queue doesn't exist</p>
          <p className="mt-2 text-slate">It may have been deleted, or the link is wrong.</p>
          <Link to="/queues" className="mt-5 inline-block font-semibold underline underline-offset-4">Back to queues</Link>
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
      <h2 className="text-xl font-semibold">Add a person</h2>
      <form onSubmit={addPerson} className="mt-4">
        <label htmlFor={`token-label-${where}`} className="mb-1.5 block text-sm font-semibold">
          Name <span className="font-normal text-slate">(optional)</span>
        </label>
        <input id={`token-label-${where}`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80}
          placeholder="Who is this token for?"
          className="h-11 w-full rounded-md border border-line bg-white px-3 text-[15px] placeholder:text-slate/70 hover:border-slate focus:border-ink focus:outline-none" />
        <Button type="submit" className="mt-3 w-full" disabled={busy}>
          Issue token
        </Button>
      </form>
    </Panel>
  )

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/queues" className="text-[15px] font-semibold text-slate hover:text-ink">← All queues</Link>
          <h1 className="mt-1 font-display text-[40px] font-semibold leading-none tracking-tight">{q.name}</h1>
        </div>
        <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy}>
          Delete queue
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {/* ---- the counter display */}
          <section aria-label="Now serving" className="on-board rounded-lg bg-board p-5 text-white sm:p-8">
            <p className="text-lg text-white/60">Now serving</p>
            {q.serving ? (
              <div className="mt-1 flex flex-wrap items-end gap-x-6 gap-y-2">
                <span className="font-display text-[clamp(84px,14vw,136px)] font-semibold leading-[0.85] tracking-tight text-signal">
                  {tokenCode(q.serving.number)}
                </span>
                <span className="pb-2">
                  <span className="block text-2xl font-semibold">{who(q.serving)}</span>
                  <span className="text-white/60">
                    Called {formatDuration(waitedSec(q.serving.serving_at!))} ago · waited{' '}
                    {formatDuration((new Date(q.serving.serving_at!).getTime() - new Date(q.serving.created_at).getTime()) / 1000)}
                  </span>
                </span>
              </div>
            ) : (
              <p className="mt-2 font-display text-5xl font-semibold leading-tight text-white/35">Counter is free</p>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button variant="signal" className="h-12 px-6 text-base" disabled={busy || (!next && !q.serving)}
                onClick={() => action.mutate(() => api.serveNext(id))}>
                {next ? `Call next: ${tokenCode(next.number)}` : q.serving ? 'Finish (no one waiting)' : 'No one waiting'}
              </Button>
              {q.serving && (
                <>
                  <Button className="h-12 border border-board-line bg-transparent text-white hover:bg-white/10"
                    disabled={busy} onClick={() => action.mutate(() => api.complete(id))}>
                    Mark as done
                  </Button>
                  <button type="button" disabled={busy} onClick={() => setCancelTarget(q.serving)}
                    className="px-2 text-[15px] font-semibold text-white/60 hover:text-white disabled:text-white/30">
                    Didn't show up
                  </button>
                </>
              )}
            </div>
          </section>

          <div className="lg:hidden">{addPanel('mobile')}</div>

          {/* ---- the line */}
          <Panel>
            <div className="flex items-baseline justify-between border-b border-line px-5 py-4">
              <h2 className="text-xl font-semibold">Waiting</h2>
              <span className="text-slate">
                {q.waiting.length} {q.waiting.length === 1 ? 'person' : 'people'}
              </span>
            </div>
            {q.waiting.length === 0 ? (
              <p className="px-5 py-12 text-center text-slate">
                No one is waiting. Add people with the form to issue them a token.
              </p>
            ) : (
              <ol className="divide-y divide-line">
                {q.waiting.map((t, i) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5">
                    <span className="w-5 shrink-0 text-right text-slate sm:w-6" aria-label={`Position ${i + 1}`}>{i + 1}</span>
                    <span className="min-w-[56px] shrink-0 font-display text-[28px] font-semibold leading-none sm:min-w-[72px] sm:text-[34px]">
                      {tokenCode(t.number)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate font-semibold ${t.label ? '' : 'text-slate'}`}>{who(t)}</span>
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
                      <IconButton label={`Cancel ${tokenCode(t.number)}`} disabled={busy}
                        className="hover:text-danger" onClick={() => setCancelTarget(t)}>
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

          <Panel>
            <h2 className="border-b border-line px-5 py-4 text-xl font-semibold">Recently finished</h2>
            {q.recent.length === 0 ? (
              <p className="px-5 py-8 text-slate">Served and cancelled tokens will appear here.</p>
            ) : (
              <ul className="divide-y divide-line">
                {q.recent.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="min-w-12 font-display text-2xl font-semibold text-slate">{tokenCode(t.number)}</span>
                    <span className="min-w-0 flex-1 truncate text-[15px]">{who(t)}</span>
                    <span className={`text-sm font-semibold ${t.status === 'served' ? 'text-ok' : 'text-slate'}`}>
                      {t.status === 'served' ? 'Served' : 'Cancelled'} {formatClock((t.served_at ?? t.cancelled_at)!)}
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
