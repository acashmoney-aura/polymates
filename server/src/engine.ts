import { perpSummary } from './perps.ts'
import { catalog, displayPrice, marketById, pmBook } from './polymarket.ts'
import { db, markDirty, memberKey, positionKey, settlementKey } from './state.ts'
import type { Activity, Book, League, Order, OrderSource, OrderType, Outcome, PMMarket, Position, Side, Trade } from './types.ts'
import { emit, fail, id, money, now, px, shares } from './util.ts'

/* ------------------------------------------------------------------
 * Order book model (same as Polymarket's CLOB):
 * every binary market has ONE book quoted in YES price.
 *   buy YES @ p  -> bid @ p          sell YES @ p -> ask @ p
 *   sell NO @ q  -> bid @ 1-q        buy NO @ q   -> ask @ 1-q
 * A bid/ask match is a transfer, a mint (buy YES + buy NO) or a merge
 * (sell YES + sell NO). In every case each side pays/receives its own
 * outcome price × size, so cash and shares are always conserved.
 * ------------------------------------------------------------------ */

export const HOUSE_USER = 'usr_house'

interface LeagueBook {
  bids: Order[]
  asks: Order[]
}
const books = new Map<string, LeagueBook>()
const bookKey = (leagueId: string, marketId: string) => `${leagueId}:${marketId}`

export const isBid = (o: Pick<Order, 'side' | 'outcome'>) => (o.side === 'buy') === (o.outcome === 'yes')
export const yesPrice = (o: Pick<Order, 'side' | 'outcome' | 'price'>) => (o.outcome === 'yes' ? o.price : px(1 - o.price))
const outcomePrice = (outcome: Outcome, yp: number) => (outcome === 'yes' ? yp : px(1 - yp))

function bookFor(leagueId: string, marketId: string) {
  const k = bookKey(leagueId, marketId)
  let b = books.get(k)
  if (!b) books.set(k, (b = { bids: [], asks: [] }))
  return b
}

function insert(o: Order) {
  const b = bookFor(o.leagueId, o.marketId)
  const list = isBid(o) ? b.bids : b.asks
  const yp = yesPrice(o)
  const better = (x: Order) => (isBid(o) ? yesPrice(x) >= yp : yesPrice(x) <= yp)
  let i = 0
  while (i < list.length && better(list[i])) i++
  list.splice(i, 0, o)
}

function removeFromBook(o: Order) {
  const b = books.get(bookKey(o.leagueId, o.marketId))
  if (!b) return
  for (const list of [b.bids, b.asks]) {
    const i = list.indexOf(o)
    if (i >= 0) list.splice(i, 1)
  }
}

const volumeIndex = new Map<string, number>()
const tradeNotional = (t: Trade) => t.size * (t.takerOutcome === 'yes' ? t.yesPrice : 1 - t.yesPrice)
export const leagueVolume = (leagueId: string, marketId: string) => money(volumeIndex.get(bookKey(leagueId, marketId)) ?? 0)

export function rebuildBooks() {
  books.clear()
  volumeIndex.clear()
  for (const t of db.trades) volumeIndex.set(bookKey(t.leagueId, t.marketId), (volumeIndex.get(bookKey(t.leagueId, t.marketId)) ?? 0) + tradeNotional(t))
  const open = [...db.orders.values()].filter((o) => o.status === 'open').sort((a, b) => a.createdAt - b.createdAt)
  for (const o of open) {
    const league = db.leagues.get(o.leagueId)
    if (league?.mode === 'exchange') insert(o)
  }
}

/** Aggregated league book in YES terms (asks ascending, bids descending). */
export function leagueBook(leagueId: string, marketId: string): Book {
  const b = books.get(bookKey(leagueId, marketId))
  const agg = (list: Order[]) => {
    const out: { price: number; size: number }[] = []
    for (const o of list) {
      const p = yesPrice(o)
      const rem = shares(o.size - o.filled)
      const last = out[out.length - 1]
      if (last && last.price === p) last.size = shares(last.size + rem)
      else out.push({ price: p, size: rem })
    }
    return out
  }
  return { bids: b ? agg(b.bids) : [], asks: b ? agg(b.asks) : [] }
}

/* ---------------- accounts ---------------- */

export function getMember(leagueId: string, userId: string) {
  return db.members.get(memberKey(leagueId, userId)) ?? fail(403, 'Not a member of this league')
}

export function getPosition(leagueId: string, userId: string, marketId: string): Position {
  const k = positionKey(leagueId, userId, marketId)
  let p = db.positions.get(k)
  if (!p) {
    p = { leagueId, userId, marketId, yes: 0, no: 0, yesCost: 0, noCost: 0, realized: 0 }
    db.positions.set(k, p)
  }
  return p
}

export function openOrders(leagueId: string, userId?: string) {
  return [...db.orders.values()].filter(
    (o) => o.status === 'open' && o.leagueId === leagueId && (!userId || o.userId === userId),
  )
}

/** cash not reserved by resting buy orders */
export function availableCash(leagueId: string, userId: string) {
  const m = getMember(leagueId, userId)
  let reserved = 0
  for (const o of openOrders(leagueId, userId)) if (o.side === 'buy') reserved += (o.size - o.filled) * o.price
  return money(m.cash - reserved)
}

export function availableShares(leagueId: string, userId: string, marketId: string, outcome: Outcome) {
  const p = db.positions.get(positionKey(leagueId, userId, marketId))
  let held = p ? p[outcome] : 0
  for (const o of openOrders(leagueId, userId)) {
    if (o.marketId === marketId && o.side === 'sell' && o.outcome === outcome) held -= o.size - o.filled
  }
  return shares(held)
}

/* ---------------- league market availability ---------------- */

export function marketEnabled(league: League, m: PMMarket) {
  if (league.disabledMarkets.includes(m.id)) return false
  if (league.marketScope === 'curated' && !league.enabledEvents.includes(m.eventId)) return false
  return true
}

export function eventEnabled(league: League, eventId: string) {
  return league.marketScope === 'all' || league.enabledEvents.includes(eventId)
}

/* ---------------- prices ---------------- */

/** price used for the YES outcome inside a league (cards, marks, leaderboard) */
export function leagueYesPrice(league: League, m: PMMarket) {
  if (m.resolved && m.payout) return m.payout[0]
  if (league.mode === 'mirror') return displayPrice(m)
  const b = leagueBook(league.id, m.id)
  const bid = b.bids[0]?.price
  const ask = b.asks[0]?.price
  if (bid !== undefined && ask !== undefined) return px((bid + ask) / 2)
  const last = lastLeagueTrade(league.id, m.id)
  if (last) return last.yesPrice
  return displayPrice(m)
}

export function lastLeagueTrade(leagueId: string, marketId: string): Trade | undefined {
  for (let i = db.trades.length - 1; i >= 0; i--) {
    const t = db.trades[i]
    if (t.leagueId === leagueId && t.marketId === marketId) return t
  }
  return undefined
}

/* ---------------- fills ---------------- */

function applyFill(o: Order, q: number, op: number) {
  const m = getMember(o.leagueId, o.userId)
  const pos = getPosition(o.leagueId, o.userId, o.marketId)
  const costKey = o.outcome === 'yes' ? 'yesCost' : 'noCost'
  const value = money(op * q)
  if (o.side === 'buy') {
    m.cash = money(m.cash - value)
    pos[o.outcome] = shares(pos[o.outcome] + q)
    pos[costKey] = money(pos[costKey] + value)
  } else {
    const held = pos[o.outcome]
    const avg = held > 0 ? pos[costKey] / held : 0
    m.cash = money(m.cash + value)
    pos[o.outcome] = shares(held - q)
    pos[costKey] = pos[o.outcome] <= 0 ? 0 : money(pos[costKey] - avg * q)
    pos.realized = money(pos.realized + value - avg * q)
  }
  o.filled = shares(o.filled + q)
  o.notional = money(o.notional + value)
  o.updatedAt = now()
}

function recordTrade(taker: Order, maker: Order | null, q: number, yp: number) {
  const t: Trade = {
    id: id('trd'),
    leagueId: taker.leagueId,
    marketId: taker.marketId,
    yesPrice: yp,
    size: q,
    takerOrderId: taker.id,
    makerOrderId: maker?.id ?? null,
    takerUserId: taker.userId,
    makerUserId: maker?.userId ?? null,
    takerSide: taker.side,
    takerOutcome: taker.outcome,
    ...(maker ? { makerSide: maker.side, makerOutcome: maker.outcome } : {}),
    ts: now(),
  }
  db.trades.push(t)
  volumeIndex.set(bookKey(t.leagueId, t.marketId), (volumeIndex.get(bookKey(t.leagueId, t.marketId)) ?? 0) + tradeNotional(t))
  emit({ type: 'trade', leagueId: t.leagueId, marketId: t.marketId, data: t })
  return t
}

export interface PlaceOrderInput {
  leagueId: string
  userId: string
  marketId: string
  side: Side
  outcome: Outcome
  type: OrderType
  /** limit price of the chosen outcome, 0..1 (limit orders) */
  price?: number
  /** shares (limit orders and market sells) */
  size?: number
  /** dollars to spend (market buys) */
  amount?: number
  source: OrderSource
}

export interface PlaceOrderResult {
  order: Order
  fills: { price: number; size: number }[]
  avgPrice: number | null
}

function roundToTick(p: number, tick: number) {
  const t = Math.max(tick, 0.001)
  return px(Math.round(p / t) * t)
}

async function validate(input: PlaceOrderInput) {
  const league = db.leagues.get(input.leagueId) ?? fail(404, 'League not found')
  getMember(league.id, input.userId)
  if (input.side !== 'buy' && input.side !== 'sell') fail(400, 'side must be buy or sell')
  if (input.outcome !== 'yes' && input.outcome !== 'no') fail(400, 'outcome must be yes or no')
  if (input.type !== 'limit' && input.type !== 'market') fail(400, 'type must be limit or market')
  const market = (await marketById(input.marketId)) ?? fail(404, 'Market not found')
  if (!market.active || market.resolved) fail(400, 'Market is closed for trading')
  if (!marketEnabled(league, market) && input.userId !== HOUSE_USER) fail(400, 'This market is turned off in your league')
  if (db.settlements.has(settlementKey(league.id, market.id))) fail(400, 'Market already settled in this league')
  return { league, market }
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const { league, market } = await validate(input)
  const tick = market.tick
  const o: Order = {
    id: id('ord'),
    leagueId: league.id,
    userId: input.userId,
    marketId: market.id,
    side: input.side,
    outcome: input.outcome,
    type: input.type,
    price: 0,
    size: 0,
    filled: 0,
    notional: 0,
    status: 'open',
    source: input.source,
    createdAt: now(),
    updatedAt: now(),
  }
  let budget = Infinity
  if (input.type === 'limit') {
    const price = Number(input.price)
    const size = shares(Number(input.size))
    if (!(price > 0 && price < 1)) fail(400, 'price must be between 0 and 1 (e.g. 0.42 for 42¢)')
    if (!(size >= 0.01)) fail(400, 'size must be at least 0.01 shares')
    o.price = Math.min(1 - tick, Math.max(tick, roundToTick(price, tick)))
    o.size = size
  } else if (input.side === 'buy') {
    const amount = money(Number(input.amount ?? (input.size && input.price ? input.size * input.price : NaN)))
    if (!(amount >= 0.01)) fail(400, 'amount (dollars to spend) must be at least $0.01')
    budget = amount
    o.price = 1 - tick // worst acceptable price
    o.size = Infinity
  } else {
    const size = shares(Number(input.size))
    if (!(size >= 0.01)) fail(400, 'size must be at least 0.01 shares')
    o.price = tick
    o.size = size
  }

  if (o.side === 'buy') {
    const need = input.type === 'limit' ? o.price * o.size : budget
    const avail = availableCash(league.id, o.userId)
    if (need > avail + 1e-9) fail(400, `Insufficient cash: need $${need.toFixed(2)}, available $${avail.toFixed(2)}`)
  } else {
    const avail = availableShares(league.id, o.userId, market.id, o.outcome)
    if (o.size > avail + 1e-9) fail(400, `Insufficient ${o.outcome.toUpperCase()} shares: have ${avail}`)
  }

  const fills = league.mode === 'exchange' ? matchExchange(o, budget) : await matchMirror(o, market, budget)

  if (input.type === 'market') {
    o.size = o.filled
    o.status = o.filled > 0 ? 'filled' : 'cancelled'
    if (!fills.length) fail(400, 'No liquidity available for a market order right now')
  } else if (o.filled >= o.size - 1e-9) {
    o.status = 'filled'
  } else if (league.mode === 'exchange') {
    insert(o)
  }
  db.orders.set(o.id, o)
  markDirty()

  const filledShares = fills.reduce((s, f) => s + f.size, 0)
  if (filledShares > 0 && o.userId !== HOUSE_USER) {
    logActivity(league.id, o.userId, 'trade',
      `${o.side === 'buy' ? 'Bought' : 'Sold'} ${filledShares.toFixed(1)} ${market.outcomes[o.outcome === 'yes' ? 0 : 1]} · ${market.groupTitle} at ${Math.round((o.notional / o.filled) * 100)}¢`,
      market.id)
  }
  emit({ type: 'orders', leagueId: league.id, marketId: market.id, userId: o.userId })
  if (league.mode === 'exchange') emit({ type: 'book', leagueId: league.id, marketId: market.id })
  return { order: o, fills, avgPrice: o.filled > 0 ? px(o.notional / o.filled) : null }
}

function matchExchange(taker: Order, budget: number) {
  const fills: { price: number; size: number }[] = []
  const bid = isBid(taker)
  const limitYes = yesPrice(taker)
  const b = bookFor(taker.leagueId, taker.marketId)
  const opp = bid ? b.asks : b.bids
  let spent = 0
  for (const maker of [...opp]) {
    const remaining = taker.size - taker.filled
    if (remaining <= 1e-9 || budget - spent <= 1e-6) break
    const myp = yesPrice(maker)
    if (bid ? myp > limitYes + 1e-9 : myp < limitYes - 1e-9) break
    if (maker.userId === taker.userId) continue
    const op = outcomePrice(taker.outcome, myp)
    let q = Math.min(remaining, maker.size - maker.filled)
    if (Number.isFinite(budget)) q = Math.min(q, (budget - spent) / op)
    q = shares(q)
    if (q <= 0) break
    applyFill(taker, q, op)
    applyFill(maker, q, outcomePrice(maker.outcome, myp))
    spent += op * q
    if (maker.filled >= maker.size - 1e-9) {
      maker.status = 'filled'
      removeFromBook(maker)
    }
    emit({ type: 'orders', leagueId: maker.leagueId, marketId: maker.marketId, userId: maker.userId })
    recordTrade(taker, maker, q, myp)
    fills.push({ price: op, size: q })
  }
  return fills
}

/** Mirror mode: fill against Polymarket's live book for the outcome token. */
async function matchMirror(o: Order, market: PMMarket, budget: number) {
  const book = await pmBook(market, o.outcome, 1500)
  return fillMirrorFromBook(o, book, budget)
}

function fillMirrorFromBook(o: Order, book: Book, budget: number) {
  const fills: { price: number; size: number }[] = []
  const levels = o.side === 'buy' ? book.asks : book.bids
  let spent = 0
  // re-check funds synchronously; the book fetch above may have taken a while
  if (o.side === 'buy' && Number.isFinite(budget)) budget = Math.min(budget, availableCash(o.leagueId, o.userId))
  for (const lvl of levels) {
    const remaining = o.size - o.filled
    if (remaining <= 1e-9 || budget - spent <= 1e-6) break
    if (o.side === 'buy' ? lvl.price > o.price + 1e-9 : lvl.price < o.price - 1e-9) break
    let q = Math.min(remaining, lvl.size)
    if (Number.isFinite(budget)) q = Math.min(q, (budget - spent) / lvl.price)
    q = shares(q)
    if (q <= 0) break
    applyFill(o, q, lvl.price)
    spent += lvl.price * q
    recordTrade(o, null, q, outcomePrice(o.outcome, lvl.price))
    fills.push({ price: lvl.price, size: q })
  }
  return fills
}

/** Resting limit orders in mirror leagues fill once Polymarket's book crosses them. */
export async function sweepMirrorOrders() {
  const byMarket = new Map<string, Order[]>()
  for (const o of db.orders.values()) {
    if (o.status !== 'open') continue
    if (db.leagues.get(o.leagueId)?.mode !== 'mirror') continue
    const k = `${o.marketId}:${o.outcome}`
    byMarket.set(k, [...(byMarket.get(k) ?? []), o])
  }
  for (const [k, orders] of byMarket) {
    const [marketId, outcome] = k.split(':') as [string, Outcome]
    const market = catalog.markets.get(marketId)
    if (!market || !market.active) continue
    const book = await pmBook(market, outcome, 5000)
    for (const o of orders.sort((a, b) => a.createdAt - b.createdAt)) {
      if (o.status !== 'open') continue
      const before = o.filled
      fillMirrorFromBook(o, book, Infinity)
      if (o.filled > before) {
        if (o.filled >= o.size - 1e-9) o.status = 'filled'
        markDirty()
        logActivity(o.leagueId, o.userId, 'trade',
          `Limit ${o.side} filled: ${(o.filled - before).toFixed(1)} ${market.outcomes[o.outcome === 'yes' ? 0 : 1]} · ${market.groupTitle} at ${Math.round(o.price * 100)}¢`,
          market.id)
        emit({ type: 'orders', leagueId: o.leagueId, marketId, userId: o.userId })
      }
    }
  }
}

export function cancelOrder(orderId: string, userId: string) {
  const o = db.orders.get(orderId) ?? fail(404, 'Order not found')
  if (o.userId !== userId) fail(403, 'Not your order')
  if (o.status !== 'open') fail(400, `Order is already ${o.status}`)
  o.status = 'cancelled'
  o.updatedAt = now()
  removeFromBook(o)
  markDirty()
  emit({ type: 'orders', leagueId: o.leagueId, marketId: o.marketId, userId })
  emit({ type: 'book', leagueId: o.leagueId, marketId: o.marketId })
  return o
}

export function cancelAll(leagueId: string, userId: string, marketId?: string) {
  const out: Order[] = []
  for (const o of openOrders(leagueId, userId)) if (!marketId || o.marketId === marketId) out.push(cancelOrder(o.id, userId))
  return out
}

/* ---------------- settlement ---------------- */

export function settleMarket(market: PMMarket) {
  if (!market.resolved || !market.payout) return 0
  const payout = market.payout
  const leagues = new Set<string>()
  for (const p of db.positions.values()) if (p.marketId === market.id && (p.yes > 0 || p.no > 0)) leagues.add(p.leagueId)
  for (const o of db.orders.values()) if (o.marketId === market.id && o.status === 'open') leagues.add(o.leagueId)
  let settled = 0
  for (const leagueId of leagues) {
    const key = settlementKey(leagueId, market.id)
    if (db.settlements.has(key)) continue
    for (const o of db.orders.values()) {
      if (o.leagueId === leagueId && o.marketId === market.id && o.status === 'open') {
        o.status = 'cancelled'
        o.updatedAt = now()
        removeFromBook(o)
      }
    }
    for (const p of db.positions.values()) {
      if (p.leagueId !== leagueId || p.marketId !== market.id) continue
      const value = money(p.yes * payout[0] + p.no * payout[1])
      const member = db.members.get(memberKey(leagueId, p.userId))
      if (member) member.cash = money(member.cash + value)
      p.realized = money(p.realized + value - p.yesCost - p.noCost)
      p.yes = p.no = p.yesCost = p.noCost = 0
    }
    db.settlements.set(key, { leagueId, marketId: market.id, payout, ts: now() })
    const winner = payout[0] === 1 ? market.outcomes[0] : payout[1] === 1 ? market.outcomes[1] : '50/50'
    logActivity(leagueId, '', 'resolve', `${market.groupTitle !== market.question ? `${market.groupTitle}: ` : ''}${market.question} resolved ${winner}`, market.id)
    emit({ type: 'resolve', leagueId, marketId: market.id })
    settled++
  }
  if (settled) markDirty()
  return settled
}

/* ---------------- portfolio ---------------- */

export function portfolio(leagueId: string, userId: string) {
  const league = db.leagues.get(leagueId) ?? fail(404, 'League not found')
  const member = getMember(leagueId, userId)
  const positions = []
  let positionsValue = 0
  let realized = 0
  for (const p of db.positions.values()) {
    if (p.leagueId !== leagueId || p.userId !== userId) continue
    realized += p.realized
    if (p.yes <= 0 && p.no <= 0) continue
    const market = catalog.markets.get(p.marketId)
    const yp = market ? leagueYesPrice(league, market) : 0.5
    for (const outcome of ['yes', 'no'] as const) {
      const size = p[outcome]
      if (size <= 0) continue
      const cost = outcome === 'yes' ? p.yesCost : p.noCost
      const price = outcome === 'yes' ? yp : px(1 - yp)
      const value = money(size * price)
      positionsValue += value
      const event = market ? catalog.events.get(market.eventId) : undefined
      positions.push({
        marketId: p.marketId,
        eventSlug: event?.slug ?? null,
        eventTitle: event?.title ?? null,
        question: market?.question ?? p.marketId,
        title: market?.groupTitle ?? p.marketId,
        image: market?.image || event?.icon || '',
        outcome,
        outcomeLabel: market ? market.outcomes[outcome === 'yes' ? 0 : 1] : outcome,
        size,
        avgPrice: size > 0 ? px(cost / size) : 0,
        curPrice: price,
        cost: money(cost),
        value,
        pnl: money(value - cost),
        pnlPct: cost > 0 ? (value - cost) / cost : 0,
        resolved: market?.resolved ?? false,
        endDate: market?.endDate ?? null,
      })
    }
  }
  positions.sort((a, b) => b.value - a.value)
  const perps = perpSummary(leagueId, userId)
  const value = money(member.cash + positionsValue + perps.equity)
  return {
    cash: member.cash,
    availableCash: availableCash(leagueId, userId),
    positionsValue: money(positionsValue),
    perpsValue: perps.equity,
    value,
    pnl: money(value - league.startingBalance),
    realized: money(realized + perps.realized),
    positions,
    perps: perps.positions,
  }
}

// The league leaderboard lives in leaderboard.ts (periods, sorting, other P&L sources via registerPnlSource).

export function logActivity(leagueId: string, userId: string, kind: Activity['kind'], text: string, marketId?: string) {
  db.activity.push({ id: id('act'), leagueId, userId, kind, text, marketId, ts: now() })
  emit({ type: 'activity', leagueId })
}
