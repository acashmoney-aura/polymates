import { EventEmitter } from 'node:events'
import { catalog, displayPrice } from './polymarket.ts'

/**
 * Live Polymarket prices. We hold a few websocket connections to Polymarket's public market channel,
 * subscribed to the YES token of every active market in the catalog, and apply best bid/ask and last
 * trade updates to the catalog as they arrive. Displayed-price changes are batched once a second and
 * fanned out to browsers over SSE (/api/live). We also keep an hour of price ticks per market, which
 * is what "most volatile" and "1h move" sort on.
 */

const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market'
const TOKENS_PER_SOCKET = 400
// each subscribed market costs CPU on every book change; the top 3000 cover what people browse
const MAX_TOKENS = 3000
const WINDOW_MS = 60 * 60_000
const SAMPLE_MS = 5_000

export const live = new EventEmitter()
live.setMaxListeners(0)

/** yes token -> market id */
const tokenToMarket = new Map<string, string>()
/** market id -> [ts, price] samples over the last hour, oldest first */
const ticks = new Map<string, [number, number][]>()
const changed = new Set<string>()
const sockets: Slot[] = []
let messages = 0

function sample(id: string, price: number, now = Date.now()) {
  let arr = ticks.get(id)
  if (!arr) ticks.set(id, (arr = []))
  const last = arr[arr.length - 1]
  if (last && now - last[0] < SAMPLE_MS) last[1] = price
  else arr.push([now, price])
  while (arr.length && now - arr[0][0] > WINDOW_MS) arr.shift()
}

function apply(token: string, patch: { bid?: number; ask?: number; last?: number }) {
  const id = tokenToMarket.get(token)
  const m = id ? catalog.markets.get(id) : undefined
  if (!m || !id) return
  const before = displayPrice(m)
  if (patch.bid !== undefined && Number.isFinite(patch.bid)) m.bestBid = patch.bid
  if (patch.ask !== undefined && Number.isFinite(patch.ask)) m.bestAsk = patch.ask
  if (patch.last !== undefined && Number.isFinite(patch.last)) m.lastTrade = patch.last
  const after = displayPrice(m)
  // wide books flip the displayed price between midpoint and last trade; don't count that as volatility
  if (m.bestBid !== null && m.bestAsk !== null && m.bestAsk - m.bestBid <= 0.05) sample(id, after)
  if (Math.abs(after - before) > 1e-9 || patch.last !== undefined) changed.add(id)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function onMessage(raw: string) {
  messages++
  let data: any
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }
  for (const msg of Array.isArray(data) ? data : [data]) {
    if (msg.price_changes) {
      for (const c of msg.price_changes) apply(String(c.asset_id), { bid: Number(c.best_bid), ask: Number(c.best_ask) })
    } else if (msg.event_type === 'last_trade_price') {
      apply(String(msg.asset_id), { last: Number(msg.price) })
    } else if (msg.bids && msg.asks) {
      const bid = Math.max(0, ...msg.bids.map((l: any) => Number(l.price)))
      const ask = Math.min(1, ...msg.asks.map((l: any) => Number(l.price)))
      apply(String(msg.asset_id), { bid: bid || undefined, ask: ask < 1 ? ask : undefined })
    }
  }
}

type Slot = { ws: WebSocket; tokens: string[]; alive: boolean }

/**
 * Connects (or reconnects) a slot's socket. Reconnects reuse the same slot object, so when resubscribe() sets
 * alive=false and closes it, nothing reconnects. (Reconnecting into a fresh slot used to orphan sockets that
 * resubscribe() could no longer see: they kept streaming and reconnecting forever, and after a few days the
 * server was handling ~46k messages/sec at idle.)
 */
function connect(slot: Slot) {
  const ws = new WebSocket(WS_URL)
  slot.ws = ws
  ws.onopen = () => ws.send(JSON.stringify({ assets_ids: slot.tokens, type: 'market' }))
  ws.onmessage = (e) => {
    // a socket that's been replaced or retired must not keep feeding the catalog
    if (slot.alive && slot.ws === ws) onMessage(String(e.data))
  }
  ws.onclose = () => {
    if (slot.alive && slot.ws === ws) setTimeout(() => { if (slot.alive && slot.ws === ws) connect(slot) }, 3000)
  }
  ws.onerror = () => ws.close()
}

function open(tokens: string[]) {
  const slot = { tokens, alive: true } as Slot
  connect(slot)
  return slot
}

/** (Re)subscribe to the YES token of every active catalog market, most-traded events first. */
export function resubscribe() {
  const events = [...catalog.events.values()].filter((e) => !e.closed).sort((a, b) => a.rank - b.rank)
  const wanted: string[] = []
  tokenToMarket.clear()
  for (const e of events) {
    for (const id of e.marketIds) {
      const m = catalog.markets.get(id)
      if (!m?.active || !m.tokenYes) continue
      tokenToMarket.set(m.tokenYes, m.id)
      if (!ticks.has(m.id)) sample(m.id, displayPrice(m))
      wanted.push(m.tokenYes)
      if (wanted.length >= MAX_TOKENS) break
    }
    if (wanted.length >= MAX_TOKENS) break
  }
  const current = sockets.flatMap((s) => s.tokens)
  if (current.length === wanted.length && current.every((t, i) => t === wanted[i])) return
  for (const s of sockets.splice(0)) {
    s.alive = false
    s.ws.close()
  }
  for (let i = 0; i < wanted.length; i += TOKENS_PER_SOCKET) sockets.push(open(wanted.slice(i, i + TOKENS_PER_SOCKET)))
  console.log(`[live] ${wanted.length} markets on ${sockets.length} sockets`)
}

export function startLive() {
  resubscribe()
  setInterval(() => {
    if (!changed.size) return
    const updates = [...changed].map((id) => {
      const m = catalog.markets.get(id)!
      return [id, round(displayPrice(m)), m.bestBid, m.bestAsk, m.lastTrade] as const
    })
    changed.clear()
    live.emit('prices', { t: Date.now(), u: updates })
  }, 1000).unref()
  // keep the hour windows rolling for markets that went quiet
  setInterval(() => {
    const now = Date.now()
    for (const [id, arr] of ticks) {
      const m = catalog.markets.get(id)
      if (!m?.active) ticks.delete(id)
      else sample(id, displayPrice(m), now)
    }
  }, 60_000).unref()
}

const round = (p: number) => Math.round(p * 10_000) / 10_000

/** Price move and high-low range over the last hour, from the live tick window. */
export function liveStats(marketId: string) {
  const arr = ticks.get(marketId)
  if (!arr || arr.length < 2) return { move1h: 0, range1h: 0 }
  let lo = 1
  let hi = 0
  for (const [, p] of arr) {
    lo = Math.min(lo, p)
    hi = Math.max(hi, p)
  }
  return { move1h: round(arr[arr.length - 1][1] - arr[0][1]), range1h: round(hi - lo) }
}

export function liveStatus() {
  return { markets: tokenToMarket.size, sockets: sockets.length, open: sockets.filter((s) => s.ws.readyState === WebSocket.OPEN).length, messages }
}
