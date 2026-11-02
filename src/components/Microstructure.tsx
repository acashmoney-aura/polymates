import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, cents, qs, shares, timeAgo, usd, type Book, type Market, type TradeRow } from '../api'
import { Icon } from '../icons'
import { useApp, useStream } from '../store'
import { useBook } from './OrderBook'
import { DepthChart, DivergingBars, ImbalanceGauge } from './ProCharts'

function bookMetrics(book: Book | null) {
  const bids = book?.bids ?? [], asks = book?.asks ?? []
  const bid = bids[0]?.price ?? null, ask = asks[0]?.price ?? null
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : (bid ?? ask)
  const notionalWithin = (ls: { price: number; size: number }[], w: number) =>
    mid === null ? 0 : ls.filter((l) => Math.abs(l.price - mid) <= w + 1e-9).reduce((a, l) => a + l.size * l.price, 0)
  const imb = (w: number) => {
    const b = notionalWithin(bids, w), a = notionalWithin(asks, w)
    return b + a > 0 ? (b - a) / (b + a) : null
  }
  const bs = bids[0]?.size ?? 0, as = asks[0]?.size ?? 0
  return {
    bid, ask, mid,
    spread: bid !== null && ask !== null ? ask - bid : null,
    micro: bid !== null && ask !== null && bs + as > 0 ? (bid * as + ask * bs) / (bs + as) : null,
    bands: [0.01, 0.02, 0.05, 0.1].map((w) => ({ w, v: imb(w), bid: notionalWithin(bids, w), ask: notionalWithin(asks, w) })),
    // dollars it takes to push the price 5¢ either way
    toLift: notionalWithin(asks, 0.05),
    toHit: notionalWithin(bids, 0.05),
  }
}

/** Depth chart, book imbalance and (in leagues) a live trade tape for one market. */
export function Microstructure({ market }: { market: Market }) {
  const { league, leagueId } = useApp()
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('pm_micro') !== '0' } catch { return true } })
  const [unit, setUnit] = useState<'usd' | 'shares'>('usd')
  const [tape, setTape] = useState<TradeRow[] | null>(null)
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const { book } = useBook(open ? market : null)
  useEffect(() => { try { localStorage.setItem('pm_micro', open ? '1' : '0') } catch { /* ignore */ } }, [open])

  const loadTape = useCallback(() => {
    if (!open || !leagueId) return
    api<TradeRow[]>(`/api/leagues/${leagueId}/trades${qs({ market: market.id, limit: 60 })}`).then((rows) => {
      // flash rows that arrived since the last load (not on first paint)
      const prev = seen.current
      setFresh(new Set(prev ? rows.filter((r) => !prev.has(r.id)).map((r) => r.id) : []))
      seen.current = new Set(rows.map((r) => r.id))
      setTape(rows)
    }).catch(() => {})
  }, [open, leagueId, market.id])
  useEffect(() => { setTape(null); seen.current = null; loadTape() }, [loadTape])
  useStream((e) => e.type === 'trade' && e.marketId === market.id, loadTape)

  const m = useMemo(() => bookMetrics(book), [book])
  const head = m.bands.find((b) => b.w === 0.05)
  const flow = useMemo(() => {
    if (!tape?.length) return null
    // a taker buying YES (or selling NO) lifts the YES price
    const dir = (t: TradeRow) => ((t.takerSide === 'buy') === (t.takerOutcome === 'yes') ? 1 : -1)
    const buy = tape.filter((t) => dir(t) > 0).reduce((a, t) => a + t.size * t.yesPrice, 0)
    const sell = tape.filter((t) => dir(t) < 0).reduce((a, t) => a + t.size * t.yesPrice, 0)
    const vol = tape.reduce((a, t) => a + t.size, 0)
    return { buy, sell, net: buy + sell > 0 ? (buy - sell) / (buy + sell) : null, vwap: vol > 0 ? tape.reduce((a, t) => a + t.size * t.yesPrice, 0) / vol : null, dir }
  }, [tape])

  return (
    <div className={`card micro ${open ? 'open' : ''}`}>
      <button className="ob-toggle" onClick={() => setOpen(!open)}>
        <Icon name="trending" size={18} />
        <h3>Depth &amp; flow</h3>
        <span className="ob-src">{book?.source === 'league' ? 'league book' : 'live CLOB'} · YES side</span>
        <span className="grow" />
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={20} />
      </button>
      {open && (
        <div className="micro-body">
          <div className="micro-stats mono">
            <div><span>bid</span><b className="yes-accent">{cents(m.bid)}</b></div>
            <div><span>ask</span><b className="no-color">{cents(m.ask)}</b></div>
            <div><span>spread</span><b>{m.spread === null ? '—' : cents(m.spread)}</b></div>
            <div title="Size-weighted mid: leans toward the thinner side"><span>microprice</span><b>{m.micro === null ? '—' : cents(m.micro)}</b></div>
            <div title="Dollars of resting asks within 5¢: what it costs to push the price up 5¢"><span>$ to lift 5¢</span><b>{usd(m.toLift, 0)}</b></div>
            <div title="Dollars of resting bids within 5¢"><span>$ to hit 5¢</span><b>{usd(m.toHit, 0)}</b></div>
          </div>
          <div className="micro-grid">
            <div className="micro-depth">
              <div className="micro-sub">
                <h4>Cumulative depth</h4>
                <div className="seg seg-sm">
                  <button className={unit === 'usd' ? 'active' : ''} onClick={() => setUnit('usd')}>$</button>
                  <button className={unit === 'shares' ? 'active' : ''} onClick={() => setUnit('shares')}>shares</button>
                </div>
              </div>
              {!book ? <div className="skeleton skeleton-line" style={{ height: 220 }} /> : <DepthChart bids={book.bids} asks={book.asks} unit={unit} />}
            </div>
            <div className="micro-imb">
              <h4>Book imbalance</h4>
              <ImbalanceGauge value={head?.v ?? null} label="within ±5¢ of mid" />
              <DivergingBars rows={m.bands.map((b) => ({
                label: `±${Math.round(b.w * 100)}¢`, value: b.v, hint: `bids ${usd(b.bid, 0)} vs asks ${usd(b.ask, 0)}`,
              }))} />
              <p className="muted small">(bid $ − ask $) / total. Positive means more resting buy interest.</p>
            </div>
          </div>
          {league && (
            <div className="tape">
              <div className="micro-sub">
                <h4>{league.mode === 'exchange' ? 'Trade tape' : 'League fills'}</h4>
                {flow && (
                  <span className="tape-flow mono">
                    <span className="yes-accent">buy {usd(flow.buy, 0)}</span>
                    <span className="no-color">sell {usd(flow.sell, 0)}</span>
                    <span>net {flow.net === null ? '—' : `${flow.net > 0 ? '+' : ''}${Math.round(flow.net * 100)}%`}</span>
                    <span>vwap {cents(flow.vwap)}</span>
                  </span>
                )}
              </div>
              {flow && (
                <div className="flow-bar" title="Share of taker notional that pushed YES up (buy) vs down (sell)">
                  <i className="pos" style={{ width: `${(flow.buy / Math.max(1e-9, flow.buy + flow.sell)) * 100}%` }} />
                  <i className="neg" />
                </div>
              )}
              {!tape ? <div className="skeleton skeleton-line" style={{ height: 60 }} /> : !tape.length ? <p className="muted small">No league trades in this market yet.</p> : (
                <div className="tape-rows mono">
                  <div className="tape-row head"><span>time</span><span>side</span><span>YES px</span><span>shares</span><span>notional</span></div>
                  {tape.slice(0, 30).map((t) => {
                    const up = flow!.dir(t) > 0
                    return (
                      <div key={t.id} className={`tape-row ${up ? 'buy' : 'sell'} ${fresh.has(t.id) ? 'fresh' : ''}`}>
                        <span className="muted">{timeAgo(t.ts)}</span>
                        <span className={up ? 'yes-accent' : 'no-color'}>{up ? 'BUY' : 'SELL'}</span>
                        <span>{cents(t.yesPrice)}</span>
                        <span>{shares(t.size)}</span>
                        <span>{usd(t.size * t.yesPrice, 0)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
