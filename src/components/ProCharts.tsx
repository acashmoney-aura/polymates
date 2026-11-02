import { useId, useState } from 'react'
import { useWidth } from './QuantCharts'

/* Terminal-style charts for the quant views. All SVG, theme tokens, hover readouts. */

const GREEN = '#00ae4b'
const RED = '#ff5952'
const BLUE = '#0093fd'

export type Level = { price: number; size: number }

const c = (p: number) => `${(p * 100).toFixed(p * 100 < 1 || p * 100 > 99 ? 1 : 0)}¢`
const compact = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0))

/**
 * Cumulative depth: bids step down to the left of mid, asks step up to the right.
 * `unit` picks shares or dollar notional on the y axis.
 */
export function DepthChart({ bids, asks, height = 220, unit = 'usd' }: { bids: Level[]; asks: Level[]; height?: number; unit?: 'usd' | 'shares' }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const gid = useId().replace(/:/g, '')
  const bb = bids[0]?.price, ba = asks[0]?.price
  if (bb === undefined && ba === undefined) return <div className="chart chart-empty" style={{ height }} ref={ref}>Empty book</div>
  const mid = bb !== undefined && ba !== undefined ? (bb + ba) / 2 : (bb ?? ba)!
  const amt = (l: Level) => (unit === 'usd' ? l.size * l.price : l.size)
  // window: wide enough to show ~25 levels a side, at least ±4¢, inside 0..1
  const far = (ls: Level[]) => Math.abs((ls[Math.min(ls.length - 1, 24)]?.price ?? mid) - mid)
  const w = Math.min(0.5, Math.max(0.04, far(bids), far(asks)))
  const lo = Math.max(0, mid - w), hi = Math.min(1, mid + w)
  const inB = bids.filter((l) => l.price >= lo), inA = asks.filter((l) => l.price <= hi)
  let acc = 0
  const cb = inB.map((l) => ({ price: l.price, cum: (acc += amt(l)) }))
  acc = 0
  const ca = inA.map((l) => ({ price: l.price, cum: (acc += amt(l)) }))
  const ymax = Math.max(1, cb[cb.length - 1]?.cum ?? 0, ca[ca.length - 1]?.cum ?? 0) * 1.08
  const padB = 22, padT = 8, padR = 48
  const iw = Math.max(10, width - padR), ih = height - padT - padB
  const x = (p: number) => ((p - lo) / (hi - lo || 1)) * iw
  const y = (v: number) => padT + (1 - v / ymax) * ih
  const base = padT + ih
  // stepped paths: each level holds its cumulative size until the next price
  const bidPath = cb.length ? `M${x(cb[0].price)},${base}` + cb.map((p, i) => `L${x(p.price)},${y(p.cum)}` + (cb[i + 1] ? `L${x(cb[i + 1].price)},${y(p.cum)}` : `L${x(lo)},${y(p.cum)}`)).join('') + `L${x(lo)},${base}Z` : ''
  const askPath = ca.length ? `M${x(ca[0].price)},${base}` + ca.map((p, i) => `L${x(p.price)},${y(p.cum)}` + (ca[i + 1] ? `L${x(ca[i + 1].price)},${y(p.cum)}` : `L${x(hi)},${y(p.cum)}`)).join('') + `L${x(hi)},${base}Z` : ''
  const line = (d: string) => d.replace(/Z$/, '')
  const at = hover === null ? null : lo + (hover / iw) * (hi - lo)
  const readout = at === null ? null : at <= mid
    ? (() => { const lv = [...cb].reverse().find((p) => p.price >= at - 1e-9) ?? null; return lv && { side: 'bid' as const, ...lv } })()
    : (() => { const lv = [...ca].reverse().find((p) => p.price <= at + 1e-9) ?? null; return lv && { side: 'ask' as const, ...lv } })()
  const ticks = Array.from({ length: 4 }, (_, i) => (ymax / 1.08) * ((i + 1) / 4))
  // price ticks in priority order, dropping any that would collide with one already placed
  const xt: number[] = []
  for (const p of [mid, lo, hi, mid - w / 2, mid + w / 2]) {
    if (p >= lo && p <= hi && xt.every((q) => Math.abs(x(q) - x(p)) > 46)) xt.push(p)
  }
  return (
    <div className="chart depth" ref={ref} onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const px = e.clientX - r.left; setHover(px >= 0 && px <= iw ? px : null) }}>
      <svg width={width} height={height}>
        <defs>
          <linearGradient id={`${gid}b`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={GREEN} stopOpacity="0.45" /><stop offset="100%" stopColor={GREEN} stopOpacity="0.05" /></linearGradient>
          <linearGradient id={`${gid}a`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={RED} stopOpacity="0.45" /><stop offset="100%" stopColor={RED} stopOpacity="0.05" /></linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={0} x2={iw} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeDasharray="1 3" opacity={0.6} />
            <text x={width - 4} y={y(v) + 4} textAnchor="end" className="axis mono-axis">{unit === 'usd' ? `$${compact(v)}` : compact(v)}</text>
          </g>
        ))}
        {xt.map((p) => <text key={p} x={x(p)} y={height - 6} textAnchor={p === lo ? 'start' : p === hi ? 'end' : 'middle'} className="axis mono-axis">{c(p)}</text>)}
        <path d={bidPath} fill={`url(#${gid}b)`} className="area-in" />
        <path d={askPath} fill={`url(#${gid}a)`} className="area-in" />
        <path d={line(bidPath)} fill="none" stroke={GREEN} strokeWidth={1.75} strokeLinejoin="round" />
        <path d={line(askPath)} fill="none" stroke={RED} strokeWidth={1.75} strokeLinejoin="round" />
        <line x1={x(mid)} x2={x(mid)} y1={padT} y2={base} stroke="var(--text-4)" strokeDasharray="3 3" />
        {hover !== null && <line x1={hover} x2={hover} y1={padT} y2={base} stroke="var(--text-3)" />}
        {hover !== null && readout && <circle cx={hover} cy={y(readout.cum)} r={4} fill={readout.side === 'bid' ? GREEN : RED} stroke="var(--bg)" strokeWidth={2} />}
      </svg>
      {hover !== null && at !== null && (
        <div className="chart-tip mono" style={{ left: Math.min(hover + 12, width - 180) }}>
          <div className="tip-date">{c(at)} · {at <= mid ? 'sell into bids' : 'buy from asks'}</div>
          {readout ? <>
            <div className="tip-row"><i style={{ background: readout.side === 'bid' ? GREEN : RED }} /> <span>cum {unit === 'usd' ? '$' : 'sh'}</span> <b>{unit === 'usd' ? `$${compact(readout.cum)}` : compact(readout.cum)}</b></div>
            <div className="tip-row"><span className="muted">slippage</span> <b>{c(Math.abs(readout.price - mid))}</b></div>
          </> : <div className="muted">no depth here</div>}
        </div>
      )}
    </div>
  )
}

/** Semicircle gauge for an imbalance in −1..+1 (red = sell pressure, green = buy pressure). */
export function ImbalanceGauge({ value, label, size = 168 }: { value: number | null; label: string; size?: number }) {
  const v = value === null || !Number.isFinite(value) ? 0 : Math.max(-1, Math.min(1, value))
  const r = size / 2 - 12, cx = size / 2, cy = size / 2 + 4
  const arc = (a0: number, a1: number) => {
    const p = (a: number) => [cx + r * Math.cos(Math.PI - a), cy - r * Math.sin(Math.PI - a)]
    const [x0, y0] = p(a0), [x1, y1] = p(a1)
    return `M${x0},${y0}A${r},${r} 0 0 1 ${x1},${y1}`
  }
  const angle = ((v + 1) / 2) * 180 - 90
  const tone = v > 0.15 ? 'yes-accent' : v < -0.15 ? 'no-color' : ''
  return (
    <div className="imb-gauge">
      <svg width={size} height={size / 2 + 18} viewBox={`0 0 ${size} ${size / 2 + 18}`}>
        <path d={arc(0, Math.PI)} fill="none" stroke="var(--gauge-track)" strokeWidth={10} strokeLinecap="round" />
        <path d={arc(0, Math.PI * 0.42)} fill="none" stroke={RED} strokeOpacity={0.55} strokeWidth={10} strokeLinecap="round" />
        <path d={arc(Math.PI * 0.58, Math.PI)} fill="none" stroke={GREEN} strokeOpacity={0.55} strokeWidth={10} strokeLinecap="round" />
        <g className="needle" style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
          <line x1={cx} y1={cy} x2={cx} y2={cy - r + 4} stroke="var(--text)" strokeWidth={2.5} strokeLinecap="round" />
        </g>
        <circle cx={cx} cy={cy} r={5} fill="var(--text)" />
      </svg>
      <b className={`mono ${tone}`}>{value === null || !Number.isFinite(value) ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`}</b>
      <span>{label}</span>
    </div>
  )
}

/** Diverging horizontal bars, one per row, for values in −1..+1. */
export function DivergingBars({ rows }: { rows: { label: string; value: number | null; hint?: string }[] }) {
  return (
    <div className="dbars">
      {rows.map((r) => {
        const v = r.value === null || !Number.isFinite(r.value) ? 0 : Math.max(-1, Math.min(1, r.value))
        return (
          <div key={r.label} className="dbar" title={r.hint}>
            <span>{r.label}</span>
            <div className="dbar-track">
              <i className={v >= 0 ? 'pos' : 'neg'} style={{ width: `${Math.abs(v) * 50}%`, [v >= 0 ? 'left' : 'right']: '50%' }} />
            </div>
            <b className={`mono ${v > 0.15 ? 'yes-accent' : v < -0.15 ? 'no-color' : ''}`}>{r.value === null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`}</b>
          </div>
        )
      })}
    </div>
  )
}

export function Sparkline({ values, width = 96, height = 28, color }: { values: (number | null)[]; width?: number; height?: number; color?: string }) {
  const vs = values.filter((v): v is number => v !== null && Number.isFinite(v))
  if (vs.length < 2) return <svg width={width} height={height} />
  const lo = Math.min(...vs), hi = Math.max(...vs)
  const span = hi - lo || 1
  const pts = vs.map((v, i) => `${((i / (vs.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - lo) / span) * (height - 4)).toFixed(1)}`).join(' ')
  const col = color ?? (vs[vs.length - 1] >= vs[0] ? GREEN : RED)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="spark">
      <polyline points={pts} fill="none" stroke={col} strokeWidth={1.5} strokeLinejoin="round" pathLength={1} className="draw-in" />
    </svg>
  )
}

export interface ConeRow { window: string; min: number | null; p10: number | null; p25: number | null; median: number | null; p75: number | null; p90: number | null; max: number | null; current: number | null; percentile: number | null }

/** Realized-vol cone: percentile bands per window with the current reading overlaid. */
export function VolCone({ rows, height = 260, format }: { rows: ConeRow[]; height?: number; format: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const ok = rows.filter((r) => r.median !== null)
  if (ok.length < 2) return <div className="chart chart-empty" style={{ height }} ref={ref}>Not enough history</div>
  const ymax = Math.max(...ok.map((r) => Math.max(r.p90 ?? 0, r.current ?? 0))) * 1.15 || 1
  const padL = 8, padR = 56, padT = 10, padB = 26
  const iw = Math.max(10, width - padL - padR), ih = height - padT - padB
  const x = (i: number) => padL + (ok.length > 1 ? (i / (ok.length - 1)) * iw : iw / 2)
  const y = (v: number) => padT + (1 - Math.min(v, ymax) / ymax) * ih
  const band = (a: keyof ConeRow, b: keyof ConeRow) =>
    ok.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(r[a] as number)}`).join('') + [...ok].reverse().map((r, i) => `L${x(ok.length - 1 - i)},${y(r[b] as number)}`).join('') + 'Z'
  const lineOf = (k: keyof ConeRow) => ok.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y((r[k] as number) ?? 0)}`).join('')
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => (ymax / 1.15) * f)
  const tone = (p: number | null) => (p === null ? 'var(--text-3)' : p > 0.8 ? RED : p < 0.2 ? GREEN : '#fdc503')
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.round(((e.clientX - r.left - padL) / iw) * (ok.length - 1)); setHover(i >= 0 && i < ok.length ? i : null) }}>
      <svg width={width} height={height}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={padL + iw} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeDasharray="1 3" opacity={0.6} />
            <text x={width - 4} y={y(v) + 4} textAnchor="end" className="axis mono-axis">{format(v)}</text>
          </g>
        ))}
        <path d={band('p10', 'p90')} fill={BLUE} opacity={0.14} className="area-in" />
        <path d={band('p25', 'p75')} fill={BLUE} opacity={0.26} className="area-in" />
        <path d={lineOf('max')} fill="none" stroke="var(--text-4)" strokeDasharray="2 4" />
        <path d={lineOf('min')} fill="none" stroke="var(--text-4)" strokeDasharray="2 4" />
        <path d={lineOf('median')} fill="none" stroke={BLUE} strokeWidth={1.5} strokeDasharray="5 4" />
        <path d={ok.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(r.current ?? 0)}`).join('')} fill="none" stroke="var(--text)" strokeWidth={2.25} pathLength={1} className="draw-in" />
        {ok.map((r, i) => (
          <g key={r.window}>
            <circle cx={x(i)} cy={y(r.current ?? 0)} r={hover === i ? 6 : 4.5} fill={tone(r.percentile)} stroke="var(--bg)" strokeWidth={2} className="dot-in" style={{ animationDelay: `${300 + i * 80}ms` }} />
            <text x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === ok.length - 1 ? 'end' : 'middle'} className="axis mono-axis">{r.window}</text>
          </g>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + ih} stroke="var(--text-3)" opacity={0.6} />}
      </svg>
      {hover !== null && (() => {
        const r = ok[hover]
        return (
          <div className="chart-tip mono" style={{ left: Math.min(x(hover) + 12, width - 190) }}>
            <div className="tip-date">{r.window} window · {r.percentile === null ? '—' : `${Math.round(r.percentile * 100)}th pct`}</div>
            <div className="tip-row"><i style={{ background: tone(r.percentile) }} /> <span>current</span> <b>{format(r.current ?? NaN)}</b></div>
            <div className="tip-row"><span className="muted">p90 / p75</span> <b>{format(r.p90 ?? NaN)} / {format(r.p75 ?? NaN)}</b></div>
            <div className="tip-row"><span className="muted">median</span> <b>{format(r.median ?? NaN)}</b></div>
            <div className="tip-row"><span className="muted">p25 / p10</span> <b>{format(r.p25 ?? NaN)} / {format(r.p10 ?? NaN)}</b></div>
            <div className="tip-row"><span className="muted">min / max</span> <b>{format(r.min ?? NaN)} / {format(r.max ?? NaN)}</b></div>
          </div>
        )
      })()}
    </div>
  )
}

export interface Rung { title: string; t: number; price: number; days: number | null; hazardPerDay: number | null; conditional: number | null; survival: number | null }

/** Term structure: implied probability vs. date on a true time axis, with per-interval hazard bars underneath. */
export function TermCurve({ rungs, kind, height = 260, onPick }: { rungs: Rung[]; kind: 'by' | 'through'; height?: number; onPick?: (i: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const gid = useId().replace(/:/g, '')
  const [now] = useState(() => Date.now())
  const t0 = Math.min(now, rungs[0]?.t ?? now), t1 = Math.max(...rungs.map((r) => r.t), now + 86400_000)
  const padL = 8, padR = 48, padT = 12, hazH = 54, gap = 18, padB = 22
  const iw = Math.max(10, width - padL - padR)
  const ih = height - padT - hazH - gap - padB
  const x = (t: number) => padL + ((t - t0) / (t1 - t0 || 1)) * iw
  const y = (p: number) => padT + (1 - p) * ih
  const hz = rungs.map((r) => r.hazardPerDay ?? 0)
  const hmax = Math.max(1e-4, ...hz)
  const hb = padT + ih + gap + hazH
  const start = kind === 'by' ? 0 : 1
  const pts = [{ t: now, p: start }, ...rungs.map((r) => ({ t: r.t, p: r.price }))]
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join('')
  const area = `${d}L${x(pts[pts.length - 1].t)},${y(0)}L${x(pts[0].t)},${y(0)}Z`
  const fmtD = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(t1 - t0 > 300 * 86400_000 ? { year: '2-digit' } : {}) })
  // date labels: last rung first, then left to right, skipping any that would collide
  const labelIdx: number[] = []
  for (const i of [rungs.length - 1, ...rungs.map((_, k) => k)]) {
    if (i >= 0 && !labelIdx.includes(i) && labelIdx.every((j) => Math.abs(x(rungs[j].t) - x(rungs[i].t)) > 56)) labelIdx.push(i)
  }
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const px = e.clientX - r.left
        let best = -1, bd = Infinity
        rungs.forEach((g, i) => { const dd = Math.abs(x(g.t) - px); if (dd < bd) { bd = dd; best = i } })
        setHover(best >= 0 && bd < 60 ? best : null)
      }}
      onClick={() => hover !== null && onPick?.(hover)}>
      <svg width={width} height={height}>
        <defs><linearGradient id={`${gid}t`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={BLUE} stopOpacity="0.3" /><stop offset="100%" stopColor={BLUE} stopOpacity="0" /></linearGradient></defs>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={padL} x2={padL + iw} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeDasharray="1 3" opacity={0.6} />
            <text x={width - 4} y={y(v) + 4} textAnchor="end" className="axis mono-axis">{Math.round(v * 100)}%</text>
          </g>
        ))}
        <line x1={x(now)} x2={x(now)} y1={padT} y2={hb} stroke="var(--text-4)" strokeDasharray="3 3" />
        {rungs[0] && x(rungs[0].t) - x(now) > 34 && <text x={x(now) + 4} y={padT + ih - 4} className="axis mono-axis">now</text>}
        <path d={area} fill={`url(#${gid}t)`} className="area-in" />
        <path d={d} fill="none" stroke={BLUE} strokeWidth={2.25} strokeLinejoin="round" pathLength={1} className="draw-in" />
        {rungs.map((r, i) => {
          const prevT = i ? rungs[i - 1].t : now
          const bw = Math.max(3, x(r.t) - x(prevT) - 3)
          const h = (hz[i] / hmax) * hazH
          return (
            <g key={i}>
              <rect x={x(r.t) - bw} y={hb - h} width={bw} height={h} rx={2} fill={hover === i ? '#fdc503' : '#fdc50399'} className="bar-in" style={{ animationDelay: `${i * 40}ms` }} />
              <circle cx={x(r.t)} cy={y(r.price)} r={hover === i ? 6 : 4} fill={BLUE} stroke="var(--bg)" strokeWidth={2} className="dot-in" style={{ animationDelay: `${300 + i * 40}ms` }} />
            </g>
          )
        })}
        <text x={padL} y={padT + ih + gap - 4} className="axis">implied hazard / day · peak {(hmax * 100).toFixed(2)}%</text>
        {labelIdx.map((i) => <text key={i} x={x(rungs[i].t)} y={height - 6} textAnchor={i === rungs.length - 1 ? 'end' : 'middle'} className="axis mono-axis">{fmtD(rungs[i].t)}</text>)}
        {hover !== null && <line x1={x(rungs[hover].t)} x2={x(rungs[hover].t)} y1={padT} y2={hb} stroke="var(--text-3)" opacity={0.6} />}
      </svg>
      {hover !== null && (() => {
        const r = rungs[hover]
        return (
          <div className="chart-tip mono" style={{ left: Math.min(x(r.t) + 12, width - 200) }}>
            <div className="tip-date">{r.title}</div>
            <div className="tip-row"><i style={{ background: BLUE }} /> <span>implied</span> <b>{(r.price * 100).toFixed(1)}%</b></div>
            <div className="tip-row"><i style={{ background: '#fdc503' }} /> <span>in window</span> <b>{r.conditional === null ? '—' : `${(r.conditional * 100).toFixed(1)}%`}</b></div>
            <div className="tip-row"><span className="muted">hazard / day</span> <b>{r.hazardPerDay === null ? '—' : `${(r.hazardPerDay * 100).toFixed(2)}%`}</b></div>
            <div className="tip-row"><span className="muted">days out</span> <b>{r.days === null ? '—' : r.days.toFixed(1)}</b></div>
          </div>
        )
      })()}
    </div>
  )
}

/** Histogram with hover, a zero line and a mean marker. Values in any unit. */
export function Histogram({ values, bins = 24, height = 160, format }: { values: number[]; bins?: number; height?: number; format: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  if (!values.length) return <div className="chart chart-empty" style={{ height }} ref={ref}>No closed trades</div>
  let lo = Math.min(...values, 0), hi = Math.max(...values, 0)
  if (hi - lo < 1e-9) { lo -= 1; hi += 1 }
  const bw = (hi - lo) / bins
  const counts = Array.from({ length: bins }, (_, i) => ({ a: lo + i * bw, b: lo + (i + 1) * bw, n: 0 }))
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - lo) / bw))].n++
  const max = Math.max(...counts.map((b) => b.n))
  const padB = 22, padT = 8
  const ih = height - padT - padB
  const x = (v: number) => ((v - lo) / (hi - lo)) * width
  const m = values.reduce((a, b) => a + b, 0) / values.length
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height}>
        {counts.map((b, i) => {
          const h = (b.n / max) * ih
          return <rect key={i} x={x(b.a) + 1} y={padT + ih - h} width={Math.max(1, x(b.b) - x(b.a) - 2)} height={h} rx={2}
            fill={b.b <= 0 ? RED : b.a >= 0 ? GREEN : '#7d8189'} opacity={hover === null || hover === i ? 0.9 : 0.45}
            className="bar-in" style={{ animationDelay: `${i * 18}ms` }} onMouseEnter={() => setHover(i)} />
        })}
        <line x1={x(0)} x2={x(0)} y1={padT} y2={padT + ih} stroke="var(--text-3)" />
        <line x1={x(m)} x2={x(m)} y1={padT} y2={padT + ih} stroke="#fdc503" strokeDasharray="3 3" />
        <text x={0} y={height - 6} className="axis mono-axis">{format(lo)}</text>
        <text x={x(m)} y={height - 6} textAnchor="middle" className="axis mono-axis" fill="#fdc503">μ {format(m)}</text>
        <text x={width} y={height - 6} textAnchor="end" className="axis mono-axis">{format(hi)}</text>
      </svg>
      {hover !== null && (
        <div className="chart-tip mono" style={{ left: Math.min(x(counts[hover].a) + 12, width - 170) }}>
          <div className="tip-date">{format(counts[hover].a)} … {format(counts[hover].b)}</div>
          <div className="tip-row"><span>trades</span> <b>{counts[hover].n}</b></div>
        </div>
      )}
    </div>
  )
}

/** Diverging color for returns: red → neutral → green, saturating at ±`scale`. */
export function retColor(r: number | null, scale: number) {
  if (r === null || !Number.isFinite(r)) return 'var(--surface-3)'
  const a = Math.min(1, Math.abs(r) / (scale || 1))
  return r >= 0 ? `rgba(0, 174, 75, ${0.12 + a * 0.78})` : `rgba(255, 89, 82, ${0.12 + a * 0.78})`
}

/** Calendar-style grid of period returns with a row total column. */
export function ReturnsGrid({ rows, cols, cells, totals, format }: {
  rows: string[]; cols: string[]; cells: (number | null)[][]; totals: (number | null)[]; format: (v: number) => string
}) {
  const flat = cells.flat().filter((v): v is number => v !== null && Number.isFinite(v))
  const scale = Math.max(1e-6, ...flat.map(Math.abs))
  return (
    <div className="rgrid-wrap">
      <div className="rgrid" style={{ gridTemplateColumns: `minmax(52px, auto) repeat(${cols.length}, minmax(26px, 1fr)) minmax(44px, auto)`, minWidth: cols.length * 28 + 100 }}>
        <span />
        {cols.map((c, j) => <span key={j} className="rg-col">{c}</span>)}
        <span className="rg-col">Σ</span>
        {rows.map((r, i) => (
          <div key={r} style={{ display: 'contents' }}>
            <span className="rg-row">{r}</span>
            {cells[i].map((v, j) => (
              <span key={j} className="rg-cell" style={{ background: retColor(v, scale), animationDelay: `${(i * cols.length + j) * 6}ms` }}
                title={v === null ? `${r} ${cols[j]}: no data` : `${r} ${cols[j]}: ${format(v)}`}>
                {v === null ? '' : format(v)}
              </span>
            ))}
            <span className={`rg-total mono ${(totals[i] ?? 0) >= 0 ? 'yes-accent' : 'no-color'}`}>{totals[i] === null ? '—' : format(totals[i]!)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
