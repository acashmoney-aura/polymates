import { useEffect, useMemo, useState } from 'react'
import { api, cents, pct, usd, type Market, type PMEvent } from '../api'
import { Icon } from '../icons'
import {
  americanOdds, autocorr, decimalOdds, diffs, fmtNum, fmtPct, fmtPp, histogram, hurst, impliedApr, kelly, logit,
  maxDrawdown, std, type Pt,
} from '../quant'
import { Link } from '../router'
import { useApp } from '../store'
import { useBook } from './OrderBook'
import { Bars } from './QuantCharts'

const fmtApr = (x: number) => (!Number.isFinite(x) ? '—' : x > 99.99 ? '>9,999%' : fmtPct(x, 0))

function Row({ k, v, hint, tone }: { k: string; v: string; hint?: string; tone?: 'up' | 'down' }) {
  return (
    <div className="sfn-row" title={hint}>
      <span>{k}</span>
      <b className={tone === 'up' ? 'yes-accent' : tone === 'down' ? 'no-color' : ''}>{v}</b>
    </div>
  )
}

/** YouTube-style "stats for nerds" panel with microstructure, volatility and sizing stats for one market. */
export function StatsForNerds({ market, event }: { market: Market; event: PMEvent }) {
  const { league } = useApp()
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('pm_sfn') === '1' } catch { return false }
  })
  const [hist, setHist] = useState<Pt[] | null>(null)
  const [now] = useState(() => Date.now())
  const [belief, setBelief] = useState(Math.round(market.price * 100))
  const { book } = useBook(open ? market : null)

  useEffect(() => { try { localStorage.setItem('pm_sfn', open ? '1' : '0') } catch { /* ignore */ } }, [open])
  useEffect(() => setBelief(Math.round(market.price * 100)), [market.id, market.price])
  useEffect(() => {
    if (!open) return
    setHist(null)
    api<Pt[]>(`/api/markets/${market.id}/history?range=1m`).then(setHist).catch(() => setHist([]))
  }, [open, market.id])

  const s = useMemo(() => {
    const ps = (hist ?? []).map((x) => x.p)
    const d = diffs(ps)
    const dtDays = hist && hist.length > 1 ? (hist[hist.length - 1].t - hist[0].t) / 86400 / (hist.length - 1) : 1
    const at = (days: number) => {
      if (!hist?.length) return NaN
      const target = hist[hist.length - 1].t - days * 86400
      const past = [...hist].reverse().find((x) => x.t <= target) ?? hist[0]
      return market.price - past.p
    }
    const logitD = diffs(ps.map(logit))
    return {
      n: ps.length,
      ch1d: at(1), ch7d: at(7), ch30d: at(30),
      hi: ps.length ? Math.max(...ps) : NaN,
      lo: ps.length ? Math.min(...ps) : NaN,
      volDaily: std(d) / Math.sqrt(Math.max(dtDays, 1e-6)),
      logitVolAnn: std(logitD) * Math.sqrt(365 / Math.max(dtDays, 1e-6)),
      ac1: autocorr(d, 1),
      hurst: hurst(d.length > 400 ? d.slice(-400) : d),
      mdd: maxDrawdown(ps),
      hist: histogram(d.filter((x) => x !== 0), 25),
    }
  }, [hist, market.price])

  const bid = book?.bids[0]?.price ?? market.bestBid
  const ask = book?.asks[0]?.price ?? market.bestAsk
  const bidSz = book?.bids[0]?.size ?? 0
  const askSz = book?.asks[0]?.size ?? 0
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : market.price
  const spread = bid !== null && ask !== null ? ask - bid : NaN
  const micro = bid !== null && ask !== null && bidSz + askSz > 0 ? (bid * askSz + ask * bidSz) / (bidSz + askSz) : NaN
  const depth = (side: 'bids' | 'asks') => (book?.[side] ?? []).filter((l) => Math.abs(l.price - mid) <= 0.05).reduce((a, l) => a + l.size * l.price, 0)
  const dBid = depth('bids'), dAsk = depth('asks')
  const imbalance = dBid + dAsk > 0 ? (dBid - dAsk) / (dBid + dAsk) : NaN
  const days = market.endDate ? (Date.parse(market.endDate) - now) / 86400_000 : NaN
  const sumYes = event.markets.filter((m) => m.active).reduce((a, m) => a + m.price, 0)
  const p = belief / 100
  const kYes = kelly(p, ask ?? market.price)
  const kNo = kelly(1 - p, bid !== null ? 1 - bid : 1 - market.price)
  const evYes = ask ? p / ask - 1 : NaN
  const evNo = bid !== null ? (1 - p) / (1 - bid) - 1 : NaN

  return (
    <div className={`card sfn ${open ? 'open' : ''}`}>
      <button className="ob-toggle" onClick={() => setOpen(!open)}>
        <Icon name="activity" size={18} />
        <h3>Stats for nerds</h3>
        <span className="ob-src">microstructure · volatility · Kelly</span>
        <span className="grow" />
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={20} />
      </button>
      {open && (
        <div className="sfn-body">
          <div className="sfn-grid">
            <section>
              <h4>Book</h4>
              <Row k="mid" v={cents(mid)} />
              <Row k="spread" v={Number.isFinite(spread) ? `${cents(spread)} · ${Math.round((spread / Math.max(mid, 1e-6)) * 1e4)}bps` : '—'} hint="Best ask minus best bid" />
              <Row k="microprice" v={Number.isFinite(micro) ? cents(micro) : '—'} hint="Size-weighted mid: leans toward the side with less size" />
              <Row k="depth ±5¢" v={`${usd(dBid, 0)} / ${usd(dAsk, 0)}`} hint="Dollar depth within 5¢ of mid, bids / asks" />
              <Row k="imbalance" v={fmtPct(imbalance, 0)} tone={imbalance > 0.2 ? 'up' : imbalance < -0.2 ? 'down' : undefined} hint="(bid depth − ask depth) / total; positive = buy pressure" />
              <Row k="source" v={book?.source === 'league' ? 'league book' : 'polymarket'} />
            </section>
            <section>
              <h4>Price</h4>
              <Row k="P(yes)" v={pct(market.price)} />
              <Row k="logit" v={fmtNum(logit(market.price), 3)} hint="ln(p / (1−p)), log-odds" />
              <Row k="decimal odds" v={fmtNum(decimalOdds(market.price), 2)} />
              <Row k="american" v={americanOdds(market.price)} />
              <Row k="Δ 24h / 7d" v={`${fmtPp(s.ch1d)} / ${fmtPp(s.ch7d)}`} tone={s.ch1d > 0 ? 'up' : s.ch1d < 0 ? 'down' : undefined} />
              <Row k="30d range" v={Number.isFinite(s.lo) ? `${cents(s.lo)} – ${cents(s.hi)}` : '—'} />
            </section>
            <section>
              <h4>Volatility</h4>
              <Row k="σ daily" v={fmtPp(s.volDaily, 2).replace('+', '')} hint="Std dev of daily probability change" />
              <Row k="σ logit (ann.)" v={fmtNum(s.logitVolAnn, 2)} hint="Annualized volatility of log-odds" />
              <Row k="max drawdown" v={fmtPp(s.mdd).replace('+', '')} tone="down" />
              <Row k="lag-1 autocorr" v={fmtNum(s.ac1, 3)} hint="< 0 suggests mean reversion, > 0 momentum" />
              <Row k="Hurst" v={fmtNum(s.hurst, 2)} hint="~0.5 random walk, < 0.5 mean-reverting, > 0.5 trending" />
              <Row k="samples" v={String(s.n)} />
            </section>
            <section>
              <h4>Carry</h4>
              <Row k="resolves in" v={Number.isFinite(days) ? (days < 1 ? `${Math.max(0, days * 24).toFixed(1)}h` : `${days.toFixed(1)}d`) : '—'} />
              <Row k="YES APR @ask" v={fmtApr(impliedApr(ask ?? market.price, days))} hint="Annualized return if YES pays $1 at resolution" />
              <Row k="NO APR @ask" v={fmtApr(impliedApr(bid !== null ? 1 - bid : 1 - market.price, days))} />
              {event.markets.length > 1 && <Row k="Σ YES (event)" v={pct(sumYes)} tone={Math.abs(sumYes - 1) > 0.03 ? 'down' : undefined} hint="For one-winner events this should be ~100%; the gap is the overround" />}
              {league?.mode === 'exchange' && <Row k="basis vs PM" v={fmtPp(market.price - market.polymarketPrice)} hint="League price minus Polymarket price" />}
              <Row k="volume" v={usd(market.volume, 0)} />
            </section>
          </div>
          <div className="sfn-lower">
            <div className="sfn-hist">
              <h4>Distribution of price moves (30d)</h4>
              {hist === null ? <div className="skeleton-line" /> : <Bars data={s.hist} />}
            </div>
            <div className="kelly">
              <h4>Kelly sizer</h4>
              <label>Your P(yes): <b>{belief}%</b>
                <input type="range" min={1} max={99} value={belief} onChange={(e) => setBelief(Number(e.target.value))} />
              </label>
              <div className="kelly-out">
                <div className={kYes > 0 ? 'pos' : ''}><span>Buy YES @{cents(ask ?? market.price)}</span><b>{kYes > 0 ? `bet ${fmtPct(kYes)} of bankroll` : 'no edge'}</b><small>EV {fmtPct(evYes, 1)} per $</small></div>
                <div className={kNo > 0 ? 'pos' : ''}><span>Buy NO @{cents(bid !== null ? 1 - bid : 1 - market.price)}</span><b>{kNo > 0 ? `bet ${fmtPct(kNo)} of bankroll` : 'no edge'}</b><small>EV {fmtPct(evNo, 1)} per $</small></div>
              </div>
              <Link to={`/lab?tab=backtest&m=${market.id}`} className="pill pill-wide"><Icon name="zap" size={16} /> Backtest a strategy on this market</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
