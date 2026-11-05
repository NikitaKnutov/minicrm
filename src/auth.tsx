import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile } from './types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  error: boolean
  signOut: () => void
}

const AuthContext = createContext<AuthState>(null!)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => setLoading(false))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      return
    }
    let cancelled = false
    // Сеть до Supabase может виснуть — не показываем «Загрузка…» бесконечно.
    const timer = setTimeout(() => {
      if (!cancelled) setError(true)
    }, 10000)
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error: queryError }) => {
        if (cancelled) return
        clearTimeout(timer)
        if (queryError || !data) setError(true)
        else {
          setError(false)
          setProfile(data)
        }
      })
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [session])

  return (
    <AuthContext.Provider value={{ session, profile, loading, error, signOut: () => void supabase.auth.signOut() }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
