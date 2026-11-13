import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useServerWaking } from '../lib/serverStatus'

export function WakeBanner() {
  const waking = useServerWaking()
  if (!waking) return null
  return (
    <div role="status" className="bg-signal px-4 py-2 text-center text-[15px] font-medium text-board">
      Starting the server. The free hosting tier sleeps when idle, so the first request can take up to a minute.
    </div>
  )
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-board font-display text-lg font-bold text-signal">
        Q
      </span>
      <span className="hidden text-[17px] font-semibold tracking-tight sm:inline">Queue Manager</span>
    </span>
  )
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-[15px] font-semibold transition-colors ${
    isActive ? 'bg-ink text-white' : 'text-slate hover:text-ink hover:bg-ink/5'
  }`

export function Shell() {
  const { manager, signOut } = useAuth()
  return (
    <div className="min-h-screen">
      <WakeBanner />
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 sm:gap-6">
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
          <div className="flex items-center gap-3 text-[15px]">
            <span className="hidden text-slate sm:inline">{manager?.name}</span>
            <button type="button" onClick={signOut} className="font-semibold text-slate hover:text-ink">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}
