import { useCallback, useEffect, useState } from 'react'
import {
  api, cents, qs, shares, signedUsd, timeAgo, usd, type ActivityRow, type OrderRow, type TradeRow,
} from '../api'
import { PerpPositions } from '../components/PerpTrade'
import { RiskView } from '../components/RiskView'
import { Avatar, Empty, Img, ModeBadge, Spinner } from '../components/ui'
import { Icon } from '../icons'
import { Link, useTitle } from '../router'
import { useApp, useStream } from '../store'

export function NeedLeague({ what }: { what: string }) {
  const { user, openAuth } = useApp()
  if (!user) {
    return (
      <div className="wrap page"><Empty title={`Log in to see your ${what}`}>
        <button className="btn btn-primary" onClick={() => openAuth('login')}>Log In</button>
      </Empty></div>
    )
  }
  return (
    <div className="wrap page"><Empty title="You're not in a league yet">
      <p>Create a league and invite friends, or join one with an invite code.</p>
      <div className="row-gap"><Link className="btn btn-primary" to="/league?new=1">Create league</Link><Link className="btn btn-outline" to="/league?join=1">Join league</Link></div>
    </Empty></div>
  )
}

export function Portfolio() {
  const { user, portfolio, leagueId, league, toast } = useApp()
  const [tab, setTab] = useState<'positions' | 'perps' | 'orders' | 'history' | 'risk'>('positions')
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [trades, setTrades] = useState<TradeRow[] | null>(null)
  const [search, setSearch] = useState('')
  useTitle('Portfolio')
  const load = useCallback(() => {
    if (!leagueId) return
    api<OrderRow[]>(`/api/leagues/${leagueId}/orders`).then(setOrders).catch(() => {})
    api<TradeRow[]>(`/api/leagues/${leagueId}/trades${qs({ mine: 1, limit: 200 })}`).then(setTrades).catch(() => {})
  }, [leagueId])
  useEffect(load, [load])
  useStream((e) => e.type === 'orders' || e.type === 'trade', load)
  if (!user || !leagueId) return <NeedLeague what="portfolio" />
  if (!portfolio || !league) return <div className="wrap page"><Spinner /></div>

  const cancel = async (id: string) => {
    try {
      await api(`/api/orders/${id}`, { method: 'DELETE' })
      toast('Order cancelled')
      load()
    } catch (e) { toast((e as Error).message, 'error') }
  }
  const positions = portfolio.positions.filter((p) => !search || p.title.toLowerCase().includes(search.toLowerCase()) || (p.eventTitle ?? '').toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="page portfolio">
      <div className="pf-cards">
        <div className="card pf-card">
          <div className="pf-user">
            <Avatar user={user} size={56} />
            <div><h2>{user.displayName}</h2><span className="muted">{league.name} <ModeBadge mode={league.mode} /></span></div>
          </div>
          <div className="pf-stats">
            <div><b>{usd(portfolio.value)}</b><span>Portfolio</span></div>
            <div><b>{usd(portfolio.cash)}</b><span>Cash</span></div>
            <div><b>{portfolio.positions.length + (portfolio.perps?.length ?? 0)}</b><span>Positions</span></div>
          </div>
          <div className="kv"><span>Positions value</span><b>{usd(portfolio.positionsValue)}</b></div>
          {(portfolio.perps?.length ?? 0) > 0 && <div className="kv"><span>Perps equity</span><b>{usd(portfolio.perpsValue ?? 0)}</b></div>}
          <div className="kv"><span>Available to trade</span><b>{usd(portfolio.availableCash)}</b></div>
        </div>
        <div className="card pf-card">
          <span className="muted"><span className={portfolio.pnl >= 0 ? 'yes-accent' : 'no-color'}>{portfolio.pnl >= 0 ? '▲' : '▼'}</span> Profit/Loss</span>
          <div className={`pf-pnl ${portfolio.pnl >= 0 ? 'yes-accent' : 'no-color'}`}>{signedUsd(portfolio.pnl)}</div>
          <span className="muted small">All time vs. {usd(league.startingBalance, 0)} starting balance</span>
          <div className="kv"><span>Realized</span><b>{signedUsd(portfolio.realized)}</b></div>
          <div className="kv"><span>Return</span><b>{((portfolio.pnl / league.startingBalance) * 100).toFixed(2)}%</b></div>
          <Link to="/leaderboard" className="pill pill-wide">See leaderboard <Icon name="chevronRight" size={16} /></Link>
        </div>
      </div>

      <div className="text-tabs big">
        <button className={tab === 'positions' ? 'active' : ''} onClick={() => setTab('positions')}>Positions</button>
        <button className={tab === 'perps' ? 'active' : ''} onClick={() => setTab('perps')}>Perps {portfolio.perps?.length ? `(${portfolio.perps.length})` : ''}</button>
        <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>Open orders {orders?.length ? `(${orders.length})` : ''}</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button>
        <button className={tab === 'risk' ? 'active' : ''} onClick={() => setTab('risk')}>Risk</button>
      </div>

      {tab === 'positions' && (
        <>
          <div className="toolbar">
            <label className="search small-search"><Icon name="search" size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search positions" /></label>
          </div>
          {!positions.length ? <Empty title="No positions">Buy something from <Link to="/">the markets</Link>.</Empty> : (
            <div className="ptable">
              <div className="ptable-head"><span>Market</span><span>Avg</span><span>Current</span><span>Value</span></div>
              {positions.map((p) => (
                <Link to={p.eventSlug ? `/event/${p.eventSlug}?m=${p.marketId}&o=${p.outcome}` : '/'} className="ptable-row" key={p.marketId + p.outcome}>
                  <span className="pt-market">
                    <Img src={p.image} size={40} radius={8} />
                    <span className="pt-text">
                      <span className="ellipsis">{p.eventTitle && p.eventTitle !== p.title ? `${p.eventTitle} · ${p.title}` : p.title}</span>
                      <span><span className={`pill-outcome ${p.outcome}`}>{p.outcomeLabel} {cents(p.avgPrice)}</span> <small className="muted">{shares(p.size)} shares</small></span>
                    </span>
                  </span>
                  <span className="hide-sm">{cents(p.avgPrice)}</span>
                  <span className="hide-sm">{cents(p.curPrice)}</span>
                  <span className="right"><b>{usd(p.value)}</b><small className={p.pnl >= 0 ? 'yes-accent' : 'no-color'}>{signedUsd(p.pnl)} ({(p.pnlPct * 100).toFixed(2)}%)</small></span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
      {tab === 'perps' && (
        !portfolio.perps?.length
          ? <Empty title="No open perps">Go long or short on stocks, crypto and more in <Link to="/perps">Perps</Link>.</Empty>
          : <div className="pf-perps"><PerpPositions positions={portfolio.perps} /></div>
      )}
      {tab === 'orders' && (
        !orders ? <Spinner /> : !orders.length ? <Empty title="No open orders" /> : (
          <div className="ptable">
            <div className="ptable-head"><span>Market</span><span>Price</span><span>Filled</span><span /></div>
            {orders.map((o) => (
              <div className="ptable-row" key={o.id}>
                <span className="pt-market">
                  <Img src={o.image} size={40} radius={8} />
                  <span className="pt-text">
                    <Link to={o.eventSlug ? `/event/${o.eventSlug}?m=${o.marketId}` : '/'} className="ellipsis">{o.title}</Link>
                    <span><span className={`pill-side ${o.side}`}>{o.side}</span> <span className={`pill-outcome ${o.outcome}`}>{o.outcomeLabel}</span> <small className="muted">via {o.source}</small></span>
                  </span>
                </span>
                <span>{cents(o.price)}</span>
                <span>{shares(o.filled)} / {shares(o.size)}</span>
                <span className="right"><button className="btn btn-outline btn-sm" onClick={() => cancel(o.id)}>Cancel</button></span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'risk' && <RiskView />}
      {tab === 'history' && (
        !trades ? <Spinner /> : !trades.length ? <Empty title="No trades yet" /> : (
          <div className="ptable">
            <div className="ptable-head"><span>Activity</span><span>Price</span><span>Shares</span><span>Value</span></div>
            {trades.map((t) => (
              <div className="ptable-row" key={t.id}>
                <span className="pt-market">
                  <Img src={t.image} size={40} radius={8} />
                  <span className="pt-text">
                    <Link to={t.eventSlug ? `/event/${t.eventSlug}` : '/'} className="ellipsis">{t.title}</Link>
                    <span><span className={`pill-outcome ${t.takerOutcome}`}>{t.outcomeLabel}</span> <small className="muted">{timeAgo(t.ts)}</small></span>
                  </span>
                </span>
                <span>{cents(t.price)}</span>
                <span>{shares(t.size)}</span>
                <span className="right">{usd(t.size * t.price)}</span>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}

export function ActivityList({ rows }: { rows: ActivityRow[] }) {
  if (!rows.length) return <p className="muted">Nothing yet.</p>
  return (
    <ul className="feed">
      {rows.map((a) => (
        <li key={a.id}>
          {a.user ? <Avatar user={a.user} size={28} /> : <span className="feed-icon"><Icon name="check" size={14} /></span>}
          <span className="grow">
            {a.user && <b>{a.user.displayName} </b>}
            {a.eventSlug ? <Link to={`/event/${a.eventSlug}`}>{a.text}</Link> : a.text}
          </span>
          <time className="muted">{timeAgo(a.ts)}</time>
        </li>
      ))}
    </ul>
  )
}

export function ActivityPage() {
  const { leagueId, user } = useApp()
  const [rows, setRows] = useState<ActivityRow[] | null>(null)
  useTitle('Activity')
  const load = useCallback(() => {
    if (leagueId) api<ActivityRow[]>(`/api/leagues/${leagueId}/activity`).then(setRows).catch(() => {})
  }, [leagueId])
  useEffect(load, [load])
  useStream((e) => e.type === 'activity', load)
  if (!user || !leagueId) return <NeedLeague what="league activity" />
  return (
    <div className="wrap page narrow">
      <h1>Activity</h1>
      {!rows ? <Spinner /> : <ActivityList rows={rows} />}
    </div>
  )
}
