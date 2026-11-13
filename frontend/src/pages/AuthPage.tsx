import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { WakeBanner } from '../components/Shell'
import { Button, TextField } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'

const DEMO = { email: 'demo@queuemanager.app', password: 'demo1234' }

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
    <div className="flex min-h-screen flex-col">
      <WakeBanner />
      <div className="grid flex-1 lg:grid-cols-[1.1fr_1fr]">
        {/* The display board: the product's one bold element. */}
        <aside className="on-board flex flex-col justify-between bg-board px-6 py-8 text-white sm:px-12 lg:py-14">
          <span className="inline-flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-signal font-display text-lg font-bold text-board">
              Q
            </span>
            <span className="text-[17px] font-semibold">Queue Manager</span>
          </span>
          <div className="my-8 lg:my-0">
            <p className="text-lg text-white/60">Now serving</p>
            <p className="font-display text-[clamp(96px,16vw,200px)] font-semibold leading-[0.9] tracking-tight text-signal">
              042
            </p>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-white/75">
              Create a queue for each counter, hand out tokens, call the next person with one click, and see how
              long people actually wait.
            </p>
          </div>
          <p className="text-sm text-white/45">Built for clinics, offices and service desks.</p>
        </aside>

        <main className="flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <h1 className="font-display text-4xl font-semibold tracking-tight">
              {isSignup ? 'Create your account' : 'Sign in'}
            </h1>
            <p className="mt-2 text-slate">
              {isSignup ? (
                <>
                  Already have one? <Link to="/login" className="font-semibold text-ink underline underline-offset-4">Sign in</Link>
                </>
              ) : (
                <>
                  New here? <Link to="/signup" className="font-semibold text-ink underline underline-offset-4">Create an account</Link>
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
                <p role="alert" className="text-[15px] font-medium text-danger">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
              </Button>
            </form>

            <div className="mt-8 border-t border-line pt-6">
              <p className="text-[15px] text-slate">
                Want to look around first? The demo account has two weeks of history in three queues.
              </p>
              <Button variant="secondary" className="mt-3 w-full" disabled={busy}
                onClick={() => void run(() => api.login(DEMO.email, DEMO.password))}>
                Open the demo account
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
