import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { api, pct } from '../api'

export const SERIES_COLORS = ['#0093fd', '#ff5952', '#ff7f0e', '#fdc503', '#9b51e0']
export const RANGES = ['1H', '6H', '1D', '1W', '1M', 'ALL'] as const
export type Range = (typeof RANGES)[number]

export interface Series { id: string; name: string; color: string; points: { t: number; p: number }[] }

export function useHistory(marketIds: string[], range: Range) {
  const [series, setSeries] = useState<Record<string, { t: number; p: number }[]>>({})
  const key = marketIds.join(',')
  useEffect(() => {
    let live = true
    Promise.all(
      marketIds.map((id) =>
        api<{ t: number; p: number }[]>(`/api/markets/${id}/history?range=${range.toLowerCase()}`).then((d) => [id, d] as const).catch(() => [id, []] as const),
      ),
    ).then((rows) => live && setSeries(Object.fromEntries(rows)))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, range])
  return series
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const fmtTime = (t: number, span: number) => {
  const d = new Date(t * 1000)
  if (span <= 2 * 86400) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: span < 7200 ? '2-digit' : undefined })
  if (span <= 60 * 86400) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return d.toLocaleDateString('en-US', { month: 'short', year: span > 400 * 86400 ? '2-digit' : undefined })
}

export function PriceChart({ series, height = 272, endLabels = false }: { series: Series[]; height?: number; endLabels?: boolean }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const gid = useId().replace(/:/g, '')
  const padR = endLabels && width > 560 ? 150 : 44
  const padT = 12
  const padB = 26
  const valid = series.filter((s) => s.points.length > 1)
  const { t0, t1, yMax } = useMemo(() => {
    let a = Infinity, b = -Infinity, m = 0
    for (const s of valid) for (const pt of s.points) { a = Math.min(a, pt.t); b = Math.max(b, pt.t); m = Math.max(m, pt.p) }
    const ceil = m > 0.75 || endLabels ? 1 : Math.min(1, Math.ceil((m + 0.05) * 10) / 10)
    return { t0: a, t1: b, yMax: ceil || 1 }
  }, [valid, endLabels])
  const innerW = Math.max(10, width - padR)
  const innerH = height - padT - padB
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * innerW
  const y = (p: number) => padT + (1 - p / yMax) * innerH
  const ticks = yMax === 1 ? [0, 0.25, 0.5, 0.75, 1] : Array.from({ length: Math.round(yMax * 10) + 1 }, (_, i) => i / 10).filter((_, i, a) => a.length <= 6 || i % 2 === 0)
  const span = t1 - t0
  const xTicks = valid.length ? Array.from({ length: 5 }, (_, i) => t0 + (span * (i + 0.5)) / 5) : []

  const hoverT = hover === null ? null : t0 + (hover / innerW) * span
  const valueAt = (s: Series, t: number) => {
    let best = s.points[0]
    for (const pt of s.points) { if (pt.t <= t) best = pt; else break }
    return best.p
  }

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const px = e.clientX - r.left
        setHover(px >= 0 && px <= innerW ? px : null)
      }}>
      {!valid.length ? (
        <div className="chart-empty" style={{ height }}>No price history yet</div>
      ) : (
        <svg width={width} height={height}>
          <defs>
            {valid.map((s) => (
              <linearGradient key={s.id} id={`${gid}${s.id}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={0} x2={innerW} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeDasharray="1 3" />
              <text x={width - 4} y={y(v) + 4} textAnchor="end" className="axis">{Math.round(v * 100)}%</text>
            </g>
          ))}
          {xTicks.map((t) => <text key={t} x={x(t)} y={height - 6} textAnchor="middle" className="axis">{fmtTime(t, span)}</text>)}
          {valid.map((s) => {
            const d = s.points.map((pt, i) => `${i ? 'L' : 'M'}${x(pt.t).toFixed(1)},${y(pt.p).toFixed(1)}`).join('')
            const last = s.points[s.points.length - 1]
            return (
              <g key={`${s.id}-${s.points.length}-${t0}`}>
                {valid.length === 1 && (
                  <path d={`${d}L${x(last.t).toFixed(1)},${y(0)}L${x(s.points[0].t).toFixed(1)},${y(0)}Z`} fill={`url(#${gid}${s.id})`} className="area-in" />
                )}
                <path d={d} fill="none" stroke={s.color} strokeWidth={2.75} strokeLinejoin="round" pathLength={1} className="draw-in" />
                <circle cx={x(last.t)} cy={y(last.p)} r={8} fill={s.color} opacity={0.3} className="pulse" />
                <circle cx={x(last.t)} cy={y(last.p)} r={4} fill={s.color} />
                {endLabels && width > 560 && (
                  <g transform={`translate(${x(last.t) + 14}, ${y(last.p)})`}>
                    <text y={-8} className="end-name" fill={s.color}>{s.name.length > 18 ? `${s.name.slice(0, 17)}…` : s.name}</text>
                    <text y={18} className="end-pct" fill={s.color}>{pct(last.p)}</text>
                  </g>
                )}
              </g>
            )
          })}
          {hover !== null && hoverT !== null && (
            <g>
              <line x1={hover} x2={hover} y1={padT} y2={height - padB} stroke="var(--text-3)" strokeWidth={1} />
              {valid.map((s) => <circle key={s.id} cx={hover} cy={y(valueAt(s, hoverT))} r={4} fill={s.color} stroke="var(--bg)" strokeWidth={2} />)}
            </g>
          )}
        </svg>
      )}
      {hover !== null && hoverT !== null && valid.length > 0 && (
        <div className="chart-tip" style={{ left: Math.min(hover + 12, width - 170) }}>
          <div className="tip-date">{new Date(hoverT * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
          {valid.map((s) => (
            <div key={s.id} className="tip-row"><i style={{ background: s.color }} /> <span className="ellipsis">{s.name}</span> <b>{pct(valueAt(s, hoverT))}</b></div>
          ))}
        </div>
      )}
    </div>
  )
}
