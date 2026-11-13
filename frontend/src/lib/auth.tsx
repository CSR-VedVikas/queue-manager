import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api, getToken, setToken, setUnauthorisedHandler } from './api'
import type { AuthResponse, Manager } from './types'

interface AuthState {
  manager: Manager | null
  checking: boolean          // confirming a saved session on page load
  restoreError: string | null // server unreachable while restoring a session
  retryRestore: () => void
  signIn: (res: AuthResponse) => void
  signOut: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [manager, setManager] = useState<Manager | null>(null)
  const [checking, setChecking] = useState(() => getToken() !== null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const signOut = useCallback(() => {
    setToken(null)
    setManager(null)
    queryClient.clear() // never show the previous user's data to the next one
  }, [queryClient])

  const signIn = useCallback(
    (res: AuthResponse) => {
      queryClient.clear()
      setToken(res.access_token)
      setManager(res.manager)
    },
    [queryClient],
  )

  // An expired or revoked token anywhere in the app signs the user out.
  useEffect(() => setUnauthorisedHandler(signOut), [signOut])

  // Restore a saved session on page load. Only a 401 means the session is
  // bad; any other failure (server waking up, offline) keeps the token and
  // offers a retry, so a slow server never logs anyone out.
  useEffect(() => {
    if (!getToken()) return
    let cancelled = false
    setChecking(true)
    setRestoreError(null)
    api
      .me()
      .then((m) => {
        if (!cancelled) setManager(m)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) setToken(null)
        else setRestoreError(err instanceof Error ? err.message : 'Something went wrong')
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retryRestore = useCallback(() => setAttempt((n) => n + 1), [])

  const value = useMemo(
    () => ({ manager, checking, restoreError, retryRestore, signIn, signOut }),
    [manager, checking, restoreError, retryRestore, signIn, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
