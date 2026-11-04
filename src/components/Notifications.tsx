import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cents, signedUsd, timeAgo, usd, type PositionRow } from '../api'
import { Icon } from '../icons'
import { useLiveQuote, usePerpMark } from '../live'
import { fmtPct, fmtPrice, remark, type PerpPosition } from '../perps'
import { navigate } from '../router'
import { useApp, type StreamEvent } from '../store'
import { AnimatedNumber, Flash } from './Motion'
import { Img } from './ui'

/* The bell in the header: a live view of your open positions plus alerts for fills, take-profits, stop-outs,
   liquidations, resolutions and big moves. Alerts are kept per user and league in this browser. */

type Tone = 'up' | 'down' | 'neutral' | 'danger'
export interface Note { id: string; title: string; body?: string; ts: number; tone: Tone; href?: string }

interface NotesState {
  notes: Note[]
  unread: number
  open: boolean
  setOpen: (v: boolean) => void
  clear: () => void
}
const Ctx = createContext<NotesState | null>(null)
const useNotes = () => useContext(Ctx)!

const MAX_NOTES = 60
// open positions re-mark live from pushed prices; this poll only feeds move and liquidation alerts
const POLL_MS = 10_000
/** a prediction position moving this much (share of cost) since the last alert raises a new one */
const MOVE_STEP = 0.1
/** perps move in leverage, so alert per 25% of margin */
const PERP_STEP = 0.25
/** warn when the mark is within this share of the liquidation price */
const LIQ_WARN = 0.02

const keyFor = (u: string, l: string) => `pm_notes:${u}:${l}`
const load = (k: string): Note[] => {
  try { return JSON.parse(localStorage.getItem(k) ?? '[]') as Note[] } catch { return [] }
}

function classify(text: string): Tone {
  if (/liquidated/i.test(text)) return 'danger'
  if (/stopped out|lost/i.test(text)) return 'down'
  if (/took profit|\(\+/.test(text)) return 'up'
  return 'neutral'
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, leagueId, portfolio, refreshPortfolio, subscribe, toast } = useApp()
  const storeKey = user && leagueId ? keyFor(user.id, leagueId) : null
  const [notes, setNotes] = useState<Note[]>([])
  const [seenAt, setSeenAt] = useState(0)
  const [open, setOpenState] = useState(false)
  const baselines = useRef(new Map<string, number>())
  const warned = useRef(new Set<string>())

  useEffect(() => {
    setNotes(storeKey ? load(storeKey) : [])
    let seen = 0
    try { seen = Number(localStorage.getItem(`${storeKey}:seen`)) || 0 } catch { /* ignore */ }
    setSeenAt(seen)
    baselines.current.clear()
    warned.current.clear()
  }, [storeKey])

  const push = useCallback((n: Omit<Note, 'id' | 'ts'>, alsoToast = false) => {
    const note = { ...n, id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`, ts: Date.now() }
    setNotes((xs) => {
      const next = [note, ...xs].slice(0, MAX_NOTES)
      if (storeKey) try { localStorage.setItem(storeKey, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
    if (alsoToast) toast(n.body ? `${n.title}: ${n.body}` : n.title, n.tone === 'danger' || n.tone === 'down' ? 'error' : 'ok')
  }, [storeKey, toast])

  // your own fills and perps events, and resolutions of markets you hold
  const held = useRef(new Map<string, PositionRow>())
  useEffect(() => {
    held.current = new Map((portfolio?.positions ?? []).map((p) => [p.marketId, p]))
  }, [portfolio])
  useEffect(() => {
    if (!user) return
    return subscribe((e: StreamEvent) => {
      if (e.type === 'activity') {
        const a = e.data as { userId?: string; text?: string; marketId?: string } | undefined
        if (!a?.text || a.userId !== user.id) return
        const tone = classify(a.text)
        const perp = a.text.match(/ ([A-Z0-9.]+) perp| on ([A-Z0-9.]+) \(/)
        const sym = perp?.[1] ?? perp?.[2]
        const title = /liquidated/.test(a.text) ? 'Liquidated' : /took profit/.test(a.text) ? 'Take profit hit'
          : /stopped out/.test(a.text) ? 'Stop loss hit' : /opened a/.test(a.text) ? 'Position opened'
          : /closed a/.test(a.text) ? 'Position closed' : /filled/i.test(a.text) ? 'Limit order filled' : 'Order filled'
        // the server writes these in the third person; read them back as yours
        const own = a.text.replace(new RegExp(`^${user.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`), '')
        const body = own.charAt(0).toUpperCase() + own.slice(1)
        push({ title, body, tone, href: sym ? `/perps/${sym}` : undefined }, tone === 'danger' || /take profit|stop loss/i.test(title))
      }
      if (e.type === 'resolve' && e.marketId && held.current.has(e.marketId)) {
        const p = held.current.get(e.marketId)!
        push({ title: 'Market resolved', body: `${p.title}: you held ${p.outcomeLabel}`, tone: 'neutral', href: p.eventSlug ? `/event/${p.eventSlug}` : undefined }, true)
      }
    })
  }, [user, subscribe, push])

  // keep marks fresh while anything is open, so moves and liquidation risk get noticed
  const hasOpen = !!(portfolio?.positions.length || portfolio?.perps?.some((p) => p.status === 'open'))
  useEffect(() => {
    if (!hasOpen) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refreshPortfolio() }, POLL_MS)
    return () => clearInterval(t)
  }, [hasOpen, refreshPortfolio])

  // big moves and liquidation risk, measured from the last alert for each position
  useEffect(() => {
    if (!portfolio) return
    const step = (key: string, pct: number, stepSize: number) => {
      const base = baselines.current.get(key)
      if (base === undefined) { baselines.current.set(key, pct); return null }
      if (Math.abs(pct - base) < stepSize) return null
      baselines.current.set(key, pct)
      return pct - base
    }
    for (const p of portfolio.positions) {
      const d = step(`m:${p.marketId}:${p.outcome}`, p.pnlPct, MOVE_STEP)
      if (d !== null) {
        push({
          title: `${p.outcomeLabel} ${d > 0 ? 'up' : 'down'} ${Math.abs(Math.round(d * 100))}%`,
          body: `${p.title} · now ${cents(p.curPrice)}, ${signedUsd(p.pnl)} overall`,
          tone: d > 0 ? 'up' : 'down', href: p.eventSlug ? `/event/${p.eventSlug}` : undefined,
        })
      }
    }
    for (const p of portfolio.perps ?? []) {
      if (p.status !== 'open') continue
      const d = step(`p:${p.id}`, p.pnlPct, PERP_STEP)
      if (d !== null) {
        push({
          title: `${p.symbol} ${p.leverage}x ${p.side} ${d > 0 ? 'up' : 'down'} ${Math.abs(Math.round(d * 100))}% of margin`,
          body: `Mark ${fmtPrice(p.markPrice)} · ${signedUsd(p.pnl)} overall`, tone: d > 0 ? 'up' : 'down', href: `/perps/${p.symbol}`,
        })
      }
      const gap = Math.abs(p.markPrice - p.liquidationPrice) / p.markPrice
      if (gap < LIQ_WARN && !warned.current.has(p.id)) {
        warned.current.add(p.id)
        push({ title: `${p.symbol} near liquidation`, body: `Mark ${fmtPrice(p.markPrice)}, liquidates at ${fmtPrice(p.liquidationPrice)}`, tone: 'danger', href: `/perps/${p.symbol}` }, true)
      }
    }
  }, [portfolio, push])

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v)
    if (v) {
      const now = Date.now()
      setSeenAt(now)
      if (storeKey) try { localStorage.setItem(`${storeKey}:seen`, String(now)) } catch { /* ignore */ }
    }
  }, [storeKey])
  const clear = useCallback(() => {
    setNotes([])
    if (storeKey) try { localStorage.removeItem(storeKey) } catch { /* ignore */ }
  }, [storeKey])
  const unread = open ? 0 : notes.filter((n) => n.ts > seenAt).length
  const value = useMemo(() => ({ notes, unread, open, setOpen, clear }), [notes, unread, open, setOpen, clear])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/* ---------------- live rows ---------------- */

/** Values seen since the panel opened, for a small sparkline. */
function useTrail(v: number) {
  const trail = useRef<number[]>([])
  const last = trail.current[trail.current.length - 1]
  if (last !== v) trail.current = [...trail.current.slice(-39), v]
  return trail.current
}

function Trail({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return <svg className="np-trail" width={56} height={20} />
  const lo = Math.min(...values), hi = Math.max(...values), r = hi - lo || 1
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1)) * 56},${18 - ((v - lo) / r) * 16}`).join('')
  return <svg className="np-trail" width={56} height={20}><path d={d} fill="none" stroke={up ? 'var(--yes-accent)' : 'var(--no)'} strokeWidth={1.5} /></svg>
}

function PredictionRow({ p, live }: { p: PositionRow; live: boolean }) {
  const q = useLiveQuote(p.marketId, live && !p.resolved)
  const cur = q ? (p.outcome === 'yes' ? q.price : 1 - q.price) : p.curPrice
  const value = p.size * cur
  const pnl = value - p.cost
  const trail = useTrail(pnl)
  return (
    <button className="np-row" onClick={() => p.eventSlug && navigate(`/event/${p.eventSlug}`)}>
      <Img src={p.image} size={34} radius={7} />
      <span className="np-main">
        <b className="ellipsis">{p.title}</b>
        <small><span className={`pill-outcome ${p.outcome}`}>{p.outcomeLabel}</span> {p.size.toFixed(0)} @ {cents(p.avgPrice)} → <Flash value={cur}>{cents(cur)}</Flash></small>
      </span>
      <Trail values={trail} up={pnl >= 0} />
      <span className="np-pnl">
        <Flash value={pnl}><b className={pnl >= 0 ? 'yes-accent' : 'no-color'}>{signedUsd(pnl)}</b></Flash>
        <small className="muted">{usd(value)}</small>
      </span>
    </button>
  )
}

function PerpRow({ p: raw }: { p: PerpPosition }) {
  const mark = usePerpMark(raw.symbol)
  const p = remark(raw, mark?.price)
  const trail = useTrail(p.pnl)
  // 0 at entry, 1 at liquidation
  const risk = Math.max(0, Math.min(1, Math.abs(p.markPrice - p.entryPrice) / Math.max(1e-9, Math.abs(p.liquidationPrice - p.entryPrice))))
  const losing = p.side === 'long' ? p.markPrice < p.entryPrice : p.markPrice > p.entryPrice
  return (
    <button className="np-row" onClick={() => navigate(`/perps/${p.symbol}`)}>
      <Img src={p.icon} size={34} radius={17} />
      <span className="np-main">
        <b>{p.symbol} <span className={`perp-badge ${p.side}`}>{p.side === 'long' ? 'Long' : 'Short'} {p.leverage}x</span></b>
        <small>Mark <Flash value={p.markPrice}>{fmtPrice(p.markPrice)}</Flash> · liq {fmtPrice(p.liquidationPrice)}</small>
        <span className="np-risk" title="Distance to liquidation"><i style={{ width: `${losing ? risk * 100 : 0}%` }} className={risk > 0.7 && losing ? 'hot' : ''} /></span>
      </span>
      <Trail values={trail} up={p.pnl >= 0} />
      <span className="np-pnl">
        <Flash value={p.pnl}><b className={p.pnl >= 0 ? 'yes-accent' : 'no-color'}>{signedUsd(p.pnl)}</b></Flash>
        <small className={p.pnl >= 0 ? 'yes-accent' : 'no-color'}>{fmtPct(p.pnlPct, 1)}</small>
      </span>
    </button>
  )
}

/* ---------------- bell + panel ---------------- */

export function NotificationBell() {
  const { user, leagueId, league, portfolio } = useApp()
  const { notes, unread, open, setOpen, clear } = useNotes()
  const [tab, setTab] = useState<'positions' | 'alerts'>('positions')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open, setOpen])
  if (!user || !leagueId) return null
  const preds = portfolio?.positions ?? []
  const perps = (portfolio?.perps ?? []).filter((p) => p.status === 'open')
  const count = preds.length + perps.length
  const mirror = league?.mode !== 'exchange'
  return (
    <div className="np" ref={box}>
      <button className={`icon-btn np-bell ${unread ? 'ring' : ''}`} aria-label={`Notifications${unread ? `, ${unread} new` : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="bell" />
        {unread > 0 && <span className="np-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="np-panel" role="dialog" aria-label="Live positions and alerts">
          <div className="np-head">
            <span className="np-live"><i />Live</span>
            <span className="grow" />
            {portfolio && (
              <span className="np-total">
                <small>Total P&amp;L</small>
                <b className={portfolio.pnl >= 0 ? 'yes-accent' : 'no-color'}><AnimatedNumber value={portfolio.pnl} format={signedUsd} /></b>
              </span>
            )}
          </div>
          <div className="text-tabs np-tabs">
            <button className={tab === 'positions' ? 'active' : ''} onClick={() => setTab('positions')}>Positions ({count})</button>
            <button className={tab === 'alerts' ? 'active' : ''} onClick={() => setTab('alerts')}>Alerts{notes.length ? ` (${notes.length})` : ''}</button>
          </div>
          <div className="np-body">
            {tab === 'positions' ? (
              count ? (
                <>
                  {perps.map((p) => <PerpRow key={p.id} p={p} />)}
                  {preds.map((p) => <PredictionRow key={p.marketId + p.outcome} p={p} live={mirror} />)}
                </>
              ) : <p className="np-empty">No open positions. Trades you make show up here and update live.</p>
            ) : notes.length ? (
              notes.map((n) => (
                <button key={n.id} className={`np-note ${n.tone}`} onClick={() => { if (n.href) { setOpen(false); navigate(n.href) } }}>
                  <i />
                  <span className="np-main"><b>{n.title}</b>{n.body && <small>{n.body}</small>}</span>
                  <time className="muted">{timeAgo(n.ts)}</time>
                </button>
              ))
            ) : <p className="np-empty">Fills, take-profits, stop-outs, liquidations, resolutions and big moves on your positions appear here.</p>}
          </div>
          <div className="np-foot">
            {tab === 'alerts' && notes.length > 0 && <button className="link-btn" onClick={clear}>Clear alerts</button>}
            <span className="grow" />
            <button className="link-btn" onClick={() => { setOpen(false); navigate('/portfolio') }}>Portfolio →</button>
          </div>
        </div>
      )}
    </div>
  )
}
