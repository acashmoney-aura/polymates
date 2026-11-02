import { agentApi } from './agent-api.ts'
import { portfolio } from './engine.ts'
import { CATEGORIES, catalog, marketById, pmHistory } from './polymarket.ts'
import type { PMMarket } from './types.ts'
import { fail } from './util.ts'

/**
 * Quant analytics shared by REST and MCP: book microstructure, event term
 * structure, realized-volatility cones and rankings, and portfolio risk.
 * Prices are YES probabilities in 0..1; volatility is in probability points.
 */

type Pt = { t: number; p: number }
type Level = { price: number; size: number }

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return NaN
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i), hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}
const round = (x: number, d = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null)
const diffs = (ps: number[]) => ps.slice(1).map((p, i) => p - ps[i])

function corr(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length)
  if (n < 3) return 0
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n))
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
}

/** Run async jobs with at most `n` in flight. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

/** Forward-filled samples of `h` on a regular grid of `step` seconds over [t0, t1]. */
function resample(h: Pt[], t0: number, t1: number, step: number) {
  const out: number[] = []
  let j = 0
  let last = h[0]?.p ?? NaN
  for (let t = t0; t <= t1; t += step) {
    while (j < h.length && h[j].t <= t) last = h[j++].p
    out.push(last)
  }
  return out
}

/* ---------------- microstructure ---------------- */

/** Depth, imbalance and microprice for a YES book (bids high→low, asks low→high). */
export function bookStats(book: { bids: Level[]; asks: Level[] }) {
  const bid = book.bids[0]?.price ?? null
  const ask = book.asks[0]?.price ?? null
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : (bid ?? ask)
  const cum = (levels: Level[]) => {
    let shares = 0, notional = 0
    return levels.slice(0, 60).map((l) => ({ price: l.price, size: l.size, shares: (shares += l.size), notional: (notional += l.size * l.price) }))
  }
  const within = (levels: Level[], w: number) =>
    mid === null ? 0 : levels.filter((l) => Math.abs(l.price - mid) <= w + 1e-9).reduce((a, l) => a + l.size * l.price, 0)
  const imbalance = Object.fromEntries([0.01, 0.02, 0.05, 0.1].map((w) => {
    const b = within(book.bids, w), a = within(book.asks, w)
    return [`${Math.round(w * 100)}c`, { bid: round(b, 2), ask: round(a, 2), imbalance: b + a > 0 ? round((b - a) / (b + a), 3) : null }]
  }))
  const bs = book.bids[0]?.size ?? 0, as = book.asks[0]?.size ?? 0
  return {
    bestBid: bid,
    bestAsk: ask,
    mid: mid === null ? null : round(mid),
    spread: bid !== null && ask !== null ? round(ask - bid) : null,
    microprice: bid !== null && ask !== null && bs + as > 0 ? round((bid * as + ask * bs) / (bs + as)) : null,
    topImbalance: bs + as > 0 ? round((bs - as) / (bs + as), 3) : null,
    imbalance,
    depth: { bids: cum(book.bids), asks: cum(book.asks) },
  }
}

export async function microstructure(userId: string, marketId: string, leagueId?: string) {
  const api = agentApi(userId, 'web')
  const book = await api.getBook(marketId, leagueId) as { source: string; bids: Level[]; asks: Level[]; last: number | null }
  const out: Record<string, unknown> = { marketId, source: book.source, last: book.last, ...bookStats(book) }
  if (book.source === 'league') {
    const trades = api.listTrades(leagueId, { marketId, limit: 100 })
    // signed flow: a taker buying YES (or selling NO) lifts the YES price
    const signed = trades.map((t) => ({ ts: t.ts, yesPrice: t.yesPrice, size: t.size, dir: (t.takerSide === 'buy') === (t.takerOutcome === 'yes') ? 1 : -1 }))
    const buy = signed.filter((t) => t.dir > 0).reduce((a, t) => a + t.size * t.yesPrice, 0)
    const sell = signed.filter((t) => t.dir < 0).reduce((a, t) => a + t.size * t.yesPrice, 0)
    const vol = signed.reduce((a, t) => a + t.size, 0)
    out.tape = signed.slice(0, 50)
    out.flow = {
      trades: signed.length,
      buyNotional: round(buy, 2),
      sellNotional: round(sell, 2),
      netFlow: buy + sell > 0 ? round((buy - sell) / (buy + sell), 3) : null,
      vwap: vol > 0 ? round(signed.reduce((a, t) => a + t.size * t.yesPrice, 0) / vol) : null,
    }
  }
  return out
}

/* ---------------- event term structure ---------------- */

interface CurveMarket { id: string; title: string; endDate: string | null; price: number; bestBid: number | null; bestAsk: number | null; active: boolean }

/**
 * Probability term structure of a date-ladder event ("X by June / by Sept / by Dec").
 * "by" ladders are a CDF F(t) that must rise with t; "continues through" ladders
 * are a survival curve S(t) that must fall. Hazard between rungs is
 * h = −ln(S₂/S₁)/Δt, quoted per day and as the probability of the event within
 * that window given it hasn't happened yet.
 */
export function eventCurve(event: { slug: string; title: string; negRisk: boolean; markets: CurveMarket[] }) {
  const now = Date.now()
  const rungs = event.markets
    .filter((m) => m.active && m.endDate && Date.parse(m.endDate) > now - 86400_000)
    .map((m) => ({ marketId: m.id, title: m.title, endDate: m.endDate!, t: Date.parse(m.endDate!), price: m.price, bestBid: m.bestBid, bestAsk: m.bestAsk }))
    .sort((a, b) => a.t - b.t)
  const distinct = new Set(rungs.map((r) => r.endDate.slice(0, 10))).size
  if (event.negRisk || rungs.length < 2 || distinct < 2) {
    return { slug: event.slug, title: event.title, kind: 'none' as const, rungs: [], violations: [] }
  }
  // decide direction from the end points (robust to a noisy middle rung)
  const kind = rungs[rungs.length - 1].price >= rungs[0].price ? ('by' as const) : ('through' as const)
  const surv = (p: number) => Math.min(0.9999, Math.max(1e-4, kind === 'by' ? 1 - p : p))
  const out = rungs.map((r, i) => {
    const days = Math.max(0, (r.t - now) / 86400_000)
    if (i === 0) {
      const s = surv(r.price)
      return { ...r, days: round(days, 2), survival: round(s), hazardPerDay: days > 0 ? round(-Math.log(s) / days, 5) : null, conditional: round(1 - s) }
    }
    const prev = rungs[i - 1]
    const s1 = surv(prev.price), s2 = surv(r.price)
    const dt = (r.t - prev.t) / 86400_000
    const cond = 1 - s2 / s1
    return { ...r, days: round(days, 2), survival: round(s2), hazardPerDay: dt > 0 && s2 <= s1 ? round(-Math.log(s2 / s1) / dt, 5) : null, conditional: round(cond) }
  })
  // calendar arb: a later "by" date can never be less likely than an earlier one
  const violations = []
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i]
    const gap = kind === 'by' ? a.price - b.price : b.price - a.price
    if (gap > 0.005) {
      violations.push({
        earlier: a.marketId, later: b.marketId, earlierTitle: a.title, laterTitle: b.title, gap: round(gap),
        trade: kind === 'by' ? `Buy YES ${b.title}, buy NO ${a.title}` : `Buy YES ${a.title}, buy NO ${b.title}`,
      })
    }
  }
  return { slug: event.slug, title: event.title, kind, rungs: out, violations }
}

export async function eventCurveFor(userId: string, slug: string, leagueId?: string) {
  const ev = await agentApi(userId, 'web').getEvent(slug, leagueId) as Parameters<typeof eventCurve>[0]
  return eventCurve(ev)
}

/* ---------------- volatility ---------------- */

// Realized vol over a window w = sqrt(Σ Δp² over the window / w in days): pp per √day.
const WINDOWS = [
  { key: '1h', hours: 1, range: '1d', step: 300 },
  { key: '6h', hours: 6, range: '1w', step: 1800 },
  { key: '1d', hours: 24, range: '1w', step: 1800 },
  { key: '3d', hours: 72, range: '1m', step: 10800 },
  { key: '1w', hours: 168, range: '1m', step: 10800 },
]

function rollingVol(ps: number[], barsPerWindow: number, days: number) {
  const d = diffs(ps)
  const sq = d.map((x) => x * x)
  const out: number[] = []
  let acc = 0
  for (let i = 0; i < sq.length; i++) {
    acc += sq[i]
    if (i >= barsPerWindow) acc -= sq[i - barsPerWindow]
    if (i >= barsPerWindow - 1) out.push(Math.sqrt(Math.max(0, acc) / days))
  }
  return out
}

/** Volatility cone for one market: realized vol over 1h…1w windows with percentile bands. */
export async function volCone(marketId: string) {
  const m = (await marketById(marketId)) ?? fail(404, 'Market not found')
  const hist = new Map<string, Pt[]>()
  for (const r of new Set(WINDOWS.map((w) => w.range))) hist.set(r, await pmHistory(m, r))
  const cone = WINDOWS.map((w) => {
    const h = hist.get(w.range) ?? []
    if (h.length < 4) return { window: w.key, hours: w.hours, n: 0, min: null, p10: null, p25: null, median: null, p75: null, p90: null, max: null, current: null, percentile: null }
    const ps = resample(h, h[0].t, h[h.length - 1].t, w.step)
    const bars = Math.max(1, Math.round((w.hours * 3600) / w.step))
    const vols = rollingVol(ps, bars, w.hours / 24)
    const sorted = [...vols].sort((a, b) => a - b)
    const cur = vols[vols.length - 1] ?? NaN
    return {
      window: w.key, hours: w.hours, n: vols.length,
      min: round(sorted[0]), p10: round(quantile(sorted, 0.1)), p25: round(quantile(sorted, 0.25)), median: round(quantile(sorted, 0.5)),
      p75: round(quantile(sorted, 0.75)), p90: round(quantile(sorted, 0.9)), max: round(sorted[sorted.length - 1]), current: round(cur),
      percentile: sorted.length ? round(sorted.filter((v) => v <= cur).length / sorted.length, 3) : null,
    }
  })
  const e = catalog.events.get(m.eventId)
  return { marketId: m.id, title: m.groupTitle, question: m.question, eventSlug: e?.slug ?? null, price: m.price, unit: 'probability points per √day', cone }
}

let volCache: { at: number; data: unknown } | null = null
let volPending: Promise<unknown> | null = null

/** Most volatile liquid markets, by realized 24h and 7d volatility of the YES price. */
export async function volatilityRanking(limit = 30) {
  if (volCache && Date.now() - volCache.at < 120_000) return sliceVol(volCache.data, limit)
  volPending ??= (async () => {
    try {
      const live = [...catalog.markets.values()]
        .filter((m) => m.active && !m.resolved && m.volume24h > 20_000 && m.price > 0.03 && m.price < 0.97)
        .sort((a, b) => b.volume24h - a.volume24h)
        .slice(0, 80)
      const rows = await pool(live, 8, async (m: PMMarket) => {
        const h = await pmHistory(m, '1w')
        if (h.length < 10) return null
        const t1 = h[h.length - 1].t
        const ps = resample(h, h[0].t, t1, 1800)
        const d = diffs(ps)
        const last = d.slice(-48)
        const span = (ps.length - 1) / 48
        const vol7d = Math.sqrt(d.reduce((a, x) => a + x * x, 0) / Math.max(span, 1e-6))
        const vol1d = Math.sqrt(last.reduce((a, x) => a + x * x, 0) / Math.max(last.length / 48, 1e-6))
        // sparkline: ~56 points of the week
        const k = Math.max(1, Math.floor(ps.length / 56))
        const e = catalog.events.get(m.eventId)
        return {
          marketId: m.id, title: m.groupTitle, question: m.question, eventSlug: e?.slug ?? null, eventTitle: e?.title ?? '',
          image: m.image || e?.icon || '', category: categoryOf(m), price: m.price, volume24h: m.volume24h,
          vol1d: round(vol1d), vol7d: round(vol7d), regime: vol7d > 0 ? round(vol1d / vol7d, 2) : null,
          range7d: round(Math.max(...ps) - Math.min(...ps)), change7d: round(ps[ps.length - 1] - ps[0]),
          spark: ps.filter((_, i) => i % k === 0 || i === ps.length - 1).map((p) => round(p, 3)),
        }
      })
      const data = rows.filter((r): r is NonNullable<typeof r> => !!r).sort((a, b) => (b.vol1d ?? 0) - (a.vol1d ?? 0))
      volCache = { at: Date.now(), data }
      return data
    } finally {
      volPending = null
    }
  })()
  return sliceVol(await volPending, limit)
}
const sliceVol = (data: unknown, limit: number) => ({
  unit: 'probability points per √day', generatedAt: volCache?.at ?? Date.now(),
  markets: (data as unknown[]).slice(0, Math.min(Math.max(limit, 1), 80)),
})

/* ---------------- portfolio risk ---------------- */

const categoryOf = (m: PMMarket | undefined) => {
  const tags = (m && catalog.events.get(m.eventId)?.tags) ?? []
  const hit = CATEGORIES.find((c) => tags.some((t) => t.slug === c.slug))
  return hit?.label ?? tags.find((t) => !['all', 'hide-from-new', 'featured'].includes(t.slug))?.label ?? 'Other'
}

/**
 * Risk of one member's book. Resolution risk treats each market as a Bernoulli
 * payoff at its current price, combined with a correlation matrix estimated
 * from one week of price changes; mark-to-market risk is a 1-day 95% VaR from
 * realized daily volatility.
 */
export async function portfolioRisk(leagueId: string, userId: string) {
  const pf = portfolio(leagueId, userId)
  const byMarket = new Map<string, { marketId: string; title: string; eventTitle: string | null; eventSlug: string | null; category: string; yes: number; no: number; value: number; cost: number; p: number; endDate: string | null }>()
  for (const pos of pf.positions) {
    if (pos.resolved) continue
    const m = catalog.markets.get(pos.marketId)
    let row = byMarket.get(pos.marketId)
    if (!row) {
      const p = pos.outcome === 'yes' ? pos.curPrice : 1 - pos.curPrice
      row = { marketId: pos.marketId, title: pos.title, eventTitle: pos.eventTitle, eventSlug: pos.eventSlug, category: categoryOf(m), yes: 0, no: 0, value: 0, cost: 0, p, endDate: pos.endDate }
      byMarket.set(pos.marketId, row)
    }
    row[pos.outcome] += pos.size
    row.value += pos.value
    row.cost += pos.cost
  }
  const rows = [...byMarket.values()].sort((a, b) => b.value - a.value).slice(0, 40)
  const equity = pf.value

  // daily price-change vol and correlation from 1w history (30-minute bars)
  const series = await pool(rows, 6, async (r) => {
    const m = catalog.markets.get(r.marketId)
    return m ? await pmHistory(m, '1w') : []
  })
  const t1 = Math.max(0, ...series.map((h) => h[h.length - 1]?.t ?? 0))
  const t0 = t1 - 7 * 86400
  const changes = series.map((h) => (h.length > 2 ? diffs(resample(h, t0, t1, 3600 * 4)) : []))
  const n = rows.length
  const C = rows.map((_, i) => rows.map((__, j) => (i === j ? 1 : corr(changes[i], changes[j]))))
  const dailyVol = changes.map((d) => (d.length ? Math.sqrt(d.reduce((a, x) => a + x * x, 0) / 7) : 0))

  const net = rows.map((r) => r.yes - r.no) // $ sensitivity to YES price per 1.0 move
  const resSd = rows.map((r, i) => Math.abs(net[i]) * Math.sqrt(r.p * (1 - r.p)))
  const mtmSd = rows.map((_, i) => Math.abs(net[i]) * dailyVol[i])
  const sign = net.map((x) => Math.sign(x))
  const quad = (sd: number[], corrd: boolean) => {
    let v = 0
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += sd[i] * sd[j] * sign[i] * sign[j] * (i === j ? 1 : corrd ? C[i][j] : 0)
    return Math.sqrt(Math.max(0, v))
  }
  const resIndep = quad(resSd, false), resCorr = quad(resSd, true)
  const mtmCorr = quad(mtmSd, true)

  // marginal contribution of each position to correlated resolution risk
  const contrib = rows.map((_, i) => {
    let s = 0
    for (let j = 0; j < n; j++) s += resSd[i] * resSd[j] * sign[i] * sign[j] * (i === j ? 1 : C[i][j])
    return resCorr > 0 ? s / resCorr : 0
  })

  const categories = new Map<string, { category: string; value: number; positions: number; netDelta: number }>()
  rows.forEach((r, i) => {
    const c = categories.get(r.category) ?? { category: r.category, value: 0, positions: 0, netDelta: 0 }
    c.value += r.value
    c.positions++
    c.netDelta += net[i]
    categories.set(r.category, c)
  })
  const positionsValue = rows.reduce((a, r) => a + r.value, 0)
  const hhi = positionsValue > 0 ? rows.reduce((a, r) => a + (r.value / positionsValue) ** 2, 0) : 0
  const best = rows.reduce((a, r) => a + Math.max(r.yes, r.no), 0)
  const worst = rows.reduce((a, r) => a + Math.min(r.yes, r.no), 0)

  return {
    equity: Math.round(equity * 100) / 100,
    cash: pf.cash,
    positionsValue: round(positionsValue, 2),
    // at current prices, expected payout equals mark value; the gap to cost is expected P&L
    expected: { payout: round(positionsValue, 2), pnl: round(positionsValue - rows.reduce((a, r) => a + r.cost, 0), 2), equity: round(pf.cash + positionsValue, 2) },
    resolution: {
      sdIndependent: round(resIndep, 2), sdCorrelated: round(resCorr, 2),
      diversification: resIndep > 0 ? round(resCorr / resIndep, 3) : null,
      bestCase: round(pf.cash + best, 2), worstCase: round(pf.cash + worst, 2),
    },
    var1d95: round(1.645 * mtmCorr, 2),
    concentration: { hhi: round(hhi, 3), effectivePositions: hhi > 0 ? round(1 / hhi, 2) : null, top: rows[0] ? round(rows[0].value / Math.max(positionsValue, 1e-9), 3) : null },
    categories: [...categories.values()].sort((a, b) => b.value - a.value).map((c) => ({ ...c, value: round(c.value, 2), share: round(c.value / Math.max(positionsValue, 1e-9), 3), netDelta: round(c.netDelta, 2) })),
    positions: rows.map((r, i) => ({
      ...r, value: round(r.value, 2), cost: round(r.cost, 2), p: round(r.p),
      ifYes: round(r.yes - r.value, 2), ifNo: round(r.no - r.value, 2),
      netDelta: round(net[i], 2), dailyVol: round(dailyVol[i]), resolutionSd: round(resSd[i], 2), riskContribution: round(contrib[i], 2),
      weight: round(r.value / Math.max(equity, 1e-9), 4),
    })),
    correlation: { labels: rows.map((r) => r.title), matrix: C.map((row) => row.map((c) => round(c, 3))) },
  }
}
