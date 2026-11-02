import { useEffect, useState, type ReactNode } from 'react'
import { api, compactUsd, pct, type Market, type PMEvent, type User } from '../api'
import { Icon } from '../icons'
import { Link, navigate } from '../router'
import { useApp } from '../store'
import { Flash } from './Motion'
import { useLiveQuote } from '../live'

export function Avatar({ user, size = 32 }: { user: Pick<User, 'displayName' | 'avatarHue' | 'avatarUrl'> | null; size?: number }) {
  const hue = user?.avatarHue ?? 220
  if (user?.avatarUrl) return <img className="avatar" src={user.avatarUrl} alt="" width={size} height={size} referrerPolicy="no-referrer" style={{ width: size, height: size, objectFit: 'cover' }} />
  return (
    <span className="avatar" style={{
      width: size, height: size, fontSize: size * 0.42,
      background: `linear-gradient(135deg, hsl(${hue} 85% 60%), hsl(${(hue + 60) % 360} 80% 45%))`,
    }}>
      {(user?.displayName ?? '?').slice(0, 1).toUpperCase()}
    </span>
  )
}

export function Img({ src, size, radius = 7.2, alt = '' }: { src: string; size: number; radius?: number; alt?: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <span className="img-fallback" style={{ width: size, height: size, borderRadius: radius }} />
  return <img className="img" src={src} alt={alt} width={size} height={size} style={{ borderRadius: radius }} loading="lazy" onError={() => setFailed(true)} />
}

/** Polymarket-style semicircle "chance" gauge */
export function Gauge({ p }: { p: number }) {
  const r = 24
  const len = Math.PI * r
  const color = p >= 0.5 ? 'var(--yes-accent)' : p < 0.2 ? 'var(--no)' : p < 0.5 ? 'var(--warn)' : 'var(--text-3)'
  return (
    <div className="gauge">
      <svg width="58" height="34" viewBox="0 0 58 34">
        <path d={`M5 30 A${r} ${r} 0 0 1 53 30`} fill="none" stroke="var(--gauge-track)" strokeWidth="4.5" strokeLinecap="round" />
        <path d={`M5 30 A${r} ${r} 0 0 1 53 30`} fill="none" stroke={color} strokeWidth="4.5" strokeLinecap="round"
          strokeDasharray={`${Math.max(0.001, p) * len} ${len}`} className="gauge-fill" />
      </svg>
      <div className="gauge-text"><b><Flash value={Math.round(p * 100)}>{pct(p)}</Flash></b><span>chance</span></div>
    </div>
  )
}

export function Modal({ onClose, children, className = '' }: { onClose: () => void; children: ReactNode; className?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${className}`} role="dialog" aria-modal="true">
        <button className="icon-btn dialog-close" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        {children}
      </div>
    </div>
  )
}

export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])
  return (
    <div className="overlay sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-handle" />
        {children}
      </div>
    </div>
  )
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  )
}

export function ModeBadge({ mode }: { mode: 'mirror' | 'exchange' }) {
  return <span className={`mode-badge ${mode}`}>{mode === 'mirror' ? 'Mirror' : 'Exchange'}</span>
}

/* ---------------- market card ---------------- */

/** A market's price with live Polymarket ticks applied (not in exchange leagues, which price off their own book). */
export function useLivePrice(m: Market | undefined) {
  const { league } = useApp()
  const q = useLiveQuote(m?.id, !!m && league?.mode !== 'exchange')
  return q?.price ?? m?.price ?? 0
}

function LiveGauge({ m }: { m: Market }) {
  return <Gauge p={useLivePrice(m)} />
}

function LiveRow({ m, quick }: { m: Market; quick: (m: Market, o: 'yes' | 'no') => (e: React.MouseEvent) => void }) {
  const p = useLivePrice(m)
  return (
    <div className="mc-row">
      <span className="mc-name">{m.title}</span>
      <Flash value={Math.round(p * 100)} className="mc-pct">{pct(p)}</Flash>
      <button className="mini-yes" onClick={quick(m, 'yes')}><span>Yes</span><span>{pct(p)}</span></button>
      <button className="mini-no" onClick={quick(m, 'no')}><span>No</span><span>{pct(1 - p)}</span></button>
    </div>
  )
}

export function MarketCard({ event, index = 0, metric }: { event: PMEvent; index?: number; metric?: string | null }) {
  const { user, openAuth, openSheet } = useApp()
  const markets = event.markets.filter((m) => m.active && m.enabled)
  const isBinary = event.markets.length === 1
  // negRisk events (one winner) read best sorted by chance; other groups (game lines,
  // dates) keep Polymarket's own order. Either way skip lines that are already decided.
  const live = markets.filter((m) => m.price > 0.005 && m.price < 0.995)
  const pool = live.length ? live : markets
  const top = isBinary ? markets : (event.negRisk ? [...pool].sort((a, b) => b.price - a.price) : pool).slice(0, 2)
  const href = `/event/${event.slug}`
  const quick = (m: Market, outcome: 'yes' | 'no') => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!user) return openAuth('signup')
    if (window.matchMedia('(max-width: 1023px)').matches) openSheet({ eventSlug: event.slug, marketId: m.id, outcome })
    else navigate(`${href}?m=${m.id}&o=${outcome}`)
  }
  const m0 = top[0]
  return (
    <Link to={href} className="card market-card" style={{ '--i': index % 24 } as React.CSSProperties}>
      <div className="mc-head">
        <Img src={event.icon || event.image} size={38} />
        <h3 className="mc-title">{event.title}</h3>
        {isBinary && m0 && <LiveGauge m={m0} />}
      </div>
      {isBinary && m0 ? (
        <div className="mc-binary">
          <button className="btn-yes" onClick={quick(m0, 'yes')}>{m0.outcomes[0]}</button>
          <button className="btn-no" onClick={quick(m0, 'no')}>{m0.outcomes[1]}</button>
        </div>
      ) : (
        <div className="mc-rows">
          {top.map((m) => <LiveRow key={m.id} m={m} quick={quick} />)}
        </div>
      )}
      <div className="mc-foot">
        {metric ? <span className="mc-metric ellipsis">{metric}</span> : <span>{compactUsd(event.volume)} Vol.</span>}
        {event.markets.some((m) => m.leagueVolume > 0) && (
          <span className="league-vol">· {compactUsd(event.markets.reduce((s, m) => s + m.leagueVolume, 0))} league</span>
        )}
        <span className="grow" />
        <span className="round-btn" aria-hidden><Icon name="bookmark" size={16} /></span>
      </div>
    </Link>
  )
}

export function CardSkeleton() {
  return <div className="card market-card skeleton" />
}

export function useEvents(params: string, deps: unknown[] = []) {
  const [data, setData] = useState<{ total: number; events: PMEvent[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setError(null)
    api<{ total: number; events: PMEvent[] }>(`/api/events${params}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, ...deps])
  return { data, error, setData }
}
