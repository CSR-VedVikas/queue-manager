import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'signal' | 'board'
type Size = 'md' | 'lg' | 'xl'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-white shadow-btn hover:bg-[#1b263c] disabled:bg-ink/35 disabled:shadow-none',
  secondary:
    'bg-white text-ink border border-line shadow-card hover:border-ink/25 hover:bg-ground disabled:text-slate/60 disabled:hover:border-line disabled:hover:bg-white',
  danger: 'bg-danger text-white shadow-btn hover:bg-[#ad1d25] disabled:bg-danger/40 disabled:shadow-none',
  ghost: 'text-slate hover:text-ink hover:bg-ink/5 disabled:text-slate/40 disabled:hover:bg-transparent',
  // The two below sit on the dark counter display.
  signal:
    'bg-signal text-board font-semibold shadow-glow hover:bg-[#ffb63d] disabled:bg-white/10 disabled:text-white/40 disabled:shadow-none',
  board: 'border border-white/15 bg-white/5 text-white hover:bg-white/10 disabled:text-white/40 disabled:hover:bg-white/5',
}

const SIZES: Record<Size, string> = {
  md: 'h-10 px-4 text-[15px]',
  lg: 'h-11 px-5 text-[15px]',
  xl: 'h-12 px-6 text-base',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function IconButton({
  label,
  tone = 'default',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: 'default' | 'danger' }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate transition-colors duration-150 disabled:cursor-not-allowed disabled:text-slate/30 disabled:hover:bg-transparent ${
        tone === 'danger' ? 'hover:bg-danger/10 hover:text-danger' : 'hover:bg-ink/5 hover:text-ink'
      }`}
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
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & { label: ReactNode; hint?: string; id: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        className="h-11 w-full rounded-lg border border-line bg-white px-3.5 text-[15px] text-ink shadow-card transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-ink/25 focus:border-ink focus:shadow-focus focus:outline-none"
        {...props}
      />
      {hint && <p className="mt-1.5 text-sm text-slate">{hint}</p>}
    </div>
  )
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-white shadow-card ${className}`}>{children}</section>
}

export function PageTitle({ children, subtitle, aside }: { children: ReactNode; subtitle?: string; aside?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[30px] font-semibold leading-tight tracking-tight sm:text-[34px]">{children}</h1>
        {subtitle && <p className="mt-1 text-slate">{subtitle}</p>}
      </div>
      {aside}
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Loading({ what }: { what: string }) {
  return (
    <p className="flex items-center justify-center gap-3 py-20 text-slate" role="status">
      <Spinner />
      Loading {what}…
    </p>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-danger/25 bg-danger/5 px-5 py-4">
      <p className="font-medium text-danger">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

/** Small rounded label: a state ("Serving", "Served") or a hint ("Next"). */
export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'signal' | 'ok'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-ground text-slate ring-line',
    signal: 'bg-signal-soft text-signal-ink ring-signal/30',
    ok: 'bg-ok-soft text-ok ring-ok/20',
  }
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  )
}

/** A dot that pulses: something is happening right now. */
export function LiveDot() {
  return (
    <span className="relative flex size-2" aria-hidden="true">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-signal opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-signal" />
    </span>
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
  back: (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  forward: (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 10h12M11 5l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  check: (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}
