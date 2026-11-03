import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api, cents, compactUsd, pct, qs, shares, shortDate, timeAgo, usd, type League, type Market, type OrderRow, type Outcome,
  type PMEvent, type TradeRow,
} from '../api'
import { PriceChart, RANGES, SERIES_COLORS, useHistory, type Range } from '../components/Chart'
import { EventCurve } from '../components/EventCurve'
import { GameChart, GameHeader, GameLines, gameMoneyline, isGame } from '../components/Game'
import { Microstructure } from '../components/Microstructure'
import { OrderBook } from '../components/OrderBook'
import { StatsForNerds } from '../components/StatsForNerds'
import { TradePanel } from '../components/TradePanel'
import { Avatar, Empty, Img, Sheet, Spinner } from '../components/ui'
import { Icon } from '../icons'
import { Link, navigate, useLocation, useTitle } from '../router'
import { useApp, useStream } from '../store'

export function useEvent(slug: string) {
  const { leagueId } = useApp()
  const [event, setEvent] = useState<PMEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    api<PMEvent>(`/api/events/${encodeURIComponent(slug)}${qs({ league: leagueId })}`).then(setEvent).catch((e) => setError(e.message))
  }, [slug, leagueId])
  useEffect(() => {
    setEvent(null)
    setError(null)
    load()
    const t = setInterval(load, 20_000)
    return () => clearInterval(t)
  }, [load])
  useStream((e) => e.type === 'trade' || e.type === 'resolve' || e.type === 'league', load)
  return { event, error, reload: load }
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(!on) }}>
      <i />
    </button>
  )
}

export async function toggleMarket(league: League, kind: 'events' | 'markets', id: string, enabled: boolean) {
  return api<League>(`/api/leagues/${league.id}/${kind}/${id}`, { method: 'POST', body: { enabled } })
}

function Delta({ v }: { v: number | null }) {
  if (!v) return null
  const up = v > 0
  return <span className={`delta ${up ? 'yes-accent' : 'no-color'}`}>{up ? '▲' : '▼'} {Math.abs(Math.round(v * 100))}%</span>
}

function EventActivity({ event, market }: { event: PMEvent; market: Market }) {
  const { leagueId, user } = useApp()
  const [tab, setTab] = useState<'activity' | 'positions' | 'orders'>('activity')
  const [trades, setTrades] = useState<TradeRow[] | null>(null)
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const { portfolio, toast } = useApp()
  const ids = useMemo(() => new Set(event.markets.map((m) => m.id)), [event])
  const load = useCallback(() => {
    if (!leagueId) return
    api<TradeRow[]>(`/api/leagues/${leagueId}/trades${qs({ limit: 200 })}`).then((t) => setTrades(t.filter((x) => ids.has(x.marketId)))).catch(() => {})
    api<OrderRow[]>(`/api/leagues/${leagueId}/orders`).then((o) => setOrders(o.filter((x) => ids.has(x.marketId)))).catch(() => {})
  }, [leagueId, ids])
  useEffect(load, [load])
  useStream((e) => !!e.marketId && ids.has(e.marketId), load)
  if (!user || !leagueId) return null
  const positions = (portfolio?.positions ?? []).filter((p) => ids.has(p.marketId))
  const cancel = async (id: string) => {
    try {
      await api(`/api/orders/${id}`, { method: 'DELETE' })
      toast('Order cancelled')
      load()
    } catch (e) { toast((e as Error).message, 'error') }
  }
  return (
    <section className="ev-section">
      <div className="text-tabs">
        <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>League activity</button>
        <button className={tab === 'positions' ? 'active' : ''} onClick={() => setTab('positions')}>My positions ({positions.length})</button>
        <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>Open orders ({orders?.length ?? 0})</button>
      </div>
      {tab === 'activity' && (
        !trades ? <Spinner /> : !trades.length ? <p className="muted">No league trades here yet. Be the first.</p> : (
          <ul className="feed">
            {trades.slice(0, 40).map((t) => (
              <li key={t.id}>
                <Avatar user={t.taker} size={28} />
                <span className="grow"><b>{t.taker?.displayName ?? 'Someone'}</b> {t.takerSide === 'buy' ? 'bought' : 'sold'}{' '}
                  <b className={t.takerOutcome === 'yes' ? 'yes-accent' : 'no-color'}>{shares(t.size)} {t.outcomeLabel}</b>
                  {event.markets.length > 1 && <> · {t.title}</>} at {cents(t.price)} <span className="muted">({usd(t.size * t.price)})</span></span>
                <time className="muted">{timeAgo(t.ts)}</time>
              </li>
            ))}
          </ul>
        )
      )}
      {tab === 'positions' && (
        !positions.length ? <p className="muted">You have no position in this event.</p> : (
          <div className="table">
            {positions.map((p) => (
              <div className="trow" key={p.marketId + p.outcome}>
                <span className="grow"><span className={`pill-outcome ${p.outcome}`}>{p.outcomeLabel} {cents(p.avgPrice)}</span> {event.markets.length > 1 && p.title}<small className="muted"> {shares(p.size)} shares</small></span>
                <span>{cents(p.curPrice)}</span>
                <span className="right"><b>{usd(p.value)}</b><small className={p.pnl >= 0 ? 'yes-accent' : 'no-color'}>{usd(p.pnl)} ({(p.pnlPct * 100).toFixed(1)}%)</small></span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'orders' && (
        !orders?.length ? <p className="muted">No open orders.</p> : (
          <div className="table">
            {orders.map((o) => (
              <div className="trow" key={o.id}>
                <span className="grow"><span className={`pill-side ${o.side}`}>{o.side}</span> <span className={`pill-outcome ${o.outcome}`}>{o.outcomeLabel}</span> {event.markets.length > 1 && o.title}</span>
                <span>{cents(o.price)}</span>
                <span>{shares(o.filled)} / {shares(o.size)}</span>
                <button className="icon-btn" onClick={() => cancel(o.id)} aria-label="Cancel order"><Icon name="x" size={16} /></button>
              </div>
            ))}
          </div>
        )
      )}
      {market && null}
    </section>
  )
}

export function EventPage({ slug }: { slug: string }) {
  const { query } = useLocation()
  const { event, error, reload } = useEvent(slug)
  const { league, user, toast, refreshLeague } = useApp()
  const [marketId, setMarketId] = useState<string | null>(query.get('m'))
  const [outcome, setOutcome] = useState<Outcome>((query.get('o') as Outcome) || 'yes')
  const [range, setRange] = useState<Range>('1W')
  const [preset, setPreset] = useState<{ price: number; n: number } | null>(null)
  const [sheet, setSheet] = useState(false)
  const [rules, setRules] = useState(false)
  useTitle(event?.title ?? '')

  const markets = useMemo(() => {
    if (!event) return []
    const open = event.markets.filter((m) => m.active)
    const closed = event.markets.filter((m) => !m.active)
    return [...open.sort((a, b) => b.price - a.price), ...closed]
  }, [event])
  const multi = (event?.markets.length ?? 0) > 1
  const game = event && isGame(event) ? event : null
  const ml = event ? gameMoneyline(event) : null
  const selected = markets.find((m) => m.id === marketId) ?? (game && ml) ?? markets[0]
  const chartMarkets = game && ml ? [ml] : multi ? markets.filter((m) => m.active).slice(0, 4) : markets.slice(0, 1)
  const hist = useHistory(chartMarkets.map((m) => m.id), range)
  const isOwner = !!league && !!user && league.ownerId === user.id

  if (error) return <div className="wrap page"><Empty title="Event not found">{error}. <Link to="/">Back to markets</Link></Empty></div>
  if (!event || !selected) return <div className="wrap page"><div className="ev-skeleton card skeleton" /></div>

  const pick = (m: Market, o: Outcome) => {
    setMarketId(m.id)
    setOutcome(o)
    if (window.matchMedia('(max-width: 1023px)').matches) setSheet(true)
  }
  const setEnabled = async (kind: 'events' | 'markets', id: string, on: boolean) => {
    if (!league) return
    try {
      await toggleMarket(league, kind, id, on)
      toast(on ? 'Turned on for your league' : 'Turned off for your league')
      await refreshLeague()
      reload()
    } catch (e) { toast((e as Error).message, 'error') }
  }
  const gameTitle = game ? game.game.teams.map((t) => t.name).join(' vs ') : event.title
  const panel = (
    <TradePanel market={selected} eventTitle={gameTitle} eventImage={event.icon} multi={multi && !(game && selected === ml)} outcome={outcome}
      onOutcome={setOutcome} presetPrice={preset} onDone={() => setSheet(false)} />
  )

  return (
    <div className="wrap page event-page">
      <div className="ev-main">
        <div className="ev-head">
          <Img src={event.icon || event.image} size={64} radius={10} />
          <div className="ev-head-text">
            <div className="crumbs">{event.tags.filter((t) => !['all', 'hide-from-new'].includes(t.slug)).slice(0, 3).map((t, i) => (
              <span key={t.slug}>{i > 0 && ' · '}<Link to={`/?tag=${t.slug}`}>{t.label}</Link></span>
            ))}</div>
            <h1>{game ? game.game.teams.map((t) => t.name).join(' – ') : event.title}</h1>
          </div>
          <div className="ev-actions">
            {isOwner && (
              <label className="owner-toggle" title="League owners can turn markets on or off">
                <span>{event.enabled ? 'On in league' : 'Off in league'}</span>
                <Toggle on={event.enabled && event.markets.some((m) => m.enabled)} label="Enable event in league"
                  onChange={(v) => setEnabled('events', event.id, v)} />
              </label>
            )}
            <button className="icon-btn" aria-label="Copy link" onClick={() => { void navigator.clipboard?.writeText(location.href); toast('Link copied') }}><Icon name="link" /></button>
            <a className="icon-btn" aria-label="Open on Polymarket" href={`https://polymarket.com/event/${event.slug}`} target="_blank" rel="noreferrer"><Icon name="globe" /></a>
          </div>
        </div>

        {game ? (
          <>
            <GameHeader event={game} ml={ml} />
            {ml && <GameChart event={game} ml={ml} points={hist[ml.id] ?? []} />}
            <div className="ev-meta">
              <span className="grow" />
              <div className="ranges">
                {RANGES.map((r) => <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r}</button>)}
              </div>
            </div>
            <GameLines event={game} selected={selected} outcome={outcome} onPick={pick} onPrice={(p) => setPreset({ price: p, n: Date.now() })} />
          </>
        ) : (<>
        {multi ? (
          <div className="legend">
            {chartMarkets.map((m, k) => <span key={m.id}><i style={{ background: SERIES_COLORS[k] }} />{m.title} <b>{pct(m.price)}</b></span>)}
          </div>
        ) : (
          <div className="headline">
            <b>{pct(selected.price)} chance</b> <Delta v={selected.change24h} />
            {league && Math.abs(selected.price - selected.polymarketPrice) >= 0.005 && (
              <span className="muted small">Polymarket {pct(selected.polymarketPrice)}</span>
            )}
          </div>
        )}

        <PriceChart height={multi ? 240 : 272} endLabels={multi}
          series={chartMarkets.map((m, k) => ({ id: m.id, name: multi ? m.title : m.outcomes[0], color: SERIES_COLORS[k], points: hist[m.id] ?? [] }))} />

        <div className="ev-meta">
          <span><Icon name="trophy" size={16} /> {usd(event.volume, 0)} Vol.</span>
          {event.endDate && <span className="muted"><Icon name="clock" size={16} /> {shortDate(event.endDate)}</span>}
          <span className="grow" />
          <div className="ranges">
            {RANGES.map((r) => <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r}</button>)}
          </div>
        </div>

        {multi ? (
          <div className="outcomes">
            <div className="outcome-head"><span>Outcome</span><span>% Chance</span><span /></div>
            {markets.map((m) => {
              const isSel = m.id === selected.id
              return (
                <div key={m.id} className={`outcome ${isSel ? 'selected' : ''} ${m.enabled ? '' : 'off'}`}>
                  <div className="outcome-row" onClick={() => setMarketId(isSel ? selected.id : m.id)}>
                    <Img src={m.image} size={40} radius={8} />
                    <div className="o-name">
                      <b>{m.title}</b>
                      <small className="muted">{compactUsd(m.volume)} Vol.{m.leagueVolume > 0 && ` · ${compactUsd(m.leagueVolume)} league`}{!m.enabled && ' · off in league'}</small>
                    </div>
                    <div className="o-pct">{m.resolved ? <span className="resolved">{m.payout?.[0] === 1 ? 'Won' : 'Lost'}</span> : <>{pct(m.price)} <Delta v={m.change24h} /></>}</div>
                    {isOwner && <Toggle on={m.enabled} label={`Enable ${m.title}`} onChange={(v) => setEnabled('markets', m.id, v)} />}
                    {m.active && m.enabled && (
                      <div className="o-btns">
                        <button className={`buy-yes ${isSel && outcome === 'yes' ? 'solid' : ''}`} onClick={(e) => { e.stopPropagation(); pick(m, 'yes') }}>Buy Yes <b>{cents(m.bestAsk ?? m.price)}</b></button>
                        <button className={`buy-no ${isSel && outcome === 'no' ? 'solid' : ''}`} onClick={(e) => { e.stopPropagation(); pick(m, 'no') }}>Buy No <b>{cents(m.bestBid !== null ? 1 - m.bestBid : 1 - m.price)}</b></button>
                      </div>
                    )}
                  </div>
                  {isSel && m.active && (
                    <div className="outcome-expand">
                      <OrderBook market={m} outcome={outcome} onOutcome={setOutcome} onPrice={(p) => setPreset({ price: p, n: Date.now() })} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <>
            {isOwner && (
              <div className="owner-note"><Toggle on={selected.enabled} label="Enable market" onChange={(v) => setEnabled('markets', selected.id, v)} /> Market is {selected.enabled ? 'on' : 'off'} for your league</div>
            )}
            <OrderBook market={selected} outcome={outcome} onOutcome={setOutcome} onPrice={(p) => setPreset({ price: p, n: Date.now() })} />
          </>
        )}

        </>)}

        {multi && !game && <EventCurve event={event} onPick={setMarketId} />}

        {selected.active && <Microstructure market={selected} />}

        <StatsForNerds market={selected} event={event} />

        <section className="ev-section">
          <div className="text-tabs"><button className="active">Rules</button></div>
          <div className={`rules ${rules ? 'open' : ''}`}>{event.description || selected.description}</div>
          <button className="link-btn" onClick={() => setRules(!rules)}>{rules ? 'Show less' : 'Show more'}</button>
          <div className="resolver card">
            <span className="resolver-icon"><Icon name="check" /></span>
            <div>
              <span className="muted">Resolution</span>
              <p>Resolves exactly as Polymarket resolves it{event.resolutionSource ? ` (source: ${event.resolutionSource})` : ''}. Winning shares pay $1.00 in fantasy dollars.</p>
            </div>
          </div>
          {event.startDate && <p className="small"><b>Market opened:</b> {shortDate(event.startDate)}</p>}
        </section>

        <EventActivity event={event} market={selected} />
      </div>

      <aside className="ev-aside">
        <div className="sticky">{panel}</div>
      </aside>

      {selected.active && selected.enabled && (
        <div className="mobile-trade-bar">
          <button className="trading-btn yes selected" onClick={() => { setOutcome('yes'); setSheet(true) }}>Buy {selected.outcomes[0]} <b>{cents(selected.bestAsk ?? selected.price)}</b></button>
          <button className="trading-btn no selected" onClick={() => { setOutcome('no'); setSheet(true) }}>Buy {selected.outcomes[1]} <b>{cents(selected.bestBid !== null ? 1 - selected.bestBid : 1 - selected.price)}</b></button>
        </div>
      )}
      {sheet && <Sheet onClose={() => setSheet(false)}>{panel}</Sheet>}
    </div>
  )
}

/** Trade sheet opened from a market card on mobile. */
export function SheetHost() {
  const { sheet, openSheet } = useApp()
  if (!sheet) return null
  return <SheetInner slug={sheet.eventSlug} marketId={sheet.marketId} initial={sheet.outcome} onClose={() => openSheet(null)} />
}

function SheetInner({ slug, marketId, initial, onClose }: { slug: string; marketId: string; initial: Outcome; onClose: () => void }) {
  const { event } = useEvent(slug)
  const [outcome, setOutcome] = useState<Outcome>(initial)
  const m = event?.markets.find((x) => x.id === marketId)
  return (
    <Sheet onClose={onClose}>
      {!event || !m ? <Spinner /> : (
        <>
          <TradePanel market={m} eventTitle={event.title} eventImage={event.icon} multi={event.markets.length > 1} outcome={outcome} onOutcome={setOutcome} onDone={onClose} />
          <button className="link-btn center-btn" onClick={() => { onClose(); navigate(`/event/${slug}`) }}>View full market</button>
        </>
      )}
    </Sheet>
  )
}
