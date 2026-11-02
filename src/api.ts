export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8787'

export type Outcome = 'yes' | 'no'
export type Side = 'buy' | 'sell'
export type LeagueMode = 'mirror' | 'exchange'

export interface User { id: string; username: string; displayName: string; avatarHue: number; createdAt: number }
export interface LeagueSummary {
  id: string; name: string; mode: LeagueMode; role: 'owner' | 'member'; cash: number
  startingBalance: number; inviteCode: string; members: number
}
export interface League {
  id: string; name: string; inviteCode: string; mode: LeagueMode; startingBalance: number; ownerId: string
  createdAt: number; marketScope: 'all' | 'curated'; enabledEvents: string[]; disabledMarkets: string[]
  houseLiquidity: boolean; members: (User & { role: string; joinedAt: number })[]
}
export interface Market {
  id: string; eventId: string; question: string; title: string; image: string; outcomes: [string, string]
  price: number; polymarketPrice: number; bestBid: number | null; bestAsk: number | null; lastTrade: number | null
  change24h: number | null; volume: number; volume24h: number; leagueVolume: number; endDate: string | null
  tick: number; active: boolean; resolved: boolean; payout: [number, number] | null; settled: boolean
  enabled: boolean; description: string
}
export interface PMEvent {
  id: string; slug: string; title: string; description?: string; resolutionSource?: string; image: string; icon: string
  tags: { slug: string; label: string }[]; volume: number; volume24h: number; liquidity: number
  endDate: string | null; startDate: string | null; createdAt: string | null; negRisk: boolean; closed: boolean
  commentCount: number; enabled: boolean; markets: Market[]
}
export interface Book { source: 'league' | 'polymarket'; bids: { price: number; size: number }[]; asks: { price: number; size: number }[]; last: number | null; tick: number }
export interface PositionRow {
  marketId: string; eventSlug: string | null; eventTitle: string | null; question: string; title: string; image: string
  outcome: Outcome; outcomeLabel: string; size: number; avgPrice: number; curPrice: number; cost: number; value: number
  pnl: number; pnlPct: number; resolved: boolean; endDate: string | null
}
export interface Portfolio { cash: number; availableCash: number; positionsValue: number; value: number; pnl: number; realized: number; positions: PositionRow[] }
export interface OrderRow {
  id: string; marketId: string; side: Side; outcome: Outcome; type: 'limit' | 'market'; price: number; size: number
  filled: number; notional: number; remaining: number; status: 'open' | 'filled' | 'cancelled'; source: string
  createdAt: number; updatedAt: number; title: string; question: string; outcomeLabel: string; eventSlug: string | null; image: string
}
export interface TradeRow {
  id: string; marketId: string; yesPrice: number; size: number; takerSide: Side; takerOutcome: Outcome; ts: number
  title: string; eventSlug: string | null; image: string; outcomeLabel: string; price: number; mine: boolean
  taker: { username: string; displayName: string; avatarHue: number } | null
}
export interface LeaderRow {
  rank: number; userId: string; username: string; displayName: string; avatarHue: number; value: number; cash: number
  pnl: number; pnlPct: number; volume: number; positions: number; bots: number
}
export interface ActivityRow {
  id: string; kind: string; text: string; ts: number; user: User | null; eventSlug?: string | null; image?: string | null
}
export interface ApiKeyRow { id: string; name: string; prefix: string; createdAt: number; lastUsedAt: number | null; key?: string }
export interface ScriptRow {
  id: string; leagueId: string; name: string; code: string; enabled: boolean; intervalSec: number; createdAt: number
  updatedAt: number; lastRunAt: number | null; lastError: string | null; runs: number; store: unknown
}
export interface ScriptLog { ts: number; level: 'info' | 'error'; msg: string }

let token: string | null = (() => {
  try { return localStorage.getItem('pm_token') } catch { return null }
})()

export const getToken = () => token
export function setToken(t: string | null) {
  token = t
  try {
    if (t) localStorage.setItem('pm_token', t)
    else localStorage.removeItem('pm_token')
  } catch { /* private mode */ }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`)
  return data as T
}

export const qs = (o: Record<string, string | number | undefined | null | false>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

/* ---------------- formatting ---------------- */

export const cents = (p: number | null | undefined) => {
  if (p === null || p === undefined || Number.isNaN(p)) return '—'
  const c = p * 100
  if (c > 0 && c < 1) return `${c.toFixed(1)}¢`
  if (c > 99 && c < 100) return `${c.toFixed(1)}¢`
  return `${Math.round(c)}¢`
}

export const pct = (p: number) => {
  const c = p * 100
  if (c > 0 && c < 1) return '<1%'
  if (c > 99 && c < 100) return '>99%'
  return `${Math.round(c)}%`
}

export const usd = (n: number, digits = 2) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits })

export const signedUsd = (n: number) => `${n >= 0 ? '+' : '-'}${usd(Math.abs(n))}`

export const compactUsd = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1e9) return `$${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '')}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`
  return `$${Math.round(n)}`
}

export const shares = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

export const shortDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export const timeAgo = (ts: number) => {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
