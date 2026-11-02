import { useCallback, useEffect, useState } from 'react'
import { api, cents, qs, shares, usd, type Book, type Market, type Outcome } from '../api'
import { Icon } from '../icons'
import { useApp, useStream } from '../store'

export function useBook(market: Market | null) {
  const { leagueId, league } = useApp()
  const [book, setBook] = useState<Book | null>(null)
  const load = useCallback(() => {
    if (!market) return
    api<Book>(`/api/markets/${market.id}/book${qs({ league: leagueId })}`).then(setBook).catch(() => {})
  }, [market, leagueId])
  useEffect(() => {
    setBook(null)
    load()
    // Polymarket books change constantly; league books push updates over the stream
    const t = setInterval(load, league?.mode === 'exchange' ? 30_000 : 5_000)
    return () => clearInterval(t)
  }, [load, league?.mode])
  useStream((e) => e.marketId === market?.id && (e.type === 'book' || e.type === 'trade'), load)
  return { book, reload: load }
}

/** View the YES book from the NO side: NO bids are YES asks at 1-p and vice versa. */
export function sideBook(book: Book, outcome: Outcome) {
  if (outcome === 'yes') return { bids: book.bids, asks: book.asks, last: book.last }
  return {
    bids: book.asks.map((l) => ({ price: 1 - l.price, size: l.size })),
    asks: book.bids.map((l) => ({ price: 1 - l.price, size: l.size })),
    last: book.last === null ? null : 1 - book.last,
  }
}

export function OrderBook({ market, outcome, onOutcome, onPrice, defaultOpen = true }: {
  market: Market
  outcome: Outcome
  onOutcome: (o: Outcome) => void
  onPrice?: (p: number) => void
  defaultOpen?: boolean
}) {
  const { league } = useApp()
  const [open, setOpen] = useState(defaultOpen)
  const { book, reload } = useBook(open ? market : null)
  const view = book ? sideBook(book, outcome) : null
  const asks = view ? view.asks.slice(0, 8) : []
  const bids = view ? view.bids.slice(0, 8) : []
  let cum = 0
  const askRows = asks.map((l) => ({ ...l, total: (cum += l.price * l.size) })).reverse()
  cum = 0
  const bidRows = bids.map((l) => ({ ...l, total: (cum += l.price * l.size) }))
  const maxTotal = Math.max(1, askRows[0]?.total ?? 0, bidRows[bidRows.length - 1]?.total ?? 0)
  const spread = asks[0] && bids[0] ? asks[0].price - bids[0].price : null

  return (
    <div className={`card ob ${open ? 'open' : ''}`}>
      <button className="ob-toggle" onClick={() => setOpen(!open)}>
        <h3>Order Book</h3>
        <span className="ob-src">{league?.mode === 'exchange' ? 'League book' : 'Live Polymarket book'}</span>
        <span className="grow" />
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={20} />
      </button>
      {open && (
        <div className="ob-body">
          <div className="ob-tabs">
            <button className={outcome === 'yes' ? 'active' : ''} onClick={() => onOutcome('yes')}>Trade {market.outcomes[0]}</button>
            <button className={outcome === 'no' ? 'active' : ''} onClick={() => onOutcome('no')}>Trade {market.outcomes[1]}</button>
            <span className="grow" />
            <button className="icon-btn" onClick={reload} aria-label="Refresh order book"><Icon name="refresh" size={16} /></button>
          </div>
          <div className="ob-head">
            <span>Trade {outcome === 'yes' ? market.outcomes[0] : market.outcomes[1]}</span>
            <span>Price</span><span>Shares</span><span>Total</span>
          </div>
          {!book ? <div className="ob-empty">Loading…</div> : (
            <div className="ob-rows">
              {askRows.length === 0 && <div className="ob-empty">No asks{league?.mode === 'exchange' ? ' — post a sell or a No bid to make one' : ''}</div>}
              {askRows.map((l, i) => (
                <button key={`a${l.price}`} className="ob-row ask" onClick={() => onPrice?.(l.price)}>
                  <span className="ob-bar" style={{ width: `${(l.total / maxTotal) * 30}%` }} />
                  <span>{i === askRows.length - 1 && <em className="tag-ask">Asks</em>}</span>
                  <span className="ob-price">{cents(l.price)}</span>
                  <span>{shares(l.size)}</span>
                  <span>{usd(l.total)}</span>
                </button>
              ))}
              <div className="ob-spread">
                <span>Last: {cents(view!.last)}</span>
                <span>Spread: {spread === null ? '—' : cents(spread)}</span>
              </div>
              {bidRows.map((l, i) => (
                <button key={`b${l.price}`} className="ob-row bid" onClick={() => onPrice?.(l.price)}>
                  <span className="ob-bar" style={{ width: `${(l.total / maxTotal) * 30}%` }} />
                  <span>{i === 0 && <em className="tag-bid">Bids</em>}</span>
                  <span className="ob-price">{cents(l.price)}</span>
                  <span>{shares(l.size)}</span>
                  <span>{usd(l.total)}</span>
                </button>
              ))}
              {bidRows.length === 0 && <div className="ob-empty">No bids</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
