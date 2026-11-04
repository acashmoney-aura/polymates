import { useEffect, useRef, useState } from 'react'
import { api, pct, type PMEvent } from '../api'
import { Link } from '../router'

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Tweens to the new value whenever it changes (ease-out cubic). */
export function AnimatedNumber({ value, format, duration = 650 }: { value: number; format: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const raf = useRef(0)
  useEffect(() => {
    if (reducedMotion() || !Number.isFinite(value)) { setShown(value); from.current = value; return }
    const start = performance.now()
    const a = Number.isFinite(from.current) ? from.current : value
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / duration)
      const e = 1 - (1 - k) ** 3
      setShown(a + (value - a) * e)
      if (k < 1) raf.current = requestAnimationFrame(tick)
      else from.current = value
    }
    raf.current = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf.current); from.current = value }
  }, [value, duration])
  return <span className="tabular">{format(shown)}</span>
}

/** Returns 'flash-up' / 'flash-down' for ~0.9s after the value changes. */
export function useFlash(value: number | null | undefined) {
  const prev = useRef(value)
  const [cls, setCls] = useState('')
  useEffect(() => {
    if (prev.current !== undefined && prev.current !== null && value !== null && value !== undefined && value !== prev.current) {
      setCls(value > prev.current ? 'flash-up' : 'flash-down')
      const t = setTimeout(() => setCls(''), 900)
      prev.current = value
      return () => clearTimeout(t)
    }
    prev.current = value
  }, [value])
  return cls
}

export function Flash({ value, children, className = '' }: { value: number; children: React.ReactNode; className?: string }) {
  const f = useFlash(value)
  return <span className={`${className} ${f}`}>{children}</span>
}

/* ---------------- confetti ---------------- */

const COLORS = ['#3262ff', '#53e67f', '#fdc503', '#ff5952', '#9b51e0', '#0093fd']

/** Fire a small confetti burst from a screen point (or the center). */
export function burst(x = window.innerWidth / 2, y = window.innerHeight / 2, n = 28) {
  if (reducedMotion()) return
  const root = document.createElement('div')
  root.className = 'confetti'
  root.style.left = `${x}px`
  root.style.top = `${y}px`
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i')
    const angle = (Math.PI * 2 * i) / n + Math.random() * 0.4
    const dist = 60 + Math.random() * 90
    s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`)
    s.style.setProperty('--dy', `${Math.sin(angle) * dist - 40}px`)
    s.style.setProperty('--r', `${Math.random() * 720 - 360}deg`)
    s.style.background = COLORS[i % COLORS.length]
    s.style.animationDelay = `${Math.random() * 60}ms`
    root.appendChild(s)
  }
  document.body.appendChild(root)
  setTimeout(() => root.remove(), 1200)
}

/* ---------------- ticker tape ---------------- */

export function LiveTicker() {
  const [items, setItems] = useState<{ slug: string; title: string; price: number; change: number }[]>([])
  useEffect(() => {
    const load = () => api<{ events: PMEvent[] }>('/api/events?tag=breaking&limit=24&compact=1').then((d) => {
      setItems(d.events.flatMap((e) => {
        const m = [...e.markets].filter((x) => x.active).sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))[0]
        return m ? [{ slug: e.slug, title: e.negRisk && e.markets.length > 1 ? m.title : e.title, price: m.price, change: m.change24h ?? 0 }] : []
      }))
    }).catch(() => {})
    void load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])
  if (!items.length) return null
  const row = items.map((i) => (
    <Link key={i.slug + i.title} to={`/event/${i.slug}`} className="tick">
      <span className="ellipsis">{i.title}</span>
      <b>{pct(i.price)}</b>
      <em className={i.change >= 0 ? 'yes-accent' : 'no-color'}>{i.change >= 0 ? '▲' : '▼'}{Math.abs(Math.round(i.change * 100))}</em>
    </Link>
  ))
  return (
    <div className="ticker" aria-label="Biggest movers">
      <span className="ticker-live"><i />LIVE</span>
      <div className="ticker-track"><div className="ticker-inner">{row}{row}</div></div>
    </div>
  )
}
