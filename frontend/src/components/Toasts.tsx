import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type Kind = 'info' | 'error'
interface Toast {
  id: number
  kind: Kind
  message: string
}

const ToastContext = createContext<((message: string, kind?: Kind) => void) | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), [])

  const show = useCallback(
    (message: string, kind: Kind = 'info') => {
      const id = nextId.current++
      // Keep at most three on screen.
      setToasts((all) => [...all.slice(-2), { id, kind, message }])
      setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3500)
    },
    [dismiss],
  )

  const value = useMemo(() => show, [show])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex animate-rise items-start gap-3 rounded-xl px-4 py-3 text-[15px] text-white shadow-pop ring-1 ring-inset ring-white/10 ${
              t.kind === 'error' ? 'bg-danger' : 'bg-ink'
            }`}
          >
            <span aria-hidden="true"
              className={`mt-[3px] flex size-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                t.kind === 'error' ? 'bg-white text-danger' : 'bg-signal text-board'
              }`}>
              {t.kind === 'error' ? '!' : '✓'}
            </span>
            <span className="min-w-0 flex-1">{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)}
              className="-mr-1 rounded px-1 text-lg leading-none text-white/60 transition-colors hover:text-white" aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
