import { useEffect, useMemo, useState } from 'react'
import { api, pct, qs, type PMEvent } from '../api'
import { Icon } from '../icons'
import { useApp } from '../store'
import { TermCurve, type Rung } from './ProCharts'

interface Curve {
  kind: 'by' | 'through' | 'none'
  rungs: (Rung & { marketId: string; endDate: string })[]
  violations: { earlier: string; later: string; earlierTitle: string; laterTitle: string; gap: number; trade: string }[]
}

const p1 = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`)

/**
 * "Event curve" for date-ladder events: implied probability vs. date, the
 * implied hazard between dates, and calendar-arb flags. For one-winner events
 * it shows the implied outcome distribution and the overround instead.
 */
export function EventCurve({ event, onPick }: { event: PMEvent; onPick: (marketId: string) => void }) {
  const { leagueId } = useApp()
  const [curve, setCurve] = useState<Curve | null>(null)
  const prices = event.markets.map((m) => m.price.toFixed(3)).join(',')
  useEffect(() => {
    api<Curve>(`/api/events/${encodeURIComponent(event.slug)}/curve${qs({ league: leagueId })}`).then(setCurve).catch(() => setCurve(null))
  }, [event.slug, leagueId, prices])

  const dist = useMemo(() => {
    const ms = event.markets.filter((m) => m.active).sort((a, b) => b.price - a.price)
    const sum = ms.reduce((a, m) => a + m.price, 0)
    return { ms: ms.slice(0, 12), rest: ms.length - 12, sum }
  }, [event])

  if (curve && curve.kind !== 'none' && curve.rungs.length >= 2) {
    const r = curve.rungs
    return (
      <div className="card curve fade-up">
        <div className="curve-head">
          <Icon name="clock" size={18} />
          <h3>Event curve</h3>
          <span className="ob-src">{curve.kind === 'by' ? 'cumulative P(by date)' : 'survival P(still true on date)'} · {r.length} dates</span>
        </div>
        {curve.violations.length > 0 && (
          <div className="curve-alert">
            <b>Calendar arb</b>
            {curve.violations.slice(0, 3).map((v) => (
              <span key={v.earlier + v.later}>{v.laterTitle} is priced {(v.gap * 100).toFixed(1)}pp {curve.kind === 'by' ? 'below' : 'above'} {v.earlierTitle}. {v.trade}.</span>
            ))}
          </div>
        )}
        <TermCurve rungs={r} kind={curve.kind} onPick={(i) => onPick(r[i].marketId)} />
        <div className="curve-table mono">
          <div className="ct-row head"><span>date</span><span>implied</span><span>step</span><span>in window</span><span>hazard/day</span></div>
          {r.map((x, i) => {
            const step = i ? x.price - r[i - 1].price : null
            return (
              <button key={x.marketId} className="ct-row" onClick={() => onPick(x.marketId)} style={{ animationDelay: `${i * 25}ms` }}>
                <span className="ellipsis">{x.title}</span>
                <span>{p1(x.price)}</span>
                <span className={step === null ? 'muted' : (curve.kind === 'by' ? step < 0 : step > 0) ? 'no-color' : ''}>{step === null ? '—' : `${step >= 0 ? '+' : ''}${(step * 100).toFixed(1)}`}</span>
                <span>{p1(x.conditional)}</span>
                <span>{x.hazardPerDay === null ? '—' : `${(x.hazardPerDay * 100).toFixed(2)}%`}</span>
              </button>
            )
          })}
        </div>
        <p className="muted small">In window = chance it {curve.kind === 'by' ? 'happens' : 'breaks'} between the previous date and this one, given it hasn’t yet. Hazard = −ln(S₂/S₁)/Δdays.</p>
      </div>
    )
  }

  if (event.negRisk && dist.ms.length >= 3) {
    const max = Math.max(...dist.ms.map((m) => m.price), 0.01)
    const over = dist.sum - 1
    return (
      <div className="card curve fade-up">
        <div className="curve-head">
          <Icon name="activity" size={18} />
          <h3>Implied distribution</h3>
          <span className="ob-src">one winner · Σ YES {pct(dist.sum)}</span>
          <span className="grow" />
          <span className={`mono small ${Math.abs(over) > 0.03 ? 'no-color' : 'muted'}`}>overround {over >= 0 ? '+' : ''}{(over * 100).toFixed(1)}pp</span>
        </div>
        <div className="dist">
          {dist.ms.map((m, i) => (
            <button key={m.id} className="dist-row" onClick={() => onPick(m.id)} title={`${m.title}: ${(m.price * 100).toFixed(1)}% · normalized ${((m.price / dist.sum) * 100).toFixed(1)}%`}>
              <span className="ellipsis">{m.title}</span>
              <span className="dist-track"><i style={{ width: `${(m.price / max) * 100}%`, animationDelay: `${i * 30}ms` }} /></span>
              <b className="mono">{(m.price * 100).toFixed(1)}%</b>
              <small className="mono muted">{((m.price / dist.sum) * 100).toFixed(1)}%</small>
            </button>
          ))}
          {dist.rest > 0 && <p className="muted small">+{dist.rest} more outcomes</p>}
        </div>
        <p className="muted small">Right column normalizes prices to sum to 100%, removing the overround.</p>
      </div>
    )
  }
  return null
}
