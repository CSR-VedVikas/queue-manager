import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Logo, WakeBanner } from '../components/Shell'
import { Button, Icon, LiveDot, TextField } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'

const DEMO = { email: 'demo@queuemanager.app', password: 'demo1234' }

const POINTS = [
  'Issue a numbered token in one click',
  'Reorder the line, or call the next person',
  'See typical and long waits by hour and day',
]

const linkClass = 'font-medium text-ink underline decoration-line decoration-2 underline-offset-4 transition-colors hover:decoration-ink'

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { manager, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/queues'

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (manager) return <Navigate to={from} replace />

  async function run(action: () => ReturnType<typeof api.login>) {
    setBusy(true)
    setError(null)
    try {
      signIn(await action())
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'signup') void run(() => api.signup(name, email, password))
    else void run(() => api.login(email, password))
  }

  const isSignup = mode === 'signup'

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <WakeBanner />
      <div className="grid flex-1 lg:grid-cols-[1.05fr_1fr]">
        {/* The display board: the product's one bold element. */}
        <aside className="board on-board flex flex-col justify-between gap-8 px-6 py-8 text-white sm:px-12 lg:gap-10 lg:py-12">
          <Logo onBoard />
          <div>
            <p className="flex items-center gap-2.5 text-sm font-medium uppercase tracking-[0.14em] text-white/60">
              <LiveDot />
              Now serving
            </p>
            <p className="mt-3 font-mono text-[clamp(88px,15vw,184px)] font-semibold leading-[0.9] tracking-tighter text-signal">
              042
            </p>
            <div className="mt-6 hidden flex-wrap items-center gap-2 text-sm text-white/50 lg:flex" aria-hidden="true">
              <span className="mr-1">Up next</span>
              {['043', '044', '045'].map((n) => (
                <span key={n} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono font-medium text-white/80">
                  {n}
                </span>
              ))}
            </div>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-white/75 lg:mt-9">
              Create a queue for each counter, hand out tokens, call the next person with one click, and see how
              long people actually wait.
            </p>
            <ul className="mt-6 hidden space-y-2.5 text-[15px] text-white/80 lg:block">
              {POINTS.map((point) => (
                <li key={point} className="flex items-center gap-3">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-signal/15 text-signal">
                    {Icon.check}
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-sm text-white/45">Built for clinics, offices and service desks.</p>
        </aside>

        <main className="flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <h1 className="text-[32px] font-semibold leading-tight tracking-tight">
              {isSignup ? 'Create your account' : 'Sign in'}
            </h1>
            <p className="mt-2 text-slate">
              {isSignup ? (
                <>
                  Already have one? <Link to="/login" className={linkClass}>Sign in</Link>
                </>
              ) : (
                <>
                  New here? <Link to="/signup" className={linkClass}>Create an account</Link>
                </>
              )}
            </p>

            <form onSubmit={submit} className="mt-8 space-y-5" noValidate={false}>
              {isSignup && (
                <TextField id="name" label="Your name" autoComplete="name" required maxLength={100}
                  value={name} onChange={(e) => setName(e.target.value)} />
              )}
              <TextField id="email" label="Email" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)} />
              <TextField id="password" label="Password" type="password" required
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                minLength={isSignup ? 8 : undefined} maxLength={72}
                hint={isSignup ? 'At least 8 characters.' : undefined}
                value={password} onChange={(e) => setPassword(e.target.value)} />

              {error && (
                <p role="alert" className="rounded-lg border border-danger/25 bg-danger/5 px-3.5 py-2.5 text-[15px] font-medium text-danger">
                  {error}
                </p>
              )}

              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
              </Button>
            </form>

            <div className="my-7 flex items-center gap-3 text-xs font-medium uppercase tracking-[0.14em] text-faint" aria-hidden="true">
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>

            <div className="rounded-xl border border-line bg-ground p-4">
              <p className="text-[15px] text-slate">
                Want to look around first? The demo account has two weeks of history in three queues.
              </p>
              <Button variant="secondary" size="lg" className="mt-3 w-full" disabled={busy}
                onClick={() => void run(() => api.login(DEMO.email, DEMO.password))}>
                Open the demo account
                {Icon.forward}
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
