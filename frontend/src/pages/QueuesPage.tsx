import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useToast } from '../components/Toasts'
import { Button, ErrorNote, Icon, LiveDot, Loading, PageTitle, Panel, Pill, TextField } from '../components/ui'
import { api } from '../lib/api'
import { tokenCode } from '../lib/time'

export function QueuesPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const [name, setName] = useState('')

  const queues = useQuery({ queryKey: ['queues'], queryFn: api.listQueues, refetchInterval: 10_000 })

  const create = useMutation({
    mutationFn: (queueName: string) => api.createQueue(queueName),
    onSuccess: (queue) => {
      setName('')
      queryClient.setQueryData(['queue', queue.id], queue)
      void queryClient.invalidateQueries({ queryKey: ['queues'] })
      toast(`Created "${queue.name}"`)
      navigate(`/queues/${queue.id}`)
    },
    onError: (err) => toast(err.message, 'error'),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed) create.mutate(trimmed)
  }

  return (
    <>
      <PageTitle subtitle="One queue for each counter or desk.">Queues</PageTitle>

      <Panel className="mb-8 p-5">
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <TextField id="queue-name" label="New queue" className="flex-1" value={name}
            onChange={(e) => setName(e.target.value)} maxLength={80}
            placeholder="For example: Front desk, Pharmacy, Billing" />
          <Button type="submit" size="lg" disabled={!name.trim() || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create queue'}
          </Button>
        </form>
      </Panel>

      {queues.isPending && <Loading what="your queues" />}
      {queues.isError && <ErrorNote message={queues.error.message} onRetry={() => void queues.refetch()} />}

      {queues.data && queues.data.length === 0 && (
        <div className="rounded-xl border border-dashed border-ink/15 bg-white/60 px-6 py-16 text-center">
          <p className="text-xl font-semibold tracking-tight">No queues yet</p>
          <p className="mx-auto mt-2 max-w-md text-slate">
            Create one above for each counter or desk. You can then add people to it and call them in order.
          </p>
        </div>
      )}

      {queues.data && queues.data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {queues.data.map((q) => (
            <li key={q.id}>
              <Link to={`/queues/${q.id}`}
                className="group flex h-full flex-col rounded-xl border border-line bg-white p-5 shadow-card transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-ink/20 hover:shadow-pop">
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0 truncate text-lg font-semibold tracking-tight">{q.name}</span>
                  {q.serving ? (
                    <Pill tone="signal"><LiveDot />Serving</Pill>
                  ) : (
                    <Pill>Counter free</Pill>
                  )}
                </span>

                <span className="mt-6 grid grid-cols-3 gap-3">
                  <span>
                    <span className="block font-mono text-[28px] font-semibold leading-none tracking-tight">{q.waiting_count}</span>
                    <span className="mt-1.5 block text-[13px] text-slate">waiting</span>
                  </span>
                  <span>
                    <span className={`block font-mono text-[28px] font-semibold leading-none tracking-tight ${q.serving ? '' : 'text-faint'}`}>
                      {q.serving ? tokenCode(q.serving.number) : '—'}
                    </span>
                    <span className="mt-1.5 block text-[13px] text-slate">now serving</span>
                  </span>
                  <span>
                    <span className="block font-mono text-[28px] font-semibold leading-none tracking-tight">{q.served_today}</span>
                    <span className="mt-1.5 block text-[13px] text-slate">served today</span>
                  </span>
                </span>

                <span className="mt-5 flex items-center gap-1.5 border-t border-line pt-4 text-sm font-medium text-slate transition-colors group-hover:text-ink">
                  Open queue
                  <span className="transition-transform duration-200 group-hover:translate-x-0.5">{Icon.forward}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
