import { lazy, Suspense, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Shell, WakeBanner } from './components/Shell'
import { Button, Loading, Spinner } from './components/ui'
import { useAuth } from './lib/auth'
import { AuthPage } from './pages/AuthPage'
import { QueuePage } from './pages/QueuePage'
import { QueuesPage } from './pages/QueuesPage'

// The charts library is the largest dependency; load it only when the
// dashboard is opened, so sign-in and the queue screens load faster.
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })))

function RequireAuth({ children }: { children: ReactNode }) {
  const { manager, checking, restoreError, retryRestore } = useAuth()
  const location = useLocation()

  if (checking) {
    return (
      <div className="min-h-screen">
        <WakeBanner />
        <p className="flex items-center justify-center gap-3 py-28 text-slate" role="status">
          <Spinner />
          Signing you in…
        </p>
      </div>
    )
  }
  if (restoreError) {
    return (
      <div className="mx-auto max-w-md px-6 py-24">
        <div className="rounded-2xl border border-line bg-white px-8 py-10 text-center shadow-card">
          <p className="text-xl font-semibold tracking-tight">Can't reach the server</p>
          <p className="mt-2 text-slate">{restoreError}</p>
          <Button className="mt-6" onClick={retryRestore}>Try again</Button>
        </div>
      </div>
    )
  }
  if (!manager) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="font-mono text-sm font-medium text-faint">404</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">Page not found</p>
      <Link to="/queues" className="mt-4 inline-block font-medium underline decoration-line decoration-2 underline-offset-4 hover:decoration-ink">Go to your queues</Link>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route element={<RequireAuth><Shell /></RequireAuth>}>
        <Route path="/" element={<Navigate to="/queues" replace />} />
        <Route path="/queues" element={<QueuesPage />} />
        <Route path="/queues/:queueId" element={<QueuePage />} />
        <Route path="/dashboard" element={<Suspense fallback={<Loading what="dashboard" />}><DashboardPage /></Suspense>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
