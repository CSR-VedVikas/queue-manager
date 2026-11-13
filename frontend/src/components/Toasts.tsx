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
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start justify-between gap-3 rounded-md px-4 py-3 text-[15px] shadow-lg ${
              t.kind === 'error' ? 'bg-danger text-white' : 'bg-ink text-white'
            }`}
          >
            <span>{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} className="text-white/70 hover:text-white" aria-label="Dismiss">
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
