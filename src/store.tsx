import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  api, API_URL, getToken, setToken, type League, type LeagueSummary, type Outcome, type Portfolio, type User,
} from './api'

export interface StreamEvent { type: string; leagueId: string; marketId?: string; userId?: string; data?: unknown }
export interface TradeIntent { eventSlug: string; marketId: string; outcome: Outcome; side?: 'buy' | 'sell' }

interface Toast { id: number; text: string; kind: 'ok' | 'error' }

interface AppState {
  user: User | null
  ready: boolean
  leagues: LeagueSummary[]
  leagueId: string | null
  league: League | null
  portfolio: Portfolio | null
  authModal: 'login' | 'signup' | null
  sheet: TradeIntent | null
  toasts: Toast[]
  setLeagueId: (id: string) => void
  openAuth: (m: 'login' | 'signup' | null) => void
  openSheet: (t: TradeIntent | null) => void
  login: (token: string, user: User) => Promise<void>
  logout: () => void
  refreshMe: () => Promise<void>
  refreshLeague: () => Promise<void>
  refreshPortfolio: () => Promise<void>
  toast: (text: string, kind?: 'ok' | 'error') => void
  subscribe: (fn: (e: StreamEvent) => void) => () => void
}

const Ctx = createContext<AppState | null>(null)

export function useApp() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp outside provider')
  return c
}

const storedLeague = () => {
  try { return localStorage.getItem('pm_league') } catch { return null }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [leagues, setLeagues] = useState<LeagueSummary[]>([])
  const [leagueId, setLeagueIdState] = useState<string | null>(storedLeague())
  const [league, setLeague] = useState<League | null>(null)
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [authModal, openAuth] = useState<'login' | 'signup' | null>(null)
  const [sheet, openSheet] = useState<TradeIntent | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const listeners = useRef(new Set<(e: StreamEvent) => void>())

  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  const setLeagueId = useCallback((id: string) => {
    setLeagueIdState(id)
    try { localStorage.setItem('pm_league', id) } catch { /* ignore */ }
  }, [])

  const refreshMe = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setLeagues([])
      setReady(true)
      return
    }
    try {
      const me = await api<{ user: User; leagues: LeagueSummary[] }>('/api/me')
      setUser(me.user)
      setLeagues(me.leagues)
      setLeagueIdState((cur) => (cur && me.leagues.some((l) => l.id === cur) ? cur : (me.leagues[0]?.id ?? null)))
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        setToken(null)
        setUser(null)
      }
    } finally {
      setReady(true)
    }
  }, [])

  const activeLeague = user && leagueId && leagues.some((l) => l.id === leagueId) ? leagueId : null

  const refreshLeague = useCallback(async () => {
    if (!activeLeague) return setLeague(null)
    setLeague(await api<League>(`/api/leagues/${activeLeague}`).catch(() => null))
  }, [activeLeague])

  const refreshPortfolio = useCallback(async () => {
    if (!activeLeague) return setPortfolio(null)
    setPortfolio(await api<Portfolio>(`/api/leagues/${activeLeague}/portfolio`).catch(() => null))
  }, [activeLeague])

  useEffect(() => { void refreshMe() }, [refreshMe])
  useEffect(() => {
    void refreshLeague()
    void refreshPortfolio()
  }, [refreshLeague, refreshPortfolio])

  // live updates for the active league
  useEffect(() => {
    if (!activeLeague || !getToken()) return
    let es: EventSource | null = null
    let retry: ReturnType<typeof setTimeout>
    let pfTimer: ReturnType<typeof setTimeout> | null = null
    const connect = () => {
      es = new EventSource(`${API_URL}/api/stream?league=${activeLeague}&token=${encodeURIComponent(getToken() ?? '')}`)
      es.onmessage = (msg) => {
        const e = JSON.parse(msg.data) as StreamEvent
        listeners.current.forEach((fn) => fn(e))
        if (e.type === 'league') void refreshLeague()
        if (['orders', 'trade', 'resolve'].includes(e.type)) {
          pfTimer ??= setTimeout(() => {
            pfTimer = null
            void refreshPortfolio()
          }, 400)
        }
      }
      es.onerror = () => {
        es?.close()
        retry = setTimeout(connect, 3000)
      }
    }
    connect()
    return () => {
      es?.close()
      clearTimeout(retry)
      if (pfTimer) clearTimeout(pfTimer)
    }
  }, [activeLeague, refreshLeague, refreshPortfolio])

  const login = useCallback(async (t: string, u: User) => {
    setToken(t)
    setUser(u)
    openAuth(null)
    await refreshMe()
  }, [refreshMe])

  const logout = useCallback(() => {
    void api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {})
    setToken(null)
    setUser(null)
    setLeagues([])
    setLeague(null)
    setPortfolio(null)
  }, [])

  const subscribe = useCallback((fn: (e: StreamEvent) => void) => {
    listeners.current.add(fn)
    return () => { listeners.current.delete(fn) }
  }, [])

  const value = useMemo<AppState>(() => ({
    user, ready, leagues, leagueId: activeLeague, league, portfolio, authModal, sheet, toasts,
    setLeagueId, openAuth, openSheet, login, logout, refreshMe, refreshLeague, refreshPortfolio, toast, subscribe,
  }), [user, ready, leagues, activeLeague, league, portfolio, authModal, sheet, toasts, setLeagueId, login, logout,
    refreshMe, refreshLeague, refreshPortfolio, toast, subscribe])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Re-run `fn` whenever a matching stream event arrives (debounced). */
export function useStream(filter: (e: StreamEvent) => boolean, fn: () => void) {
  const { subscribe } = useApp()
  const ref = useRef({ filter, fn })
  ref.current = { filter, fn }
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const off = subscribe((e) => {
      if (!ref.current.filter(e)) return
      t ??= setTimeout(() => {
        t = null
        ref.current.fn()
      }, 250)
    })
    return () => {
      off()
      if (t) clearTimeout(t)
    }
  }, [subscribe])
}
