import {
  cancelAll, cancelOrder, eventEnabled, getMember, HOUSE_USER, lastLeagueTrade, leagueBook, leagueVolume as leagueVolumeOf,
  leagueYesPrice, marketEnabled, placeOrder, portfolio,
} from './engine.ts'
import { touchMarket } from './house.ts'
import {
  biggestWins, leaderboard, leaderboardChart, memberProfile, parsePeriod, parseSort, pnlSources, type LeaderboardOptions,
} from './leaderboard.ts'
import { liveStats } from './live.ts'
import { catalog, CATEGORIES, displayPrice, eventBySlug, marketById, pmBook, pmHistory } from './polymarket.ts'
import { db, settlementKey } from './state.ts'
import type { League, OrderSource, Outcome, OrderType, PMEvent, PMMarket, Side } from './types.ts'
import { fail, money, px } from './util.ts'

/* ---------------- serialization ---------------- */

export function serializeMarket(m: PMMarket, league?: League) {
  const price = league ? leagueYesPrice(league, m) : displayPrice(m)
  let bestBid = m.bestBid
  let bestAsk = m.bestAsk
  let leagueVolume = 0
  let lastTrade = m.lastTrade
  if (league?.mode === 'exchange') {
    const b = leagueBook(league.id, m.id)
    bestBid = b.bids[0]?.price ?? null
    bestAsk = b.asks[0]?.price ?? null
    lastTrade = lastLeagueTrade(league.id, m.id)?.yesPrice ?? null
  }
  if (league) leagueVolume = leagueVolumeOf(league.id, m.id)
  return {
    id: m.id,
    eventId: m.eventId,
    question: m.question,
    title: m.groupTitle,
    image: m.image,
    outcomes: m.outcomes,
    price: px(price),
    polymarketPrice: px(displayPrice(m)),
    bestBid,
    bestAsk,
    lastTrade,
    change24h: m.change24h,
    volume: m.volume,
    volume24h: m.volume24h,
    leagueVolume: money(leagueVolume),
    endDate: m.endDate,
    tick: m.tick,
    active: m.active,
    resolved: m.resolved,
    payout: m.payout,
    settled: league ? db.settlements.has(settlementKey(league.id, m.id)) : false,
    enabled: league ? marketEnabled(league, m) : true,
    description: m.description,
    sportsMarketType: m.sportsMarketType,
    line: m.line,
    ...liveStats(m.id),
  }
}

/** sports lines a game card shows, kept even when a compact list trims the rest */
const CARD_LINES = /^(moneyline|spreads|totals|map_handicap|tennis_set_handicap|tennis_game_handicap|tennis_match_totals)$/
/** markets per event in a compact list: enough for a card and its top outcomes */
const COMPACT_MARKETS = 12

export function serializeEvent(e: PMEvent, league?: League, opts: { full?: boolean; compact?: boolean } = {}) {
  const markets = e.marketIds.map((mid) => catalog.markets.get(mid)).filter(Boolean) as PMMarket[]
  let visible = opts.full ? markets : markets.filter((m) => m.active || m.resolved)
  if (opts.compact && visible.length > COMPACT_MARKETS) {
    // cards show a few outcomes (or a game's main lines); event pages fetch everything separately
    const keep = new Set([
      ...visible.filter((m) => CARD_LINES.test(m.sportsMarketType ?? '')).map((m) => m.id),
      ...[...visible].sort((a, b) => displayPrice(b) - displayPrice(a)).slice(0, COMPACT_MARKETS).map((m) => m.id),
      // and the biggest movers, which the breaking ticker shows
      ...[...visible].sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0)).slice(0, 3).map((m) => m.id),
    ])
    visible = visible.filter((m) => keep.has(m.id))
  }
  const ser = (m: PMMarket) => {
    const s = serializeMarket(m, league)
    return opts.compact ? { ...s, description: '' } : s
  }
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    description: opts.full ? e.description : undefined,
    resolutionSource: opts.full ? e.resolutionSource : undefined,
    image: e.image,
    icon: e.icon,
    tags: e.tags,
    volume: e.volume,
    volume24h: e.volume24h,
    liquidity: e.liquidity,
    endDate: e.endDate,
    startDate: e.startDate,
    createdAt: e.createdAt,
    negRisk: e.negRisk,
    closed: e.closed,
    commentCount: e.commentCount,
    enabled: league ? eventEnabled(league, e.id) : true,
    game: e.game ?? null,
    marketCount: markets.filter((m) => m.active || m.resolved).length,
    markets: visible.map(ser),
  }
}

/** Per-event numbers the market list sorts and filters on; each looks at the event's open markets. */
function eventStats(e: PMEvent) {
  let move24h = 0, move1h = 0, range1h = 0, spread = Infinity, competitive = Infinity
  for (const id of e.marketIds) {
    const m = catalog.markets.get(id)
    if (!m?.active) continue
    const p = displayPrice(m)
    // ignore decided long shots so a 0.1% -> 0.3% blip doesn't top "movers"
    const live = p > 0.02 && p < 0.98
    if (live && m.volume24h > 25_000) move24h = Math.max(move24h, Math.abs(m.change24h ?? 0))
    const s = liveStats(m.id)
    if (live && m.volume24h > 25_000) { move1h = Math.max(move1h, Math.abs(s.move1h)); range1h = Math.max(range1h, s.range1h) }
    if (m.bestBid !== null && m.bestAsk !== null && m.volume24h > 1000) spread = Math.min(spread, m.bestAsk - m.bestBid)
    if (m.volume24h > 1000) competitive = Math.min(competitive, Math.abs(p - 0.5))
  }
  return { move24h, move1h, range1h, spread, competitive }
}

export const EVENT_SORTS = [
  'trending', 'volume24h', 'volume', 'liquidity', 'new', 'ending', 'movers', 'movers1h', 'volatile', 'competitive', 'spread', 'breaking',
] as const

function sortEvents(list: PMEvent[], sort: string) {
  const stats = new Map<string, ReturnType<typeof eventStats>>()
  const st = (e: PMEvent) => stats.get(e.id) ?? stats.set(e.id, eventStats(e)).get(e.id)!
  const by: Record<string, (a: PMEvent, b: PMEvent) => number> = {
    trending: (a, b) => a.rank - b.rank,
    volume: (a, b) => b.volume - a.volume,
    volume24h: (a, b) => b.volume24h - a.volume24h,
    liquidity: (a, b) => b.liquidity - a.liquidity,
    new: (a, b) => Date.parse(b.createdAt ?? '0') - Date.parse(a.createdAt ?? '0'),
    ending: (a, b) => Date.parse(a.endDate ?? '9999') - Date.parse(b.endDate ?? '9999'),
    breaking: (a, b) => maxMove(b) - maxMove(a),
    movers: (a, b) => st(b).move24h - st(a).move24h || b.volume24h - a.volume24h,
    movers1h: (a, b) => st(b).move1h - st(a).move1h || b.volume24h - a.volume24h,
    volatile: (a, b) => st(b).range1h - st(a).range1h || st(b).move24h - st(a).move24h,
    competitive: (a, b) => st(a).competitive - st(b).competitive || b.volume24h - a.volume24h,
    spread: (a, b) => st(a).spread - st(b).spread || b.volume24h - a.volume24h,
  }
  return list.sort(by[sort] ?? by.trending)
}

function maxMove(e: PMEvent) {
  let best = 0
  for (const id of e.marketIds) {
    const m = catalog.markets.get(id)
    if (m?.active && m.volume24h > 5000 && m.price > 0.03 && m.price < 0.97) best = Math.max(best, Math.abs(m.change24h ?? 0))
  }
  return best
}

const ENDS: Record<string, number> = { '1d': 86_400_000, '1w': 7 * 86_400_000, '1m': 30 * 86_400_000 }
const BANDS: Record<string, [number, number]> = { longshot: [0, 0.15], tossup: [0.35, 0.65], favorite: [0.85, 1] }

export interface ListEventsInput {
  leagueId?: string
  tag?: string
  q?: string
  sort?: string
  limit?: number
  offset?: number
  includeDisabled?: boolean
  /** only events ending within 1d | 1w | 1m */
  ends?: string
  /** only events with a market priced in longshot (<15%) | tossup (35-65%) | favorite (>85%) */
  band?: string
  /** binary (one market) | multi (several outcomes) */
  kind?: string
  /** minimum 24h volume in USD */
  minVolume24h?: number
  minLiquidity?: number
  /** card-sized events: no rules text, at most a dozen outcomes plus game lines */
  compact?: boolean
}

/* ---------------- the API (scoped to one user) ---------------- */

export function agentApi(userId: string, source: OrderSource) {
  const league = (leagueId: string | undefined) => {
    if (!leagueId) {
      const first = [...db.members.values()].find((m) => m.userId === userId)
      if (!first) fail(400, 'You are not in any league yet. Create or join one first.')
      leagueId = first!.leagueId
    }
    const l = db.leagues.get(leagueId) ?? fail(404, `League ${leagueId} not found`)
    getMember(l.id, userId)
    return l
  }

  const api = {
    whoami() {
      const u = db.users.get(userId) ?? fail(404, 'User not found')
      return { id: u.id, username: u.username, displayName: u.displayName, leagues: api.listLeagues() }
    },

    listLeagues() {
      return [...db.members.values()]
        .filter((m) => m.userId === userId)
        .map((m) => {
          const l = db.leagues.get(m.leagueId)!
          return {
            id: l.id, name: l.name, mode: l.mode, role: m.role, cash: m.cash,
            startingBalance: l.startingBalance, inviteCode: l.inviteCode,
            members: [...db.members.values()].filter((x) => x.leagueId === l.id && x.userId !== HOUSE_USER).length,
          }
        })
    },

    listEvents(input: ListEventsInput) {
      const l = input.leagueId ? league(input.leagueId) : undefined
      const tag = (input.tag ?? '').toLowerCase()
      const q = (input.q ?? '').trim().toLowerCase()
      let list = [...catalog.events.values()].filter((e) => !e.closed && e.marketIds.some((id) => catalog.markets.get(id)?.active))
      if (l && !input.includeDisabled) list = list.filter((e) => eventEnabled(l, e.id))
      if (tag === 'league' && l) {
        const active = new Set<string>()
        for (const o of db.orders.values()) if (o.leagueId === l.id && o.userId !== HOUSE_USER) active.add(catalog.markets.get(o.marketId)?.eventId ?? '')
        list = list.filter((e) => active.has(e.id))
      } else if (tag && !['trending', 'new', 'breaking', 'all'].includes(tag)) {
        list = list.filter((e) => e.tags.some((t) => t.slug === tag))
      }
      if (q) {
        list = list.filter(
          (e) => e.title.toLowerCase().includes(q) ||
            e.marketIds.some((id) => catalog.markets.get(id)?.groupTitle.toLowerCase().includes(q)),
        )
      }
      const endsMs = input.ends ? ENDS[input.ends] : undefined
      if (endsMs) {
        const now = Date.now()
        list = list.filter((e) => { const t = Date.parse(e.endDate ?? ''); return t > now && t - now <= endsMs })
      }
      const band = input.band ? BANDS[input.band] : undefined
      if (band) {
        list = list.filter((e) => e.marketIds.some((id) => {
          const m = catalog.markets.get(id)
          const p = m?.active ? displayPrice(m) : -1
          return p >= band[0] && p <= band[1]
        }))
      }
      if (input.kind === 'binary') list = list.filter((e) => e.marketIds.length === 1)
      if (input.kind === 'multi') list = list.filter((e) => e.marketIds.length > 1)
      if (input.minVolume24h) list = list.filter((e) => e.volume24h >= Number(input.minVolume24h))
      if (input.minLiquidity) list = list.filter((e) => e.liquidity >= Number(input.minLiquidity))
      const sort = input.sort ?? (tag === 'new' ? 'new' : tag === 'breaking' ? 'breaking' : 'trending')
      sortEvents(list, sort)
      const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100)
      const offset = Math.max(Number(input.offset) || 0, 0)
      return {
        total: list.length,
        events: list.slice(offset, offset + limit).map((e) => serializeEvent(e, l, { compact: input.compact })),
      }
    },

    /** flat market list, convenient for bots */
    async listMarkets(input: ListEventsInput) {
      const { events } = api.listEvents({ ...input, limit: Math.min(Number(input.limit) || 20, 100) })
      return events.flatMap((e) =>
        e.markets.filter((m) => m.active && m.enabled).map((m) => ({ ...m, eventSlug: e.slug, eventTitle: e.title })),
      ).slice(0, Math.min(Number(input.limit) || 20, 100))
    },

    async getEvent(slug: string, leagueId?: string) {
      const e = (await eventBySlug(slug)) ?? fail(404, `Event ${slug} not found`)
      const l = leagueId ? league(leagueId) : undefined
      if (l?.mode === 'exchange') for (const id of e.marketIds) touchMarket(l, id)
      return serializeEvent(e, l, { full: true })
    },

    async getMarket(marketId: string, leagueId?: string) {
      const m = (await marketById(marketId)) ?? fail(404, `Market ${marketId} not found`)
      const l = leagueId ? league(leagueId) : undefined
      const e = catalog.events.get(m.eventId)
      return { ...serializeMarket(m, l), eventSlug: e?.slug ?? null, eventTitle: e?.title ?? null }
    },

    /** Order book for the YES outcome. NO book = YES book mirrored (price -> 1 - price). */
    async getBook(marketId: string, leagueId?: string) {
      const m = (await marketById(marketId)) ?? fail(404, `Market ${marketId} not found`)
      const l = league(leagueId)
      if (l.mode === 'exchange') {
        touchMarket(l, m.id)
        const b = leagueBook(l.id, m.id)
        return { source: 'league', quotedIn: 'yes', ...b, last: lastLeagueTrade(l.id, m.id)?.yesPrice ?? null, tick: m.tick }
      }
      const b = await pmBook(m, 'yes')
      return { source: 'polymarket', quotedIn: 'yes', bids: b.bids.slice(0, 30), asks: b.asks.slice(0, 30), last: m.lastTrade, tick: m.tick }
    },

    /** Polymarket price history for the YES outcome, most recent `n` points of `range`. */
    async getHistory(marketId: string, n = 50, range = '1w') {
      const m = (await marketById(marketId)) ?? fail(404, `Market ${marketId} not found`)
      const h = await pmHistory(m, range)
      return h.slice(-Math.min(Math.max(Number(n) || 50, 1), 5000))
    },

    getPortfolio(leagueId?: string) {
      return portfolio(league(leagueId).id, userId)
    },

    listOrders(leagueId?: string, status: 'open' | 'all' = 'open') {
      const l = league(leagueId)
      return [...db.orders.values()]
        .filter((o) => o.leagueId === l.id && o.userId === userId && (status === 'all' || o.status === 'open'))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 200)
        .map((o) => {
          const m = catalog.markets.get(o.marketId)
          return {
            ...o,
            remaining: money(o.size - o.filled),
            title: m?.groupTitle ?? o.marketId,
            question: m?.question ?? '',
            outcomeLabel: m ? m.outcomes[o.outcome === 'yes' ? 0 : 1] : o.outcome,
            eventSlug: m ? (catalog.events.get(m.eventId)?.slug ?? null) : null,
            image: m?.image ?? '',
          }
        })
    },

    listTrades(leagueId?: string, opts: { marketId?: string; mine?: boolean; limit?: number } = {}) {
      const l = league(leagueId)
      const out = []
      const limit = Math.min(opts.limit ?? 100, 500)
      for (let i = db.trades.length - 1; i >= 0 && out.length < limit; i--) {
        const t = db.trades[i]
        if (t.leagueId !== l.id) continue
        if (opts.marketId && t.marketId !== opts.marketId) continue
        if (opts.mine && t.takerUserId !== userId && t.makerUserId !== userId) continue
        const m = catalog.markets.get(t.marketId)
        const u = db.users.get(t.takerUserId)
        out.push({
          ...t,
          title: m?.groupTitle ?? '',
          eventSlug: m ? (catalog.events.get(m.eventId)?.slug ?? null) : null,
          image: m?.image ?? '',
          outcomeLabel: m ? m.outcomes[t.takerOutcome === 'yes' ? 0 : 1] : t.takerOutcome,
          price: t.takerOutcome === 'yes' ? t.yesPrice : px(1 - t.yesPrice),
          taker: u ? { username: u.username, displayName: u.displayName, avatarHue: u.avatarHue } : null,
          mine: t.takerUserId === userId || t.makerUserId === userId,
        })
      }
      return out
    },

    async placeOrder(input: {
      leagueId?: string; marketId: string; side: Side; outcome: Outcome; type?: OrderType
      price?: number; size?: number; amount?: number
    }) {
      const l = league(input.leagueId)
      const outcome = String(input.outcome ?? '').toLowerCase() as Outcome
      const res = await placeOrder({
        leagueId: l.id,
        userId,
        marketId: String(input.marketId),
        side: String(input.side ?? '').toLowerCase() as Side,
        outcome,
        type: (input.type ?? (input.price !== undefined ? 'limit' : 'market')) as OrderType,
        price: input.price === undefined ? undefined : Number(input.price),
        size: input.size === undefined ? undefined : Number(input.size),
        amount: input.amount === undefined ? undefined : Number(input.amount),
        source,
      })
      return { ...res, cash: getMember(l.id, userId).cash }
    },

    cancelOrder(orderId: string) {
      return cancelOrder(orderId, userId)
    },

    cancelAll(leagueId?: string, marketId?: string) {
      return { cancelled: cancelAll(league(leagueId).id, userId, marketId).length }
    },

    /** league standings over a period (day/week/month/all), sorted by pnl, volume or return */
    getLeaderboard(leagueId?: string, opts: { period?: unknown; sort?: unknown; category?: string; source?: string } = {}) {
      const o: LeaderboardOptions = { period: parsePeriod(opts.period), sort: parseSort(opts.sort), category: opts.category, source: opts.source }
      return leaderboard(league(leagueId).id, o)
    },

    /** largest closed winning positions in the period: cost -> payout */
    getBiggestWins(leagueId?: string, opts: { period?: unknown; category?: string; limit?: number } = {}) {
      return biggestWins(league(leagueId).id, { period: parsePeriod(opts.period ?? 'month'), category: opts.category, limit: opts.limit })
    },

    /** P&L-over-time race for the top members (or the given user ids) */
    getLeaderboardChart(leagueId?: string, opts: { period?: unknown; sort?: unknown; category?: string; users?: string[]; limit?: number } = {}) {
      return leaderboardChart(league(leagueId).id, {
        period: parsePeriod(opts.period), sort: parseSort(opts.sort), category: opts.category, users: opts.users, limit: opts.limit,
      })
    },

    /** a member's stats, open positions, recent trades and closed positions */
    getMemberProfile(member: string, leagueId?: string, opts: { period?: unknown } = {}) {
      return memberProfile(league(leagueId).id, member, { period: parsePeriod(opts.period) })
    },

    leaderboardSources() {
      return pnlSources()
    },

    categories() {
      return CATEGORIES
    },
  }
  return api
}
