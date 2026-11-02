import { HOUSE_USER, leagueYesPrice, portfolio } from './engine.ts'
import { catalog } from './polymarket.ts'
import { db, markDirty, memberKey } from './state.ts'
import type { EquityPoint, League, Outcome, Settlement, Side } from './types.ts'
import { fail, money, now, px } from './util.ts'

/* ------------------------------------------------------------------
 * League leaderboards.
 *
 * Every member's prediction-market history is replayed from db.trades and
 * db.settlements into a per-market ledger (shares held + cumulative cash flow).
 * A market's contribution to wealth at time t is
 *     W(t) = yes(t) * mark(t) + no(t) * (1 - mark(t)) + cashFlow(t)
 * so P&L over [S, now] is sum(W(now) - W(S)): trades, settlements and price
 * moves all fall out of the same number. Marks in the past come from the
 * league's own trade tape (or the equity snapshots recorded below, which use
 * live marks); "now" uses the same live marks as portfolio().
 *
 * Other kinds of P&L (perps, ...) plug in with registerPnlSource().
 * ------------------------------------------------------------------ */

export type Period = 'day' | 'week' | 'month' | 'all'
export type LeaderSort = 'pnl' | 'volume' | 'return'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const PERIOD_MS = { day: DAY, week: 7 * DAY, month: 30 * DAY } as const
const EPS = 1e-9

const PERIOD_ALIASES: Record<string, Period> = {
  day: 'day', today: 'day', '1d': 'day', '24h': 'day',
  week: 'week', weekly: 'week', '1w': 'week', '7d': 'week',
  month: 'month', monthly: 'month', '1m': 'month', '30d': 'month',
  all: 'all', alltime: 'all', 'all-time': 'all', '': 'all',
}
export function parsePeriod(x: unknown): Period {
  const p = PERIOD_ALIASES[String(x ?? '').toLowerCase()]
  return p ?? fail(400, 'period must be day, week, month or all')
}
export function parseSort(x: unknown): LeaderSort {
  const s = String(x ?? 'pnl').toLowerCase() || 'pnl'
  if (s === 'pnl' || s === 'volume' || s === 'return') return s
  return fail(400, 'sort must be pnl, volume or return')
}
export const periodStart = (period: Period, t = now()) => (period === 'all' ? 0 : t - PERIOD_MS[period])

/* ---------------- pluggable P&L sources ---------------- */

export interface PnlSourceStats { pnl: number; volume: number; trades: number }

/**
 * Another book of P&L that counts toward the leaderboard (e.g. perps).
 * `member` returns what a member made over [since, now]; `series`, if given,
 * returns the P&L earned between `since` and each timestamp (race chart).
 */
export interface PnlSource {
  key: string
  label: string
  member(league: League, userId: string, since: number): PnlSourceStats
  series?(league: League, userId: string, since: number, ts: number[]): number[]
}
const extraSources: PnlSource[] = []
export function registerPnlSource(source: PnlSource) {
  const i = extraSources.findIndex((s) => s.key === source.key)
  if (i >= 0) extraSources[i] = source
  else extraSources.push(source)
}
export const pnlSources = () => [{ key: 'predictions', label: 'Predictions' }, ...extraSources.map((s) => ({ key: s.key, label: s.label }))]

/* ---------------- replay ---------------- */

interface Fill { ts: number; marketId: string; side: Side; outcome: Outcome; size: number; price: number; value: number }
export interface Trip {
  marketId: string
  outcome: Outcome
  openedAt: number
  closedAt: number
  cost: number
  payout: number
  pnl: number
  settled: boolean
}
interface Tick { ts: number; yes: number; no: number; cf: number }
interface Track {
  yes: number
  no: number
  yesCost: number
  noCost: number
  cf: number
  hist: Tick[]
  trip: { openedAt: number; cost: number; payout: number; costYes: number; costNo: number } | null
}
interface Ledger {
  userId: string
  start: number
  fills: Fill[]
  markets: Map<string, Track>
  trips: Trip[]
}

const outcomePx = (outcome: Outcome, yp: number) => (outcome === 'yes' ? yp : px(1 - yp))

/** last index i with arr[i] <= t, or -1 */
function bisect(arr: number[], t: number) {
  let lo = 0, hi = arr.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}

function lastTick(hist: Tick[], t: number): Tick | null {
  let lo = 0, hi = hist.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (hist[mid].ts <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans < 0 ? null : hist[ans]
}

export interface LeagueBoard {
  league: League
  now: number
  ledgers: Map<string, Ledger>
  /** live (current) YES mark per market */
  live(marketId: string): number
  markAt(marketId: string, t: number): number
}

/** Replays a league's whole season. Cheap enough per request for 20-30 member leagues. */
export function buildBoard(league: League): LeagueBoard {
  const t = now()
  const seasonStart = league.seasonStartedAt ?? 0
  const ledgers = new Map<string, Ledger>()
  for (const m of db.members.values()) {
    if (m.leagueId !== league.id || m.userId === HOUSE_USER) continue
    ledgers.set(m.userId, { userId: m.userId, start: Math.max(m.joinedAt, seasonStart), fills: [], markets: new Map(), trips: [] })
  }
  const tape = new Map<string, { ts: number[]; yp: number[] }>()
  const addFill = (userId: string | null, ts: number, marketId: string, side: Side | undefined, outcome: Outcome | undefined, size: number, yp: number) => {
    const l = userId ? ledgers.get(userId) : undefined
    if (!l || !side || !outcome || ts < l.start) return
    const price = outcomePx(outcome, yp)
    l.fills.push({ ts, marketId, side, outcome, size, price, value: money(price * size) })
  }
  for (const tr of db.trades) {
    if (tr.leagueId !== league.id || tr.ts < seasonStart) continue
    let tp = tape.get(tr.marketId)
    if (!tp) tape.set(tr.marketId, (tp = { ts: [], yp: [] }))
    tp.ts.push(tr.ts)
    tp.yp.push(tr.yesPrice)
    addFill(tr.takerUserId, tr.ts, tr.marketId, tr.takerSide, tr.takerOutcome, tr.size, tr.yesPrice)
    if (tr.makerUserId) {
      const mo = tr.makerSide ? null : db.orders.get(tr.makerOrderId ?? '')
      addFill(tr.makerUserId, tr.ts, tr.marketId, tr.makerSide ?? mo?.side, tr.makerOutcome ?? mo?.outcome, tr.size, tr.yesPrice)
    }
  }
  const settlements = new Map<string, Settlement>()
  for (const s of db.settlements.values()) if (s.leagueId === league.id) settlements.set(s.marketId, s)
  const settleList = [...settlements.values()].sort((a, b) => a.ts - b.ts)

  for (const l of ledgers.values()) replay(l, settleList)

  const liveCache = new Map<string, number>()
  const live = (marketId: string) => {
    let p = liveCache.get(marketId)
    if (p === undefined) {
      const m = catalog.markets.get(marketId)
      p = m ? leagueYesPrice(league, m) : 0.5
      liveCache.set(marketId, p)
    }
    return p
  }
  const markAt = (marketId: string, at: number) => {
    const s = settlements.get(marketId)
    if (s && s.ts <= at) return s.payout[0]
    if (at >= t) return live(marketId)
    const tp = tape.get(marketId)
    if (!tp) return live(marketId)
    const i = bisect(tp.ts, at)
    return i >= 0 ? tp.yp[i] : tp.yp[0]
  }
  return { league, now: t, ledgers, live, markAt }
}

function track(l: Ledger, marketId: string) {
  let tr = l.markets.get(marketId)
  if (!tr) l.markets.set(marketId, (tr = { yes: 0, no: 0, yesCost: 0, noCost: 0, cf: 0, hist: [], trip: null }))
  return tr
}

function closeTrip(l: Ledger, marketId: string, tr: Track, ts: number, settled: boolean) {
  const trip = tr.trip
  if (!trip) return
  l.trips.push({
    marketId,
    outcome: trip.costYes >= trip.costNo ? 'yes' : 'no',
    openedAt: trip.openedAt,
    closedAt: ts,
    cost: money(trip.cost),
    payout: money(trip.payout),
    pnl: money(trip.payout - trip.cost),
    settled,
  })
  tr.trip = null
}

function replay(l: Ledger, settlements: Settlement[]) {
  let si = 0
  const settle = (s: Settlement) => {
    const tr = l.markets.get(s.marketId)
    if (!tr || s.ts < l.start || (tr.yes <= EPS && tr.no <= EPS)) return
    const value = money(tr.yes * s.payout[0] + tr.no * s.payout[1])
    tr.cf = money(tr.cf + value)
    if (tr.trip) tr.trip.payout += value
    tr.yes = tr.no = tr.yesCost = tr.noCost = 0
    tr.hist.push({ ts: s.ts, yes: 0, no: 0, cf: tr.cf })
    closeTrip(l, s.marketId, tr, s.ts, true)
  }
  for (const f of l.fills) {
    while (si < settlements.length && settlements[si].ts < f.ts) settle(settlements[si++])
    const tr = track(l, f.marketId)
    const costKey = f.outcome === 'yes' ? 'yesCost' : 'noCost'
    if (!tr.trip) tr.trip = { openedAt: f.ts, cost: 0, payout: 0, costYes: 0, costNo: 0 }
    if (f.side === 'buy') {
      tr[f.outcome] += f.size
      tr[costKey] += f.value
      tr.cf = money(tr.cf - f.value)
      tr.trip.cost += f.value
      if (f.outcome === 'yes') tr.trip.costYes += f.value
      else tr.trip.costNo += f.value
    } else {
      const held = tr[f.outcome]
      const avg = held > EPS ? tr[costKey] / held : 0
      tr[f.outcome] = Math.max(0, held - f.size)
      tr[costKey] = tr[f.outcome] <= EPS ? 0 : tr[costKey] - avg * f.size
      tr.cf = money(tr.cf + f.value)
      tr.trip.payout += f.value
    }
    tr.hist.push({ ts: f.ts, yes: tr.yes, no: tr.no, cf: tr.cf })
    if (tr.yes <= EPS && tr.no <= EPS) closeTrip(l, f.marketId, tr, f.ts, false)
  }
  while (si < settlements.length) settle(settlements[si++])
}

/* ---------------- valuation ---------------- */

export type MarketFilter = ((marketId: string) => boolean) | null

export function categoryFilter(category: string | undefined | null): MarketFilter {
  const tag = String(category ?? '').trim().toLowerCase()
  if (!tag || tag === 'all') return null
  return (marketId) => {
    const m = catalog.markets.get(marketId)
    const e = m ? catalog.events.get(m.eventId) : undefined
    return !!e?.tags.some((x) => x.slug === tag)
  }
}

/** predictions wealth (P&L since the member's start) at time t, from the replay */
function wealthReplay(b: LeagueBoard, l: Ledger, t: number, filter: MarketFilter) {
  if (t < l.start) return 0
  let w = 0
  for (const [marketId, tr] of l.markets) {
    if (filter && !filter(marketId)) continue
    const k = lastTick(tr.hist, t)
    if (!k) continue
    const yp = k.yes > EPS || k.no > EPS ? b.markAt(marketId, t) : 0
    w += k.yes * yp + k.no * (1 - yp) + k.cf
  }
  return w
}

function snapshotNear(points: EquityPoint[] | undefined, t: number, start: number, nowTs: number) {
  if (!points?.length) return null
  const tol = nowTs - t > 7 * DAY ? 12 * HOUR : 45 * 60_000
  let best: EquityPoint | null = null
  for (const p of points) {
    if (p.ts < start || Math.abs(p.ts - t) > tol) continue
    if (!best || Math.abs(p.ts - t) < Math.abs(best.ts - t)) best = p
  }
  return best
}

/** wealth at t; uncategorised past values prefer recorded snapshots (they used live marks) */
function wealthAt(b: LeagueBoard, l: Ledger, t: number, filter: MarketFilter) {
  if (t < l.start) return 0
  if (!filter && t < b.now) {
    const snap = snapshotNear(db.equity.get(memberKey(b.league.id, l.userId)), t, l.start, b.now)
    if (snap) return snap.pnl
  }
  return wealthReplay(b, l, t, filter)
}

/* ---------------- per-member stats ---------------- */

interface PredictionStats extends PnlSourceStats {
  startWealth: number
  wins: number
  losses: number
  bestTrade: Trip | null
  streak: { kind: 'win' | 'loss'; count: number } | null
}

function predictionStats(b: LeagueBoard, l: Ledger, since: number, filter: MarketFilter): PredictionStats {
  const startWealth = wealthAt(b, l, since, filter)
  const pnl = wealthReplay(b, l, b.now, filter) - startWealth
  let volume = 0, trades = 0
  for (const f of l.fills) {
    if (f.ts < since || (filter && !filter(f.marketId))) continue
    volume += f.value
    trades++
  }
  let wins = 0, losses = 0
  let bestTrade: Trip | null = null
  const closed = l.trips.filter((x) => !filter || filter(x.marketId))
  for (const trip of closed) {
    if (trip.closedAt < since) continue
    if (trip.settled) {
      if (trip.pnl > 0) wins++
      else losses++
    }
    if (trip.pnl > 0 && (!bestTrade || trip.pnl > bestTrade.pnl)) bestTrade = trip
  }
  let streak: PredictionStats['streak'] = null
  for (let i = closed.length - 1; i >= 0; i--) {
    const kind = closed[i].pnl > 0 ? 'win' : 'loss'
    if (!streak) streak = { kind, count: 1 }
    else if (streak.kind === kind) streak.count++
    else break
  }
  return { pnl: money(pnl), volume: money(volume), trades, startWealth, wins, losses, bestTrade, streak }
}

function marketInfo(marketId: string, outcome?: Outcome) {
  const m = catalog.markets.get(marketId)
  const e = m ? catalog.events.get(m.eventId) : undefined
  return {
    marketId,
    title: m?.groupTitle ?? marketId,
    question: m?.question ?? '',
    eventTitle: e?.title ?? null,
    eventSlug: e?.slug ?? null,
    image: m?.image || e?.icon || '',
    ...(outcome ? { outcome, outcomeLabel: m ? m.outcomes[outcome === 'yes' ? 0 : 1] : outcome } : {}),
  }
}

const tripView = (trip: Trip) => ({ ...marketInfo(trip.marketId, trip.outcome), cost: trip.cost, payout: trip.payout, pnl: trip.pnl, openedAt: trip.openedAt, closedAt: trip.closedAt, settled: trip.settled })

function userView(userId: string) {
  const u = db.users.get(userId)
  return {
    userId,
    username: u?.username ?? '?',
    displayName: u?.displayName ?? '?',
    avatarHue: u?.avatarHue ?? 200,
    avatarUrl: u?.avatarUrl,
  }
}

export interface LeaderboardOptions {
  period?: Period
  sort?: LeaderSort
  /** Polymarket tag slug; only prediction markets in that category count */
  category?: string
  /** 'predictions' or a registered source key; default: everything */
  source?: string
}

export function leaderboard(leagueId: string, opts: LeaderboardOptions = {}) {
  const league = db.leagues.get(leagueId) ?? fail(404, 'League not found')
  const period = opts.period ?? 'all'
  const sort = opts.sort ?? 'pnl'
  const filter = categoryFilter(opts.category)
  const source = opts.source && opts.source !== 'all' ? opts.source : null
  if (source && source !== 'predictions' && !extraSources.some((s) => s.key === source)) fail(400, `Unknown source ${source}`)
  const b = buildBoard(league)
  const since = periodStart(period, b.now)
  const rows = [...b.ledgers.values()].map((l) => {
    const m = db.members.get(memberKey(league.id, l.userId))!
    const pf = portfolio(league.id, l.userId)
    const pred = predictionStats(b, l, since, filter)
    const breakdown: Record<string, PnlSourceStats> = { predictions: { pnl: pred.pnl, volume: pred.volume, trades: pred.trades } }
    // other books have no market categories, so a category filter is predictions-only
    if (!filter) for (const s of extraSources) breakdown[s.key] = s.member(league, l.userId, since)
    const counted = Object.entries(breakdown).filter(([k]) => !source || k === source)
    const sum = (f: keyof PnlSourceStats) => counted.reduce((acc, [, v]) => acc + v[f], 0)
    const pnl = money(sum('pnl'))
    const base = league.startingBalance + (since > l.start ? pred.startWealth : 0)
    const predCounts = !source || source === 'predictions'
    return {
      ...userView(l.userId),
      role: m.role,
      pnl,
      pnlPct: base > 0 ? pnl / base : 0,
      volume: money(sum('volume')),
      trades: sum('trades'),
      value: pf.value,
      cash: pf.cash,
      positions: pf.positions.length,
      bots: [...db.scripts.values()].filter((s) => s.userId === l.userId && s.leagueId === league.id && s.enabled).length,
      wins: predCounts ? pred.wins : 0,
      losses: predCounts ? pred.losses : 0,
      winRate: predCounts && pred.wins + pred.losses > 0 ? pred.wins / (pred.wins + pred.losses) : null,
      bestTrade: predCounts && pred.bestTrade ? tripView(pred.bestTrade) : null,
      streak: predCounts ? pred.streak : null,
      breakdown,
    }
  })
  const key = (r: (typeof rows)[number]) => (sort === 'volume' ? r.volume : sort === 'return' ? r.pnlPct : r.pnl)
  rows.sort((a, c) => key(c) - key(a) || c.pnl - a.pnl || a.displayName.localeCompare(c.displayName))
  return rows.map((r, i) => ({ rank: i + 1, period, ...r }))
}

export function biggestWins(leagueId: string, opts: { period?: Period; category?: string; limit?: number } = {}) {
  const league = db.leagues.get(leagueId) ?? fail(404, 'League not found')
  const period = opts.period ?? 'month'
  const filter = categoryFilter(opts.category)
  const b = buildBoard(league)
  const since = periodStart(period, b.now)
  const wins: { userId: string; trip: Trip }[] = []
  for (const l of b.ledgers.values()) {
    for (const trip of l.trips) {
      if (trip.closedAt >= since && trip.pnl > 0 && (!filter || filter(trip.marketId))) wins.push({ userId: l.userId, trip })
    }
  }
  wins.sort((a, c) => c.trip.pnl - a.trip.pnl)
  const limit = Math.min(Math.max(Number(opts.limit) || 10, 1), 50)
  return wins.slice(0, limit).map((w, i) => ({ rank: i + 1, ...userView(w.userId), ...tripView(w.trip) }))
}

/* ---------------- race chart ---------------- */

const CHART_STEP: Record<Period, number> = { day: HOUR, week: 4 * HOUR, month: 12 * HOUR, all: 0 }

function chartTimes(b: LeagueBoard, period: Period, since: number, ledgers: Ledger[]) {
  const end = b.now
  let start = since
  let step = CHART_STEP[period]
  if (period === 'all') {
    start = Math.min(...ledgers.map((l) => l.start), end - HOUR)
    step = Math.max(HOUR, Math.ceil((end - start) / 60))
  }
  const ts: number[] = []
  for (let t = start; t < end; t += step) ts.push(t)
  ts.push(end)
  return ts
}

/** P&L earned since the period start, sampled over the period, for each requested (or top-5) member */
export function leaderboardChart(leagueId: string, opts: { period?: Period; category?: string; sort?: LeaderSort; users?: string[]; limit?: number } = {}) {
  const league = db.leagues.get(leagueId) ?? fail(404, 'League not found')
  const period = opts.period ?? 'all'
  const filter = categoryFilter(opts.category)
  let users = (opts.users ?? []).filter(Boolean)
  if (!users.length) {
    const limit = Math.min(Math.max(Number(opts.limit) || 5, 1), 10)
    users = leaderboard(leagueId, { period, sort: opts.sort, category: opts.category }).slice(0, limit).map((r) => r.userId)
  }
  const b = buildBoard(league)
  const since = periodStart(period, b.now)
  const ledgers = users.map((u) => b.ledgers.get(u)).filter((l): l is Ledger => !!l)
  const ts = chartTimes(b, period, since, ledgers)
  const series = ledgers.map((l) => {
    const base = wealthAt(b, l, since, filter)
    const values = ts.map((t, i) => (i === ts.length - 1 ? wealthReplay(b, l, b.now, filter) : wealthAt(b, l, t, filter)) - base)
    if (!filter) {
      for (const s of extraSources) {
        const extra = s.series?.(league, l.userId, since, ts)
        if (extra) extra.forEach((v, i) => { values[i] += v })
      }
    }
    return { ...userView(l.userId), values: values.map(money) }
  })
  return { period, t: ts.map((x) => Math.round(x / 1000)), series }
}

/* ---------------- member profile ---------------- */

export function memberProfile(leagueId: string, target: string, opts: { period?: Period } = {}) {
  const league = db.leagues.get(leagueId) ?? fail(404, 'League not found')
  const m = [...db.members.values()].find((x) => x.leagueId === league.id && x.userId !== HOUSE_USER &&
    (x.userId === target || db.users.get(x.userId)?.username.toLowerCase() === target.toLowerCase())) ?? fail(404, 'Member not found')
  const period = opts.period ?? 'all'
  const row = leaderboard(league.id, { period }).find((r) => r.userId === m.userId)!
  const b = buildBoard(league)
  const l = b.ledgers.get(m.userId)!
  const pf = portfolio(league.id, m.userId)
  const recent = l.fills.slice(-60).reverse().map((f) => ({
    ...marketInfo(f.marketId, f.outcome), side: f.side, price: f.price, size: f.size, value: f.value, ts: f.ts,
  }))
  return {
    ...row,
    tradeCount: row.trades,
    joinedAt: m.joinedAt,
    startingBalance: league.startingBalance,
    allTimePnl: pf.pnl,
    realized: pf.realized,
    positionsValue: pf.positionsValue,
    positions: pf.positions,
    trades: recent,
    closed: l.trips.slice(-30).reverse().map(tripView),
    chart: leaderboardChart(league.id, { period, users: [m.userId] }),
  }
}

/* ---------------- equity snapshots ---------------- */

/** Records every member's current P&L (hourly bucket); older than a week thins to one point per day. */
export function recordEquitySnapshots() {
  const t = now()
  for (const league of db.leagues.values()) {
    const b = buildBoard(league)
    for (const l of b.ledgers.values()) {
      const key = memberKey(league.id, l.userId)
      const pts = (db.equity.get(key) ?? []).filter((p) => p.ts >= l.start && p.ts <= t)
      const point = { ts: t, pnl: money(wealthReplay(b, l, t, null)) }
      const last = pts[pts.length - 1]
      if (last && Math.floor(last.ts / HOUR) === Math.floor(t / HOUR)) pts[pts.length - 1] = point
      else pts.push(point)
      const thinned: EquityPoint[] = []
      for (const p of pts) {
        const prev = thinned[thinned.length - 1]
        if (prev && t - p.ts > 7 * DAY && Math.floor(prev.ts / DAY) === Math.floor(p.ts / DAY)) thinned[thinned.length - 1] = p
        else thinned.push(p)
      }
      db.equity.set(key, thinned)
    }
  }
  for (const k of db.equity.keys()) if (!db.members.has(k)) db.equity.delete(k)
  markDirty()
}
