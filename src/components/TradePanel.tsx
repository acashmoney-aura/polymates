import { useEffect, useMemo, useState } from 'react'
import { api, cents, shares as fmtShares, usd, type Market, type Outcome, type Side } from '../api'
import { Icon } from '../icons'
import { Link } from '../router'
import { useApp } from '../store'
import { sideBook, useBook } from './OrderBook'
import { Img } from './ui'

interface Props {
  market: Market
  eventTitle: string
  eventImage: string
  multi: boolean
  outcome: Outcome
  onOutcome: (o: Outcome) => void
  presetPrice?: { price: number; n: number } | null
  onDone?: () => void
}

/** Walk the book to estimate fills for a market order. */
function simulate(levels: { price: number; size: number }[], dollars?: number, qty?: number) {
  let spent = 0, got = 0
  for (const l of levels) {
    if (dollars !== undefined) {
      const q = Math.min(l.size, (dollars - spent) / l.price)
      if (q <= 0) break
      spent += q * l.price
      got += q
    } else if (qty !== undefined) {
      const q = Math.min(l.size, qty - got)
      if (q <= 0) break
      spent += q * l.price
      got += q
    }
  }
  return { spent, shares: got, avg: got > 0 ? spent / got : null }
}

export function TradePanel({ market, eventTitle, eventImage, multi, outcome, onOutcome, presetPrice, onDone }: Props) {
  const { user, leagueId, league, portfolio, openAuth, toast, refreshPortfolio } = useApp()
  const [side, setSide] = useState<Side>('buy')
  const [type, setType] = useState<'market' | 'limit'>('market')
  const [typeOpen, setTypeOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [limit, setLimit] = useState('')
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const { book } = useBook(market)

  useEffect(() => {
    if (presetPrice) {
      setType('limit')
      setLimit(String(Math.round(presetPrice.price * 1000) / 10))
    }
  }, [presetPrice])
  useEffect(() => { setAmount(''); setQty('') }, [market.id, side])

  const view = book ? sideBook(book, outcome) : null
  const otherView = book ? sideBook(book, outcome === 'yes' ? 'no' : 'yes') : null
  const quote = (o: Outcome) => {
    const v = o === outcome ? view : otherView
    const lvl = side === 'buy' ? v?.asks[0] : v?.bids[0]
    if (lvl) return lvl.price
    const p = o === 'yes' ? market.price : 1 - market.price
    return p
  }
  const held = portfolio?.positions.find((p) => p.marketId === market.id && p.outcome === outcome)?.size ?? 0
  const cash = portfolio?.availableCash ?? 0

  const est = useMemo(() => {
    if (type === 'limit') {
      const p = Number(limit) / 100
      const q = Number(qty)
      if (!(p > 0 && p < 1 && q > 0)) return null
      return { spent: p * q, shares: q, avg: p }
    }
    if (!view) return null
    if (side === 'buy') {
      const d = Number(amount)
      return d > 0 ? simulate(view.asks, d) : null
    }
    const q = Number(qty)
    return q > 0 ? simulate(view.bids, undefined, q) : null
  }, [type, limit, qty, amount, view, side])

  const disabledReason = !market.active || market.resolved ? 'This market is closed'
    : market.settled ? 'Settled in this league'
    : !market.enabled ? 'Turned off in this league' : null

  const submit = async () => {
    if (!user) return openAuth('signup')
    if (!leagueId) return
    setBusy(true)
    try {
      const body = type === 'limit'
        ? { marketId: market.id, side, outcome, type, price: Number(limit) / 100, size: Number(qty) }
        : side === 'buy'
          ? { marketId: market.id, side, outcome, type, amount: Number(amount) }
          : { marketId: market.id, side, outcome, type, size: Number(qty) }
      const res = await api<{ order: { status: string; filled: number; size: number }; avgPrice: number | null }>(
        `/api/leagues/${leagueId}/orders`, { method: 'POST', body },
      )
      const label = outcome === 'yes' ? market.outcomes[0] : market.outcomes[1]
      if (res.order.filled > 0) {
        toast(`${side === 'buy' ? 'Bought' : 'Sold'} ${fmtShares(res.order.filled)} ${label} at ${cents(res.avgPrice)}${res.order.status === 'open' ? ' (rest resting)' : ''}`)
      } else {
        toast(`Limit order placed: ${fmtShares(res.order.size)} ${label} at ${limit}¢`)
      }
      setAmount('')
      setQty('')
      void refreshPortfolio()
      onDone?.()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const label = outcome === 'yes' ? market.outcomes[0] : market.outcomes[1]
  const canSubmit = !busy && !disabledReason && (type === 'limit' ? Number(limit) > 0 && Number(qty) > 0 : side === 'buy' ? Number(amount) > 0 : Number(qty) > 0)
  const stepLimit = (d: number) => {
    const cur = Number(limit) || Math.round(quote(outcome) * 100)
    setLimit(String(Math.min(99.9, Math.max(0.1, Math.round((cur + d) * 10) / 10))))
  }

  return (
    <div className="trade-panel">
      <div className="tp-head">
        <Img src={market.image || eventImage} size={48} />
        <div className="tp-head-text">
          <span className="ellipsis">{multi ? market.title : eventTitle}</span>
          <b className={outcome === 'yes' ? 'yes-accent' : 'no-color'}>{side === 'buy' ? 'Buy' : 'Sell'} {label}</b>
        </div>
      </div>

      <div className="tp-tabs">
        <button className={side === 'buy' ? 'active' : ''} onClick={() => setSide('buy')}>Buy</button>
        <button className={side === 'sell' ? 'active' : ''} onClick={() => setSide('sell')}>Sell</button>
        <span className="grow" />
        <div className="tp-type">
          <button onClick={() => setTypeOpen(!typeOpen)}>{type === 'market' ? 'Market' : 'Limit'} <Icon name="chevronDown" size={14} /></button>
          {typeOpen && (
            <div className="menu menu-right">
              {(['market', 'limit'] as const).map((t) => (
                <button key={t} className={`menu-item ${type === t ? 'active' : ''}`} onClick={() => { setType(t); setTypeOpen(false) }}>
                  {t === 'market' ? 'Market' : 'Limit'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="tp-outcomes">
        {(['yes', 'no'] as const).map((o) => (
          <button key={o} className={`trading-btn ${o} ${outcome === o ? 'selected' : ''}`} onClick={() => onOutcome(o)}>
            <span>{o === 'yes' ? market.outcomes[0] : market.outcomes[1]}</span> <b>{cents(quote(o))}</b>
          </button>
        ))}
      </div>

      {type === 'limit' ? (
        <>
          <div className="tp-field">
            <label>Limit Price</label>
            <div className="stepper">
              <button onClick={() => stepLimit(-1)} aria-label="Lower price">−</button>
              <input inputMode="decimal" value={limit} placeholder={`${Math.round(quote(outcome) * 100)}`} onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ''))} />
              <span className="unit">¢</span>
              <button onClick={() => stepLimit(1)} aria-label="Raise price">+</button>
            </div>
          </div>
          <div className="tp-field">
            <label>Shares {side === 'sell' && <small>· you have {fmtShares(held)}</small>}</label>
            <input className="tp-qty" inputMode="decimal" value={qty} placeholder="0" onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))} />
          </div>
          <div className="chips">
            {side === 'sell'
              ? [0.25, 0.5, 1].map((f) => <button key={f} onClick={() => setQty(String(Math.floor(held * f * 100) / 100))}>{f === 1 ? 'Max' : `${f * 100}%`}</button>)
              : [-100, -10, 10, 100].map((d) => <button key={d} onClick={() => setQty(String(Math.max(0, (Number(qty) || 0) + d)))}>{d > 0 ? `+${d}` : d}</button>)}
          </div>
        </>
      ) : side === 'buy' ? (
        <>
          <div className="tp-amount">
            <label>Amount<small>Cash {usd(cash)}</small></label>
            <div className="amount-input">
              <span className={amount ? '' : 'muted'}>$</span>
              <input inputMode="decimal" value={amount} placeholder="0" onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Amount in dollars" />
            </div>
          </div>
          <div className="chips">
            {[1, 20, 100].map((d) => <button key={d} onClick={() => setAmount(String(Math.round(((Number(amount) || 0) + d) * 100) / 100))}>+${d}</button>)}
            <button onClick={() => setAmount(String(Math.floor(cash * 100) / 100))}>Max</button>
          </div>
        </>
      ) : (
        <>
          <div className="tp-amount">
            <label>Shares<small>You have {fmtShares(held)}</small></label>
            <div className="amount-input"><input inputMode="decimal" value={qty} placeholder="0" onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Shares to sell" /></div>
          </div>
          <div className="chips">
            {[0.25, 0.5, 1].map((f) => <button key={f} onClick={() => setQty(String(Math.floor(held * f * 100) / 100))}>{f === 1 ? 'Max' : `${f * 100}%`}</button>)}
          </div>
        </>
      )}

      {est && est.shares > 0 && (
        <div className="tp-summary">
          <div>
            <span className="tp-sum-label">{side === 'buy' ? 'To win' : "You'll receive"} 💵</span>
            <span className="tp-sum-sub">Avg. Price {cents(est.avg)} · {fmtShares(est.shares)} shares</span>
          </div>
          <b className="tp-win">{usd(side === 'buy' ? est.shares : est.spent)}</b>
        </div>
      )}

      {!user ? (
        <button className="ledge-btn" onClick={() => openAuth('signup')}>Sign up to trade</button>
      ) : !leagueId ? (
        <Link to="/league?new=1" className="ledge-btn">Create or join a league to trade</Link>
      ) : (
        <button className="ledge-btn" disabled={!canSubmit} onClick={submit}>
          {disabledReason ?? (busy ? 'Placing…' : type === 'limit' ? `${side === 'buy' ? 'Buy' : 'Sell'} ${label}` : 'Trade')}
        </button>
      )}
      <p className="tp-note">
        {league?.mode === 'exchange'
          ? 'Exchange league: orders match against other members on the league order book.'
          : 'Mirror league: orders fill against the live Polymarket order book.'} Fantasy dollars only.
      </p>
    </div>
  )
}
