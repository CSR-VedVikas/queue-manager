import { lazy, Suspense, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Shell, WakeBanner } from './components/Shell'
import { Button } from './components/ui'
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
        <p className="py-24 text-center text-slate" role="status">Signing you in…</p>
      </div>
    )
  }
  if (restoreError) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <p className="text-xl font-semibold">Can't reach the server</p>
        <p className="mt-2 text-slate">{restoreError}</p>
        <Button className="mt-6" onClick={retryRestore}>Try again</Button>
      </div>
    )
  }
  if (!manager) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="text-xl font-semibold">Page not found</p>
      <Link to="/queues" className="mt-4 inline-block font-semibold underline underline-offset-4">Go to your queues</Link>
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
        <Route path="/dashboard" element={<Suspense fallback={<p className="py-16 text-center text-slate">Loading dashboard…</p>}><DashboardPage /></Suspense>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
