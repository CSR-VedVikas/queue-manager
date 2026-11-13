import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'signal'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-[#2b3949] disabled:bg-slate/50',
  secondary: 'bg-white text-ink border border-line hover:border-slate disabled:text-slate/60',
  danger: 'bg-white text-danger border border-line hover:border-danger disabled:text-slate/60',
  ghost: 'text-slate hover:text-ink hover:bg-ink/5 disabled:text-slate/40',
  signal: 'bg-signal text-board hover:bg-[#ffbb1a] disabled:bg-board-line disabled:text-white/50',
}

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 h-10 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function IconButton({
  label,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md text-slate transition-colors hover:bg-ink/5 hover:text-ink disabled:cursor-not-allowed disabled:text-slate/30 disabled:hover:bg-transparent ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function TextField({
  label,
  hint,
  id,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; id: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        className="h-11 w-full rounded-md border border-line bg-white px-3 text-[15px] text-ink placeholder:text-slate/70 hover:border-slate focus:border-ink focus:outline-none"
        {...props}
      />
      {hint && <p className="mt-1.5 text-sm text-slate">{hint}</p>}
    </div>
  )
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-line bg-white ${className}`}>{children}</section>
}

export function PageTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <h1 className="font-display text-[40px] font-semibold leading-none tracking-tight">{children}</h1>
      {aside}
    </div>
  )
}

export function Loading({ what }: { what: string }) {
  return (
    <p className="py-16 text-center text-slate" role="status">
      Loading {what}…
    </p>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-white px-5 py-4">
      <p className="font-semibold text-danger">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

// Minimal inline icons (no icon library needed).
export const Icon = {
  up: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 15V5M5 10l5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  down: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 5v10M5 10l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  cross: (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
}
