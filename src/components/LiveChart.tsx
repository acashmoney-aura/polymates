import { useEffect, useId, useRef, useState } from 'react'
import { reducedMotion } from './Motion'
import { useWidth } from './QuantCharts'

/* A price chart that keeps moving: each pushed mark appends a point, and the line, its end dot, the y-axis
   and the price tag glide to it instead of jumping. History t is in unix seconds; `live.at` in ms. */

interface Pt { t: number; p: number }
interface Frame { t: number; p: number; lo: number; hi: number }

const UP = '#53e67f'
const DOWN = '#ff7767'
const ease = (k: number) => 1 - Math.pow(1 - k, 3)

export function LiveChart({ points, live, rangeKey, height = 300, format }: {
  points: Pt[]
  live: { price: number; prev: number | null; at: number } | null
  /** changing it (e.g. the selected range) drops the ticks collected so far */
  rangeKey: string
  height?: number
  format: (v: number) => string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const gid = useId().replace(/:/g, '')
  const [ticks, setTicks] = useState<Pt[]>([])
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => { setTicks([]) }, [rangeKey])
  useEffect(() => {
    if (!live) return
    setTicks((ts) => [...ts.slice(-900), { t: live.at / 1000, p: live.price }])
  }, [live?.at, live?.price]) // eslint-disable-line react-hooks/exhaustive-deps

  // history, then the ticks that arrived after it, keeping the window the range asked for
  const lastHist = points.length ? points[points.length - 1].t : 0
  const span = points.length > 1 ? lastHist - points[0].t : 3600
  const merged = [...points, ...ticks.filter((x) => x.t > lastHist)]
  const endT = merged.length ? merged[merged.length - 1].t : 0
  const series = merged.filter((x) => x.t >= endT - span)

  const vals = series.map((x) => x.p)
  let lo = vals.length ? Math.min(...vals) : 0
  let hi = vals.length ? Math.max(...vals) : 1
  if (hi - lo < hi * 1e-6) { hi += hi * 0.001 + 1e-9; lo -= lo * 0.001 + 1e-9 }
  const pad = (hi - lo) * 0.1
  lo -= pad
  hi += pad
  const last = series[series.length - 1] ?? { t: 0, p: 0 }
  const target: Frame = { t: last.t, p: last.p, lo, hi }

  // tween the end point and the y-domain to each new target
  const cur = useRef<Frame>(target)
  const [, redraw] = useState(0)
  useEffect(() => {
    const from = { ...cur.current }
    if (!from.t) { cur.current = target; redraw((x) => x + 1); return }
    const dur = reducedMotion() ? 0 : 700
    let raf = 0
    let start: number | null = null
    const step = (now: number) => {
      start ??= now
      const k = dur ? ease(Math.min(1, (now - start) / dur)) : 1
      cur.current = {
        t: from.t + (target.t - from.t) * k, p: from.p + (target.p - from.p) * k,
        lo: from.lo + (target.lo - from.lo) * k, hi: from.hi + (target.hi - from.hi) * k,
      }
      redraw((x) => x + 1)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    // background tabs pause animation frames; land on the target anyway so nothing shows a stale price
    const snap = setTimeout(() => { cur.current = target; redraw((x) => x + 1) }, dur + 100)
    return () => { cancelAnimationFrame(raf); clearTimeout(snap) }
  }, [target.t, target.p, target.lo, target.hi]) // eslint-disable-line react-hooks/exhaustive-deps

  if (series.length < 2) return <div className="chart chart-empty" style={{ height }}>Waiting for prices…</div>

  const f = cur.current
  const padR = 84, padT = 12, padB = 26
  const iw = Math.max(10, width - padR), ih = height - padT - padB
  const t0 = Math.max(series[0].t, f.t - span)
  const x = (t: number) => ((t - t0) / Math.max(1e-6, f.t - t0)) * iw
  const y = (v: number) => padT + (1 - (v - f.lo) / Math.max(1e-12, f.hi - f.lo)) * ih
  // every point but the last is fixed; the last one rides the tween
  const pts = [...series.slice(0, -1).filter((s) => s.t < f.t), { t: f.t, p: f.p }]
  const d = pts.map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s.p).toFixed(1)}`).join('')
  const color = f.p >= series[0].p ? UP : DOWN
  const tickUp = live?.prev == null ? f.p >= series[0].p : live.price >= live.prev
  const ticksY = Array.from({ length: 5 }, (_, i) => f.lo + ((f.hi - f.lo) * (i + 0.5)) / 5)
  const fmtT = (s: number) => new Date(s * 1000).toLocaleTimeString('en-US', span <= 6 * 3600 ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric' })
  const ex = x(f.t), ey = y(f.p)
  const hp = hover !== null ? pts[hover] : null

  return (
    <div className="chart live-chart" ref={ref} style={{ height }} onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const tx = t0 + ((e.clientX - r.left) / iw) * (f.t - t0)
        let best = 0
        pts.forEach((s, i) => { if (Math.abs(s.t - tx) < Math.abs(pts[best].t - tx)) best = i })
        setHover(e.clientX - r.left <= iw ? best : null)
      }}>
      <span className="live-badge"><i />Live</span>
      <svg width={width} height={height}>
        <defs>
          <linearGradient id={`${gid}a`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticksY.map((v) => (
          <g key={v.toFixed(8)}>
            <line x1={0} x2={iw} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeDasharray="1 3" />
            <text x={width - 4} y={y(v) + 4} textAnchor="end" className="axis">{format(v)}</text>
          </g>
        ))}
        {[0.08, 0.5, 0.92].map((k) => (
          <text key={k} x={k * iw} y={height - 6} textAnchor="middle" className="axis">{fmtT(t0 + k * (f.t - t0))}</text>
        ))}
        <path d={`${d}L${ex},${padT + ih}L0,${padT + ih}Z`} fill={`url(#${gid}a)`} />
        <path d={d} fill="none" stroke={color} strokeWidth={2.25} strokeLinejoin="round" />
        <line x1={0} x2={iw} y1={ey} y2={ey} stroke={color} strokeOpacity={0.5} strokeDasharray="3 4" />
        <circle cx={ex} cy={ey} r={9} fill={color} className="live-ping" key={live?.at ?? 0} />
        <circle cx={ex} cy={ey} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
        <g transform={`translate(${iw + 6},${Math.max(padT, Math.min(padT + ih - 22, ey - 11))})`} className={`live-tag ${tickUp ? 'up' : 'down'}`} key={`tag${live?.at ?? 0}`}>
          <rect width={padR - 10} height={22} rx={5} />
          <text x={(padR - 10) / 2} y={15} textAnchor="middle">{format(f.p)}</text>
        </g>
        {hp && <line x1={x(hp.t)} x2={x(hp.t)} y1={padT} y2={padT + ih} stroke="var(--text-3)" />}
        {hp && <circle cx={x(hp.t)} cy={y(hp.p)} r={4} fill={color} stroke="var(--bg)" strokeWidth={2} />}
      </svg>
      {hp && (
        <div className="chart-tip" style={{ left: Math.min(x(hp.t) + 12, width - 180) }}>
          <div className="tip-date">{new Date(hp.t * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}</div>
          <b>{format(hp.p)}</b>
        </div>
      )}
    </div>
  )
}
