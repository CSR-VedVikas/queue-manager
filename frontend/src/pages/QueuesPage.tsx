import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useToast } from '../components/Toasts'
import { Button, ErrorNote, Loading, PageTitle, Panel } from '../components/ui'
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
      <PageTitle>Queues</PageTitle>

      <Panel className="mb-8 p-5">
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="queue-name" className="mb-1.5 block text-sm font-semibold">
              New queue
            </label>
            <input id="queue-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
              placeholder="For example: Front desk, Pharmacy, Billing"
              className="h-11 w-full rounded-md border border-line bg-white px-3 text-[15px] placeholder:text-slate/70 hover:border-slate focus:border-ink focus:outline-none" />
          </div>
          <Button type="submit" disabled={!name.trim() || create.isPending} className="h-11">
            {create.isPending ? 'Creating…' : 'Create queue'}
          </Button>
        </form>
      </Panel>

      {queues.isPending && <Loading what="your queues" />}
      {queues.isError && <ErrorNote message={queues.error.message} onRetry={() => void queues.refetch()} />}

      {queues.data && queues.data.length === 0 && (
        <Panel className="px-6 py-14 text-center">
          <p className="text-xl font-semibold">No queues yet</p>
          <p className="mx-auto mt-2 max-w-md text-slate">
            Create one above for each counter or desk. You can then add people to it and call them in order.
          </p>
        </Panel>
      )}

      {queues.data && queues.data.length > 0 && (
        <Panel>
          <ul className="divide-y divide-line">
            {queues.data.map((q) => (
              <li key={q.id}>
                <Link to={`/queues/${q.id}`}
                  className="grid grid-cols-2 items-center gap-4 px-5 py-4 transition-colors hover:bg-ground/60 sm:grid-cols-[1fr_120px_140px_120px]">
                  <span className="col-span-2 sm:col-span-1">
                    <span className="block text-lg font-semibold">{q.name}</span>
                  </span>
                  <span>
                    <span className="block font-display text-3xl font-semibold leading-none">{q.waiting_count}</span>
                    <span className="text-sm text-slate">waiting</span>
                  </span>
                  <span>
                    <span className={`block font-display text-3xl font-semibold leading-none ${q.serving ? '' : 'text-slate/40'}`}>
                      {q.serving ? tokenCode(q.serving.number) : '—'}
                    </span>
                    <span className="text-sm text-slate">now serving</span>
                  </span>
                  <span className="hidden sm:block">
                    <span className="block font-display text-3xl font-semibold leading-none">{q.served_today}</span>
                    <span className="text-sm text-slate">served today</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  )
}
