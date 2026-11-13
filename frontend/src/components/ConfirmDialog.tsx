import { useEffect, useRef } from 'react'
import { Button } from './ui'

/**
 * Uses the native <dialog> element: it traps focus, closes on Escape and
 * returns focus to the button that opened it, with no extra library.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault()
      }}
      className="m-auto w-[min(92vw,440px)] rounded-lg border border-line bg-white p-0 text-ink backdrop:bg-ink/40"
    >
      <div className="p-6">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-slate">{body}</p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
