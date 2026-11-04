import type { Book, GameInfo, Outcome, PMEvent, PMMarket } from './types.ts'
import { fetchJson } from './util.ts'

const GAMMA = 'https://gamma-api.polymarket.com'
const CLOB = 'https://clob.polymarket.com'

export const CATEGORIES = [
  { slug: 'politics', label: 'Politics' },
  { slug: 'sports', label: 'Sports' },
  { slug: 'crypto', label: 'Crypto' },
  { slug: 'esports', label: 'Esports' },
  { slug: 'finance', label: 'Finance' },
  { slug: 'geopolitics', label: 'Geopolitics' },
  { slug: 'tech', label: 'Tech' },
  { slug: 'elections', label: 'Elections' },
  { slug: 'pop-culture', label: 'Culture' },
  { slug: 'economy', label: 'Economy' },
  { slug: 'weather', label: 'Weather' },
  { slug: 'mentions', label: 'Mentions' },
  { slug: 'world', label: 'World' },
]

export const catalog = {
  events: new Map<string, PMEvent>(),
  slugs: new Map<string, string>(),
  markets: new Map<string, PMMarket>(),
  syncedAt: 0,
  /** event id -> last time someone opened it by slug; recently viewed events survive pruning */
  viewed: new Map<string, number>(),
}

/** let queued requests run between big chunks of parsing */
const breathe = () => new Promise<void>((r) => setImmediate(r))
const VIEW_KEEP_MS = 60 * 60_000

/* eslint-disable @typescript-eslint/no-explicit-any */
const parseArr = (v: unknown): any[] => {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') {
    try {
      return JSON.parse(v)
    } catch {
      return []
    }
  }
  return []
}
const num = (v: unknown, d = 0) => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : d
}
const numOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : num(v, NaN)) as number | null

function parseMarket(m: any, eventId: string): PMMarket | null {
  const tokens = parseArr(m.clobTokenIds)
  const outcomes = parseArr(m.outcomes)
  if (tokens.length !== 2 || outcomes.length !== 2) return null
  const prices = parseArr(m.outcomePrices).map((p) => num(p))
  const closed = Boolean(m.closed)
  const resolvedPrices = prices.length === 2 && prices.every((p) => p === 0 || p === 1 || p === 0.5) && prices[0] + prices[1] === 1
  const resolved = closed && (m.umaResolutionStatus === 'resolved' || resolvedPrices)
  return {
    id: String(m.id),
    conditionId: String(m.conditionId ?? ''),
    eventId,
    slug: String(m.slug ?? ''),
    question: String(m.question ?? ''),
    groupTitle: String(m.groupItemTitle ?? '') || String(m.question ?? ''),
    image: String(m.icon ?? m.image ?? ''),
    tokenYes: String(tokens[0]),
    tokenNo: String(tokens[1]),
    outcomes: [String(outcomes[0]), String(outcomes[1])],
    price: prices[0] ?? 0.5,
    bestBid: numOrNull(m.bestBid),
    bestAsk: numOrNull(m.bestAsk),
    lastTrade: numOrNull(m.lastTradePrice),
    change24h: numOrNull(m.oneDayPriceChange),
    volume: num(m.volumeNum ?? m.volume),
    volume24h: num(m.volume24hr),
    endDate: m.endDate ?? null,
    tick: num(m.orderPriceMinTickSize, 0.01) || 0.01,
    active: Boolean(m.active) && !closed && m.acceptingOrders !== false,
    closed,
    resolved,
    payout: resolved && prices.length === 2 ? [prices[0], prices[1]] : null,
    description: String(m.description ?? ''),
    threshold: num(m.groupItemThreshold, 0),
    sportsMarketType: m.sportsMarketType ? String(m.sportsMarketType) : null,
    line: numOrNull(m.line),
  }
}

function parseGame(e: any): GameInfo | null {
  const teams = Array.isArray(e.teams) ? e.teams : []
  if (teams.length !== 2) return null
  return {
    teams: teams.map((t: any) => ({
      name: String(t.name ?? ''),
      abbr: String(t.abbreviation ?? t.name ?? '').toUpperCase(),
      logo: String(t.logo ?? ''),
      color: String(t.color ?? ''),
    })),
    score: e.score ? String(e.score) : null,
    period: e.period ? String(e.period) : null,
    live: Boolean(e.live),
    ended: Boolean(e.ended),
    startTime: e.startTime ?? e.eventMetadata?.originalStart ?? null,
    league: e.eventMetadata?.league ? String(e.eventMetadata.league) : null,
  }
}

export function ingestEvent(e: any, rank: number): PMEvent | null {
  const markets = (Array.isArray(e.markets) ? e.markets : [])
    .map((m: any) => parseMarket(m, String(e.id)))
    .filter(Boolean) as PMMarket[]
  if (!markets.length) return null
  for (const m of markets) catalog.markets.set(m.id, m)
  // Polymarket shows open markets first, ordered by their group threshold
  markets.sort((a, b) => Number(a.closed) - Number(b.closed) || a.threshold - b.threshold)
  const prev = catalog.events.get(String(e.id))
  const ev: PMEvent = {
    id: String(e.id),
    slug: String(e.slug),
    title: String(e.title ?? ''),
    description: String(e.description ?? ''),
    image: String(e.image ?? e.icon ?? ''),
    icon: String(e.icon ?? e.image ?? ''),
    tags: (Array.isArray(e.tags) ? e.tags : []).map((t: any) => ({ slug: String(t.slug), label: String(t.label) })),
    marketIds: markets.map((m) => m.id),
    volume: num(e.volume),
    volume24h: num(e.volume24hr),
    liquidity: num(e.liquidity),
    endDate: e.endDate ?? null,
    startDate: e.startDate ?? null,
    createdAt: e.createdAt ?? null,
    negRisk: Boolean(e.negRisk),
    closed: Boolean(e.closed),
    commentCount: num(e.commentCount),
    resolutionSource: String(e.resolutionSource ?? ''),
    rank: rank >= 0 ? rank : (prev?.rank ?? 1e9),
    game: parseGame(e),
    fetchedAt: Date.now(),
  }
  catalog.events.set(ev.id, ev)
  catalog.slugs.set(ev.slug, ev.id)
  return ev
}

let syncing: Promise<void> | null = null

/**
 * Pull the most active events (plus each category's top 100) from Gamma. Pages are fetched and ingested one
 * at a time with a yield in between, so a sync never holds the event loop for long. Events that dropped out
 * are removed afterwards unless someone holds one of their markets or opened them recently; otherwise the
 * catalog only ever grows and every list, sort and resubscribe gets slower.
 */
export function syncCatalog(held: () => Set<string> = () => new Set()) {
  if (syncing) return syncing
  syncing = (async () => {
    const t0 = Date.now()
    let rank = 0
    const base = `${GAMMA}/events?active=true&closed=false&archived=false&order=volume24hr&ascending=false&limit=100`
    const seen = new Set<string>()
    let failed = false
    const ingestRows = async (rows: any[], rankOf: (e: any) => number | null) => {
      for (let i = 0; i < rows.length; i++) {
        const e = rows[i]
        if (seen.has(String(e.id))) continue
        const r = rankOf(e)
        if (r !== null && ingestEvent(e, r)) seen.add(String(e.id))
        if (i % 25 === 24) await breathe()
      }
    }
    for (let page = 0; page < 6; page++) {
      try {
        const rows = await fetchJson<any[]>(`${base}&offset=${page * 100}`, 20_000)
        await ingestRows(rows, () => rank++)
        if (rows.length < 100) break
      } catch (err) {
        failed = true
        console.warn('[catalog] page failed', page, (err as Error).message)
      }
      await breathe()
    }
    for (const c of CATEGORIES) {
      try {
        const rows = await fetchJson<any[]>(`${base}&tag_slug=${c.slug}`, 20_000)
        await ingestRows(rows, (e) => 10_000 + num(1e9 - num(e.volume24hr)))
      } catch (err) {
        failed = true
        console.warn('[catalog] tag failed', c.slug, (err as Error).message)
      }
      await breathe()
    }
    // only prune after a complete sync, so a Gamma hiccup can't empty the catalog
    let pruned = 0
    if (!failed && seen.size > 100) {
      const keepMarkets = held()
      const now = Date.now()
      for (const [id, e] of catalog.events) {
        if (seen.has(id)) continue
        if (now - (catalog.viewed.get(id) ?? 0) < VIEW_KEEP_MS) continue
        if (e.marketIds.some((m) => keepMarkets.has(m))) continue
        for (const m of e.marketIds) if (!keepMarkets.has(m)) catalog.markets.delete(m)
        catalog.events.delete(id)
        if (catalog.slugs.get(e.slug) === id) catalog.slugs.delete(e.slug)
        catalog.viewed.delete(id)
        pruned++
      }
    }
    catalog.syncedAt = Date.now()
    console.log(`[catalog] ${catalog.events.size} events / ${catalog.markets.size} markets in ${Date.now() - t0}ms${pruned ? `, pruned ${pruned}` : ''}`)
  })().finally(() => {
    syncing = null
  })
  return syncing
}

export async function eventBySlug(slug: string): Promise<PMEvent | null> {
  const known = catalog.slugs.get(slug)
  const ev = known ? catalog.events.get(known) : undefined
  if (ev) catalog.viewed.set(ev.id, Date.now())
  // live games change score and lines by the minute, so refetch them more often than the catalog sync
  const stale = ev?.game && !ev.game.ended && !ev.closed && Date.now() - ev.fetchedAt > 15_000
  if (ev && !stale) return ev
  if (ev) {
    try {
      const rows = await fetchJson<any[]>(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`, 6000)
      return (rows[0] && ingestEvent(rows[0], -1)) || ev
    } catch {
      return ev
    }
  }
  const rows = await fetchJson<any[]>(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`)
  const fresh = rows[0] ? ingestEvent(rows[0], -1) : null
  if (fresh) catalog.viewed.set(fresh.id, Date.now())
  return fresh
}

export async function eventById(id: string): Promise<PMEvent | null> {
  const known = catalog.events.get(id)
  if (known) return known
  const rows = await fetchJson<any[]>(`${GAMMA}/events?id=${encodeURIComponent(id)}`)
  return rows[0] ? ingestEvent(rows[0], -1) : null
}

/** Loads markets missing from the catalog (and refreshes the given ones). Used by resolution + lookups. */
export async function refreshMarkets(ids: string[]) {
  const unique = [...new Set(ids)]
  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40)
    const qs = chunk.map((x) => `id=${encodeURIComponent(x)}`).join('&')
    for (const closed of ['false', 'true']) {
      try {
        const rows = await fetchJson<any[]>(`${GAMMA}/markets?${qs}&closed=${closed}&limit=100`)
        for (const m of rows) {
          const eventId = String(m.events?.[0]?.id ?? catalog.markets.get(String(m.id))?.eventId ?? '')
          const parsed = parseMarket(m, eventId)
          if (parsed) catalog.markets.set(parsed.id, parsed)
          if (eventId && !catalog.events.has(eventId)) void eventById(eventId).catch(() => {})
        }
      } catch (err) {
        console.warn('[catalog] refresh failed', (err as Error).message)
      }
    }
  }
}

export async function marketById(id: string): Promise<PMMarket | null> {
  if (!catalog.markets.has(id)) await refreshMarkets([id])
  return catalog.markets.get(id) ?? null
}

/* ---------------- live CLOB data ---------------- */

const bookCache = new Map<string, { at: number; book: Book }>()

/** Polymarket's real order book for one outcome token, best price first. */
export async function pmBook(market: PMMarket, outcome: Outcome, maxAgeMs = 2500): Promise<Book> {
  const token = outcome === 'yes' ? market.tokenYes : market.tokenNo
  const hit = bookCache.get(token)
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.book
  try {
    const raw = await fetchJson<{ bids: { price: string; size: string }[]; asks: { price: string; size: string }[] }>(
      `${CLOB}/book?token_id=${token}`,
      6000,
    )
    const book: Book = {
      bids: raw.bids.map((l) => ({ price: num(l.price), size: num(l.size) })).sort((a, b) => b.price - a.price),
      asks: raw.asks.map((l) => ({ price: num(l.price), size: num(l.size) })).sort((a, b) => a.price - b.price),
    }
    bookCache.set(token, { at: Date.now(), book })
    const m = catalog.markets.get(market.id)
    if (m && outcome === 'yes') {
      m.bestBid = book.bids[0]?.price ?? m.bestBid
      m.bestAsk = book.asks[0]?.price ?? m.bestAsk
    }
    return book
  } catch {
    if (hit) return hit.book
    // fall back to a synthetic top-of-book from Gamma prices
    const p = outcome === 'yes' ? market.price : 1 - market.price
    const spread = 0.01
    return {
      bids: p > spread ? [{ price: Math.max(0.001, p - spread), size: 1000 }] : [],
      asks: p < 1 - spread ? [{ price: Math.min(0.999, p + spread), size: 1000 }] : [],
    }
  }
}

export function cachedPmBook(market: PMMarket, outcome: Outcome): Book | null {
  return bookCache.get(outcome === 'yes' ? market.tokenYes : market.tokenNo)?.book ?? null
}

const historyCache = new Map<string, { at: number; data: { t: number; p: number }[] }>()
const INTERVALS: Record<string, { interval: string; fidelity: number }> = {
  '1h': { interval: '1h', fidelity: 1 },
  '6h': { interval: '6h', fidelity: 1 },
  '1d': { interval: '1d', fidelity: 5 },
  '1w': { interval: '1w', fidelity: 30 },
  '1m': { interval: '1m', fidelity: 180 },
  all: { interval: 'max', fidelity: 720 },
}

export async function pmHistory(market: PMMarket, range: string) {
  const cfg = INTERVALS[range] ?? INTERVALS['1d']
  const key = `${market.tokenYes}:${cfg.interval}`
  const hit = historyCache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.data
  try {
    const raw = await fetchJson<{ history: { t: number; p: number }[] }>(
      `${CLOB}/prices-history?market=${market.tokenYes}&interval=${cfg.interval}&fidelity=${cfg.fidelity}`,
    )
    historyCache.set(key, { at: Date.now(), data: raw.history })
    if (historyCache.size > 2000) historyCache.delete(historyCache.keys().next().value!)
    return raw.history
  } catch {
    return hit?.data ?? []
  }
}

/** Polymarket-style displayed probability: midpoint unless the spread is wide, then last trade. */
export function displayPrice(m: PMMarket) {
  if (m.resolved && m.payout) return m.payout[0]
  if (m.bestBid !== null && m.bestAsk !== null && m.bestAsk - m.bestBid <= 0.1) return (m.bestBid + m.bestAsk) / 2
  return m.lastTrade ?? m.price
}
