import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useServerWaking } from '../lib/serverStatus'
import { Spinner } from './ui'

export function WakeBanner() {
  const waking = useServerWaking()
  if (!waking) return null
  return (
    <div role="status"
      className="flex items-center justify-center gap-2.5 border-b border-signal/30 bg-signal-soft px-4 py-2 text-sm font-medium text-signal-ink">
      <Spinner className="shrink-0" />
      <span>Starting the server. The free hosting tier sleeps when idle, so the first request can take up to a minute.</span>
    </div>
  )
}

export function Logo({ onBoard = false }: { onBoard?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className={`flex size-8 items-center justify-center rounded-[9px] ${onBoard ? 'bg-white/10 ring-1 ring-inset ring-white/15' : 'bg-ink shadow-btn'}`}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="9.25" cy="9.25" r="5" stroke="var(--color-signal)" strokeWidth="2.4" />
          <path d="M13 13l3.5 3.5" stroke="var(--color-signal)" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </span>
      <span className={`text-[16px] font-semibold tracking-tight ${onBoard ? '' : 'hidden sm:inline'}`}>Queue Manager</span>
    </span>
  )
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 text-[15px] font-medium transition-colors duration-150 ${
    isActive ? 'bg-ink/[0.07] text-ink' : 'text-slate hover:bg-ink/[0.04] hover:text-ink'
  }`

function initials(name: string | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts.length > 1 ? parts[parts.length - 1][0].toUpperCase() : '')
}

export function Shell() {
  const { manager, signOut } = useAuth()
  return (
    <div className="min-h-screen">
      <WakeBanner />
      <header className="sticky top-0 z-30 border-b border-line/80 bg-white/75 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3 sm:gap-7">
            <Logo />
            <nav className="flex gap-1" aria-label="Main">
              <NavLink to="/queues" className={navClass}>
                Queues
              </NavLink>
              <NavLink to="/dashboard" className={navClass}>
                Dashboard
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-2 text-[15px] sm:gap-3">
            <span className="hidden items-center gap-2.5 sm:flex">
              <span aria-hidden="true"
                className="flex size-7 items-center justify-center rounded-full bg-signal-soft text-xs font-semibold text-signal-ink ring-1 ring-inset ring-signal/30">
                {initials(manager?.name)}
              </span>
              <span className="text-slate">{manager?.name}</span>
            </span>
            <span className="hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
            <button type="button" onClick={signOut}
              className="rounded-lg px-2.5 py-1.5 font-medium text-slate transition-colors duration-150 hover:bg-ink/[0.04] hover:text-ink">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  )
}
