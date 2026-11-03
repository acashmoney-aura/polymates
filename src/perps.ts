import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

export type PerpCategory = 'stocks' | 'crypto' | 'indices' | 'commodities' | 'pre-ipo'
export type PerpSide = 'long' | 'short'

export interface PerpAsset {
  symbol: string; name: string; category: PerpCategory; icon: string; maxLeverage: number
  price: number; indexPrice: number; change24h: number | null; changeUsd24h: number | null
  volume24h: number; openInterest: number; fundingRate: number; nextFunding: number | null
  feeRate: number; maintenanceRate: number; closeOnly: boolean; featured: boolean; spark?: number[]; updatedAt: number
}
export interface PerpAssetDetail extends PerpAsset { history: { t: number; p: number }[] }

export interface PerpPosition {
  id: string; leagueId: string; userId: string; symbol: string; name: string; icon: string; category: PerpCategory | null
  side: PerpSide; leverage: number; qty: number; notional: number; markNotional: number; margin: number
  entryPrice: number; markPrice: number; liquidationPrice: number; takeProfit: number | null; stopLoss: number | null
  funding: number; fees: number; unrealizedPnl: number; pnl: number; pnlPct: number; equity: number
  status: 'open' | 'closed' | 'liquidated'; closeReason: 'manual' | 'tp' | 'sl' | 'liquidation' | null
  exitPrice: number | null; openedAt: number; closedAt: number | null; source: string
}

export const PERP_TABS: { key: string; label: string; category?: PerpCategory }[] = [
  { key: 'discover', label: 'Discover' },
  { key: 'all', label: 'All assets' },
  { key: 'watchlist', label: 'Watchlist' },
  { key: 'stocks', label: 'Stocks', category: 'stocks' },
  { key: 'crypto', label: 'Crypto', category: 'crypto' },
  { key: 'indices', label: 'Indices', category: 'indices' },
  { key: 'commodities', label: 'Commodities', category: 'commodities' },
  { key: 'pre-ipo', label: 'Pre-IPO', category: 'pre-ipo' },
]

/** Prices like Polymarket: five significant digits, never fewer than the integer part. */
export function fmtPrice(p: number | null | undefined) {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—'
  const intDigits = Math.max(1, Math.floor(Math.log10(Math.abs(p) || 1)) + 1)
  return `$${p.toLocaleString('en-US', { maximumSignificantDigits: Math.min(21, Math.max(5, intDigits)) })}`
}

export const fmtPct = (x: number | null | undefined, digits = 2) =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`

export const fmtSignedPrice = (x: number | null | undefined) =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '-'}${fmtPrice(Math.abs(x))}`

/** Liquidation price for a new position (same formula as the server, without funding). */
export function liqPrice(side: PerpSide, entry: number, leverage: number, mmr: number) {
  const liq = side === 'long' ? (entry * (1 - 1 / leverage)) / (1 - mmr) : (entry * (1 + 1 / leverage)) / (1 + mmr)
  return Math.max(0, liq)
}

/** An open position re-marked at a newer price (the server's numbers shift by the change in unrealized P&L). */
export function remark(p: PerpPosition, mark: number | null | undefined): PerpPosition {
  if (p.status !== 'open' || !mark || mark === p.markPrice) return p
  const upnl = (p.side === 'long' ? 1 : -1) * p.qty * (mark - p.entryPrice)
  const d = upnl - p.unrealizedPnl
  const pnl = p.pnl + d
  return { ...p, markPrice: mark, unrealizedPnl: upnl, pnl, pnlPct: p.margin ? pnl / p.margin : 0, equity: p.equity + d }
}

/* ---------------- live data hooks ---------------- */

export function usePerpAssets(intervalMs = 5000) {
  const [assets, setAssets] = useState<PerpAsset[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    const load = () => api<PerpAsset[]>('/api/perps/assets')
      .then((a) => { if (live) { setAssets(a); setError(null) } })
      .catch((e) => live && setError((e as Error).message))
    void load()
    const t = setInterval(load, intervalMs)
    return () => { live = false; clearInterval(t) }
  }, [intervalMs])
  return { assets, error }
}

export function usePerpAsset(symbol: string, range: string) {
  const [asset, setAsset] = useState<PerpAssetDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    const load = () => api<PerpAssetDetail>(`/api/perps/assets/${encodeURIComponent(symbol)}?range=${range}`)
      .then((a) => { if (live) { setAsset(a); setError(null) } })
      .catch((e) => live && setError((e as Error).message))
    void load()
    const t = setInterval(load, 5000)
    return () => { live = false; clearInterval(t) }
  }, [symbol, range])
  return { asset, error }
}

/* ---------------- watchlist (per browser) ---------------- */

const WATCH_KEY = 'pm_perps_watch'
const watchListeners = new Set<() => void>()
const readWatch = (): string[] => {
  try { return JSON.parse(localStorage.getItem(WATCH_KEY) ?? '[]') } catch { return [] }
}

export function useWatchlist() {
  const [list, setList] = useState<string[]>(readWatch)
  useEffect(() => {
    const on = () => setList(readWatch())
    watchListeners.add(on)
    return () => { watchListeners.delete(on) }
  }, [])
  const toggle = useCallback((symbol: string) => {
    const cur = readWatch()
    const next = cur.includes(symbol) ? cur.filter((s) => s !== symbol) : [...cur, symbol]
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(next)) } catch { /* private mode */ }
    setList(next)
    watchListeners.forEach((l) => l())
  }, [])
  return { list, has: (s: string) => list.includes(s), toggle }
}
