import { useEffect, useId, useRef, useState } from 'react'

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

export interface LineSeries { name: string; color: string; values: (number | null)[]; area?: boolean; dashed?: boolean }

/** General-purpose time series chart with auto-scaled y axis, area gradient and hover readout. */
export function LineChart({ t, series, height = 220, format = (v) => v.toFixed(2), zero = false, yMin, yMax, formatTime }: {
  t: number[]
  /** x-axis label for a unix-seconds timestamp; default is hour of day (or date for long spans) */
  formatTime?: (s: number) => string
  series: LineSeries[]
  height?: number
  format?: (v: number) => string
  zero?: boolean
  yMin?: number
  yMax?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const gid = useId().replace(/:/g, '')
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)))
  let lo = yMin ?? Math.min(...vals, zero ? 0 : Infinity)
  let hi = yMax ?? Math.max(...vals, zero ? 0 : -Infinity)
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1 }
  if (hi - lo < 1e-9) { hi += 1; lo -= 1 }
  const pad = (hi - lo) * 0.08
  if (yMin === undefined) lo -= pad
  if (yMax === undefined) hi += pad
  const padR = 56, padT = 10, padB = 24
  const iw = Math.max(10, width - padR), ih = height - padT - padB
  const n = t.length
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * iw : 0)
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * ih
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4)
  const span = (t[n - 1] ?? 0) - (t[0] ?? 0)
  const fmtT = formatTime ?? ((s: number) => new Date(s * 1000).toLocaleDateString('en-US', span < 3 * 86400 ? { hour: 'numeric' } : { month: 'short', day: 'numeric' }))
  const path = (vs: (number | null)[]) => {
    let d = '', pen = false
    vs.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) { pen = false; return }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    })
    return d
  }
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const i = Math.round(((e.clientX - r.left) / iw) * (n - 1))
        setHover(i >= 0 && i < n ? i : null)
      }}>
      <svg width={width} height={height}>
        <defs>
          {series.map((s, k) => (
            <linearGradient key={k} id={`${gid}g${k}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={0} x2={iw} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeDasharray="1 3" />
            <text x={width - 4} y={y(v) + 4} textAnchor="end" className="axis">{format(v)}</text>
          </g>
        ))}
        {zero && lo < 0 && hi > 0 && <line x1={0} x2={iw} y1={y(0)} y2={y(0)} stroke="var(--text-4)" />}
        {n > 1 && [0.1, 0.5, 0.9].map((f) => <text key={f} x={x(Math.round(f * (n - 1)))} y={height - 6} textAnchor="middle" className="axis">{fmtT(t[Math.round(f * (n - 1))])}</text>)}
        {series.map((s, k) => {
          const d = path(s.values)
          if (!d) return null
          const firstIdx = s.values.findIndex((v) => v !== null)
          const lastIdx = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v !== null)
          const base = y(Math.max(lo, Math.min(hi, zero ? 0 : lo)))
          return (
            <g key={`${k}-${n}`}>
              {s.area && <path d={`${d}L${x(lastIdx)},${base}L${x(firstIdx)},${base}Z`} fill={`url(#${gid}g${k})`} className="area-in" />}
              <path d={d} fill="none" stroke={s.color} strokeWidth={s.dashed ? 1.5 : 2.25} strokeDasharray={s.dashed ? '4 4' : undefined}
                strokeLinejoin="round" pathLength={s.dashed ? undefined : 1} className={s.dashed ? '' : 'draw-in'} />
            </g>
          )
        })}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={height - padB} stroke="var(--text-3)" />}
        {hover !== null && series.map((s, k) => s.values[hover] !== null && <circle key={k} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--bg)" strokeWidth={2} />)}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(x(hover) + 12, width - 180) }}>
          <div className="tip-date">{new Date(t[hover] * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
          {series.map((s, k) => s.values[hover] !== null && (
            <div key={k} className="tip-row"><i style={{ background: s.color }} /> <span className="ellipsis">{s.name}</span> <b>{format(s.values[hover]!)}</b></div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Diverging color for correlations: red (-1) → neutral (0) → blue (+1). */
export function corrColor(c: number) {
  if (!Number.isFinite(c)) return 'var(--surface-3)'
  const a = Math.min(1, Math.abs(c))
  return c >= 0 ? `rgba(50, 98, 255, ${0.12 + a * 0.78})` : `rgba(255, 89, 82, ${0.12 + a * 0.78})`
}

export function Heatmap({ labels, matrix, onPick, picked }: {
  labels: string[]
  matrix: number[][]
  onPick?: (i: number, j: number) => void
  picked?: [number, number] | null
}) {
  const n = labels.length
  return (
    <div className="heatmap" style={{ gridTemplateColumns: `minmax(90px, 160px) repeat(${n}, minmax(38px, 1fr))` }}>
      <span />
      {labels.map((l, j) => <span key={j} className="hm-col" title={l}>{j + 1}</span>)}
      {matrix.map((row, i) => (
        <div className="hm-row" key={i} style={{ display: 'contents' }}>
          <span className="hm-label ellipsis" title={labels[i]}><b>{i + 1}</b> {labels[i]}</span>
          {row.map((c, j) => (
            <button key={j} className={`hm-cell ${picked && picked[0] === i && picked[1] === j ? 'picked' : ''}`}
              style={{ background: corrColor(c), animationDelay: `${(i + j) * 25}ms` }}
              onClick={() => onPick?.(i, j)} title={`${labels[i]} × ${labels[j]}: ${Number.isFinite(c) ? c.toFixed(3) : 'n/a'}`}>
              {Number.isFinite(c) ? c.toFixed(2) : '—'}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

export function Scatter({ x, y, height = 240, xLabel, yLabel, beta, alpha }: {
  x: number[]; y: number[]; height?: number; xLabel: string; yLabel: string; beta?: number; alpha?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const lim = Math.max(1e-6, ...x.map(Math.abs), ...y.map(Math.abs))
  const pad = 28
  const sx = (v: number) => pad + ((v + lim) / (2 * lim)) * (width - pad * 2)
  const sy = (v: number) => pad + (1 - (v + lim) / (2 * lim)) * (height - pad * 2)
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height}>
        <line x1={sx(-lim)} x2={sx(lim)} y1={sy(0)} y2={sy(0)} stroke="var(--grid)" strokeDasharray="1 3" />
        <line x1={sx(0)} x2={sx(0)} y1={sy(-lim)} y2={sy(lim)} stroke="var(--grid)" strokeDasharray="1 3" />
        {x.map((v, i) => <circle key={i} cx={sx(v)} cy={sy(y[i])} r={3} fill="#0093fd" opacity={0.55} className="dot-in" style={{ animationDelay: `${Math.min(i, 300) * 2}ms` }} />)}
        {beta !== undefined && (
          <line x1={sx(-lim)} y1={sy((alpha ?? 0) - beta * lim)} x2={sx(lim)} y2={sy((alpha ?? 0) + beta * lim)} stroke="#fdc503" strokeWidth={2} />
        )}
        <text x={width - pad} y={sy(0) - 6} textAnchor="end" className="axis">{xLabel} Δ</text>
        <text x={sx(0) + 6} y={pad - 8} className="axis">{yLabel} Δ</text>
      </svg>
    </div>
  )
}

export function Bars({ data, height = 70, color = '#0093fd' }: { data: { x: number; n: number }[]; height?: number; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.n))
  return (
    <div className="bars" style={{ height }}>
      {data.map((d, i) => (
        <i key={i} title={`${(d.x * 100).toFixed(2)}pp: ${d.n}`}
          style={{ height: `${(d.n / max) * 100}%`, background: d.x < 0 ? '#ff5952' : color, animationDelay: `${i * 15}ms` }} />
      ))}
    </div>
  )
}
