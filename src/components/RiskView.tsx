import { useEffect, useState } from 'react'
import { api, cents, signedUsd, usd } from '../api'
import { Tile } from '../pages/Lab'
import { fmtNum, fmtPct } from '../quant'
import { Link } from '../router'
import { useApp, useStream } from '../store'
import { Heatmap } from './QuantCharts'
import { Empty, Spinner } from './ui'

interface RiskPos {
  marketId: string; title: string; eventTitle: string | null; eventSlug: string | null; category: string
  yes: number; no: number; value: number; cost: number; p: number; endDate: string | null
  ifYes: number; ifNo: number; netDelta: number; dailyVol: number; resolutionSd: number; riskContribution: number; weight: number
}
interface Risk {
  equity: number; cash: number; positionsValue: number
  expected: { payout: number; pnl: number; equity: number }
  resolution: { sdIndependent: number; sdCorrelated: number; diversification: number | null; bestCase: number; worstCase: number }
  var1d95: number
  concentration: { hhi: number; effectivePositions: number | null; top: number | null }
  categories: { category: string; value: number; positions: number; netDelta: number; share: number }[]
  positions: RiskPos[]
  correlation: { labels: string[]; matrix: number[][] }
}

const whole = (n: number) => `${n >= 0 ? '+' : '−'}${usd(Math.abs(n), 0)}`
const CAT_COLORS = ['#0093fd', '#ff7f0e', '#9b51e0', '#2dca65', '#fdc503', '#ff6fb5', '#5ce1e6', '#ff5952']
/** Outcome first so truncation on narrow screens keeps the part that differs between rows. */
function Name({ p }: { p: RiskPos }) {
  const distinct = p.eventTitle && p.eventTitle !== p.title && p.title !== 'None'
  return <span className="ellipsis sans">{distinct ? <><b>{p.title}</b> <span className="muted">{p.eventTitle}</span></> : (p.eventTitle ?? p.title)}</span>
}
const name = (p: RiskPos) => (p.eventTitle && p.eventTitle !== p.title && p.title !== 'None' ? `${p.eventTitle} · ${p.title}` : (p.eventTitle ?? p.title))

/** Portfolio risk: exposure, scenarios, EV, correlation-weighted risk and Kelly sizing. */
export function RiskView() {
  const { leagueId } = useApp()
  const [risk, setRisk] = useState<Risk | null>(null)
  const [edge, setEdge] = useState(5)
  const [half, setHalf] = useState(true)
  const load = () => { if (leagueId) api<Risk>(`/api/leagues/${leagueId}/risk`).then(setRisk).catch(() => {}) }
  useEffect(load, [leagueId])
  useStream((e) => e.type === 'trade' || e.type === 'resolve', load)
  if (!risk) return <Spinner />
  if (!risk.positions.length) return <Empty title="No open positions">Risk shows up once you hold something. <Link to="/">Find a market</Link>.</Empty>

  const maxSwing = Math.max(1, ...risk.positions.map((p) => Math.max(Math.abs(p.ifYes), Math.abs(p.ifNo))))
  const maxContrib = Math.max(1e-9, ...risk.positions.map((p) => Math.abs(p.riskContribution)))
  // Kelly for the side you hold, assuming you believe it is `edge` pp underpriced
  const kellyRows = risk.positions.map((p) => {
    const long = p.yes >= p.no
    const q = long ? p.p : 1 - p.p
    const belief = Math.min(0.99, q + edge / 100)
    const f = q < 1 ? Math.max(0, (belief - q) / (1 - q)) * (half ? 0.5 : 1) : 0
    const optimal = f * risk.equity
    return { p, side: long ? 'YES' : 'NO', q, f, optimal, actual: p.value, ratio: optimal > 0 ? p.value / optimal : null }
  })
  const kMax = Math.max(1, ...kellyRows.map((k) => Math.max(k.optimal, k.actual)))

  return (
    <div className="risk fade-up">
      <div className="tiles">
        <Tile label="EV at current prices" value={risk.expected.equity} format={(n) => usd(n, 0)} hint="Cash plus the expected payout if every market resolves with the probability it trades at now" />
        <Tile label="Expected P&L" value={risk.expected.pnl} format={signedUsd} tone hint="Expected payout minus what you paid" />
        <Tile label="1-day VaR 95%" value={-risk.var1d95} format={(n) => usd(n, 0)} tone hint="Mark-to-market loss exceeded on 1 day in 20, from realized daily vol and correlations" />
        <Tile label="Resolution σ" value={risk.resolution.sdCorrelated} format={(n) => usd(n, 0)} hint="Std dev of the final payout, correlation-weighted" />
        <Tile label="σ if independent" value={risk.resolution.sdIndependent} format={(n) => usd(n, 0)} />
        <Tile label="Corr. multiplier" value={risk.resolution.diversification} format={(n) => `${fmtNum(n, 2)}×`} hint="Correlated σ ÷ independent σ. Above 1: your bets move together. Below 1: they hedge each other." />
        <Tile label="Best case" value={risk.resolution.bestCase} format={(n) => usd(n, 0)} hint="Every position pays out (ignores mutually exclusive outcomes)" />
        <Tile label="Worst case" value={risk.resolution.worstCase} format={(n) => usd(n, 0)} />
      </div>

      <div className="risk-grid">
        <div className="card risk-card">
          <div className="bt-a-head"><h4>Exposure by category</h4><span className="muted small mono">{risk.concentration.effectivePositions === null ? '' : `${fmtNum(risk.concentration.effectivePositions, 1)} effective bets · top ${fmtPct(risk.concentration.top ?? 0, 0)}`}</span></div>
          <div className="cat-bar">
            {risk.categories.map((c, i) => <i key={c.category} style={{ width: `${c.share * 100}%`, background: CAT_COLORS[i % CAT_COLORS.length], animationDelay: `${i * 60}ms` }} title={`${c.category}: ${usd(c.value)}`} />)}
          </div>
          <div className="cat-rows mono">
            {risk.categories.map((c, i) => (
              <div key={c.category} className="cat-row">
                <span><i style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />{c.category}</span>
                <span className="muted">{c.positions} pos</span>
                <b>{usd(c.value, 0)}</b>
                <span>{fmtPct(c.share, 0)}</span>
                <span className="muted" title="Net YES shares: $ change per 100pp move in YES across the category">Δ {c.netDelta >= 0 ? '+' : ''}{Math.round(c.netDelta)}</span>
              </div>
            ))}
          </div>
        </div>

        {risk.correlation.labels.length >= 2 && (
          <div className="card risk-card">
            <div className="bt-a-head"><h4>Position correlation</h4><span className="muted small">4h price changes over 7d</span></div>
            <Heatmap labels={risk.correlation.labels.slice(0, 8).map((l, i) => name(risk.positions[i]) || l)} matrix={risk.correlation.matrix.slice(0, 8).map((r) => r.slice(0, 8))} />
          </div>
        )}

        <div className="card risk-card wide">
          <div className="bt-a-head"><h4>Scenario P&amp;L</h4><span className="muted small">change in portfolio value if each market resolves YES or NO, everything else unchanged</span></div>
          <div className="scen mono">
            <div className="scen-row head"><span>market</span><span>held</span><span>value</span><span className="center">if NO ◂ ▸ if YES</span><span title="Share of correlated resolution risk">risk</span></div>
            {risk.positions.map((p, i) => (
              <Link key={p.marketId} to={p.eventSlug ? `/event/${p.eventSlug}?m=${p.marketId}` : '/'} className="scen-row" style={{ animationDelay: `${i * 25}ms` }}>
                <Name p={p} />
                <span>{p.yes > 0 && <span className="yes-accent">{Math.round(p.yes)}Y</span>}{p.yes > 0 && p.no > 0 && ' '}{p.no > 0 && <span className="no-color">{Math.round(p.no)}N</span>} <span className="muted">@{cents(p.p)}</span></span>
                <span>{usd(p.value, 0)}</span>
                <span className="tornado">
                  <span className="t-left"><i className={p.ifNo >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(p.ifNo) / maxSwing) * 100}%` }} /><em>{whole(p.ifNo)}</em></span>
                  <span className="t-right"><i className={p.ifYes >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(p.ifYes) / maxSwing) * 100}%` }} /><em>{whole(p.ifYes)}</em></span>
                </span>
                <span className="risk-c"><i style={{ width: `${(Math.max(0, p.riskContribution) / maxContrib) * 100}%` }} />{fmtPct(p.riskContribution / Math.max(1e-9, risk.resolution.sdCorrelated), 0)}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="card risk-card wide">
          <div className="bt-a-head">
            <h4>Kelly sizing vs actual</h4>
            <span className="grow" />
            <label className="kelly-edge small">assumed edge <b className="mono">{edge}pp</b>
              <input type="range" min={1} max={20} value={edge} onChange={(e) => setEdge(Number(e.target.value))} /></label>
            <div className="seg seg-sm"><button className={half ? 'active' : ''} onClick={() => setHalf(true)}>½ Kelly</button><button className={!half ? 'active' : ''} onClick={() => setHalf(false)}>full</button></div>
          </div>
          <div className="kelly-rows mono">
            {kellyRows.map((k) => (
              <div key={k.p.marketId} className="kelly-row">
                <span className="kelly-name"><span className={`mono ${k.side === 'YES' ? 'yes-accent' : 'no-color'}`}>{k.side}</span><Name p={k.p} /></span>
                <span className="kbars">
                  <i className="opt" style={{ width: `${(k.optimal / kMax) * 100}%` }} title={`Kelly: ${usd(k.optimal, 0)} (${fmtPct(k.f, 1)} of equity)`} />
                  <i className="act" style={{ width: `${(k.actual / kMax) * 100}%` }} title={`Actual: ${usd(k.actual, 0)}`} />
                </span>
                <span>{usd(k.actual, 0)} / {usd(k.optimal, 0)}</span>
                <b className={k.ratio === null ? '' : k.ratio > 1.5 ? 'no-color' : k.ratio < 0.5 ? 'muted' : 'yes-accent'}>{k.ratio === null ? '—' : k.ratio > 1.5 ? `${fmtNum(k.ratio, 1)}× over` : k.ratio < 0.5 ? `${fmtNum(k.ratio, 1)}× under` : 'on target'}</b>
              </div>
            ))}
          </div>
          <p className="muted small">Kelly needs your edge, which only you know. This assumes every position is {edge}pp underpriced on the side you hold: f* = edge / (1 − price){half ? ', halved' : ''}. Blue is Kelly, white is what you hold at today’s mark.</p>
        </div>
      </div>
    </div>
  )
}
