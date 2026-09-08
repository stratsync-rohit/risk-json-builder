'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth'
import { auth, firebaseConfigError, googleProvider, isFirebaseConfigured } from '@/lib/firebase'
import { LoginScreen } from './LoginScreen'

type AuthStatus = 'loading' | 'signed-out' | 'authorized' | 'denied'
type AuthContextValue = { user: User; signOut: () => Promise<void> }

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthGate')
  return context
}

function authErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to sign in with Google.'
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const deniedRef = useRef(false)

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setStatus('signed-out')
      setError(firebaseConfigError)
      return
    }

    return onAuthStateChanged(auth, currentUser => {
      if (!currentUser) {
        setUser(null)
        setStatus(deniedRef.current ? 'denied' : 'signed-out')
        if (!deniedRef.current) setError('')
        return
      }

      const email = currentUser.email?.trim().toLowerCase()
      const domain = email?.split('@')[1]

      if (!email || domain !== 'stratsync.ai') {
        deniedRef.current = true
        setUser(null)
        setStatus('denied')
        setError('Access denied. Please sign in with your @stratsync.ai account.')
        void firebaseSignOut(auth)
        return
      }

      deniedRef.current = false
      setUser(currentUser)
      setError('')
      setStatus('authorized')
    }, authStateError => {
      setUser(null)
      setStatus('signed-out')
      setError(authErrorMessage(authStateError))
    })
  }, [])

  const handleSignIn = async () => {
    if (!auth) {
      setError(firebaseConfigError)
      return
    }

    deniedRef.current = false
    setError('')
    setStatus('loading')
    setBusy(true)

    try {
      await signInWithPopup(auth, googleProvider)
    } catch (signInError) {
      setStatus('signed-out')
      setError(authErrorMessage(signInError))
    } finally {
      setBusy(false)
    }
  }

  const handleSignOut = async () => {
    if (!auth) return
    await firebaseSignOut(auth)
    setUser(null)
    setStatus('signed-out')
  }

  if (status === 'loading') {
    return <main className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">Checking authentication…</main>
  }

  if (status === 'authorized' && user) {
    return <AuthContext.Provider value={{ user, signOut: handleSignOut }}>{children}</AuthContext.Provider>
  }

  return <LoginScreen busy={busy} disabled={!isFirebaseConfigured || !auth} error={error} onSignIn={() => { void handleSignIn() }} />
}
