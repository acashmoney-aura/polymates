import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten'
import { catalog, marketById, pmBook, pmHistory } from './polymarket.ts'
import type { Outcome, PMMarket, Side } from './types.ts'
import { fail, money, px, shares } from './util.ts'

/**
 * QuantConnect-style backtester. The strategy is the same JavaScript you run
 * live as a hosted script (`onTick(pm)`, optional `initialize(pm)`), replayed
 * bar by bar over Polymarket's price history. The `pm` object only ever sees
 * data up to the current bar, so there is no lookahead. Fills are simulated
 * against a synthetic book of ±spread/2 around the historical price.
 */

export interface BacktestInput {
  code: string
  marketIds: string[]
  range?: string
  cash?: number
  /** full simulated bid/ask spread in price units (0.02 = 2¢) */
  spread?: number
  /** fee in basis points of notional */
  feeBps?: number
}

interface SimOrder {
  id: string
  marketId: string
  side: Side
  outcome: Outcome
  type: 'limit' | 'market'
  price: number
  size: number
  filled: number
  status: 'open' | 'filled' | 'cancelled'
  createdAt: number
}

interface SimFill {
  t: number
  marketId: string
  title: string
  side: Side
  outcome: Outcome
  price: number
  size: number
  pnl: number | null
}

const MAX_MARKETS = 8
const MAX_BARS = 2500
const DEADLINE_MS = 20_000
const MAX_LOGS = 400
let running = 0

const PRELUDE = `
const __call = (op, ...args) => {
  const r = JSON.parse(__host(op, JSON.stringify(args)));
  if (r.error) throw new Error(r.error);
  return r.data;
};
const pm = {
  backtest: true,
  mode: 'backtest',
  store: {},
  get now() { return __call('now') },
  markets: (opts) => __call('markets', opts ?? {}),
  market: (id) => __call('market', id),
  book: (id) => __call('book', id),
  history: (id, n) => __call('history', id, n ?? 50),
  portfolio: () => __call('portfolio'),
  orders: () => __call('orders'),
  order: (o) => __call('order', o),
  buy: (marketId, outcome, price, size) => __call('order', { marketId, outcome, side: 'buy', type: 'limit', price, size }),
  sell: (marketId, outcome, price, size) => __call('order', { marketId, outcome, side: 'sell', type: 'limit', price, size }),
  marketBuy: (marketId, outcome, amount) => __call('order', { marketId, outcome, side: 'buy', type: 'market', amount }),
  marketSell: (marketId, outcome, size) => __call('order', { marketId, outcome, side: 'sell', type: 'market', size }),
  cancel: (orderId) => __call('cancel', orderId),
  cancelAll: (marketId) => __call('cancelAll', marketId),
  leaderboard: () => [],
  event: () => null,
  log: (...a) => __call('log', 'info', a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
};
const console = { log: pm.log, info: pm.log, warn: pm.log, error: (...a) => __call('log', 'error', a.map(String).join(' ')) };
`

function stats(series: number[], periodsPerYear: number) {
  const rets: number[] = []
  for (let i = 1; i < series.length; i++) rets.push(series[i - 1] > 0 ? series[i] / series[i - 1] - 1 : 0)
  const n = rets.length || 1
  const mean = rets.reduce((s, r) => s + r, 0) / n
  const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, n - 1))
  const down = Math.sqrt(rets.reduce((s, r) => s + Math.min(0, r) ** 2, 0) / n)
  let peak = series[0] ?? 0
  let maxDD = 0
  const drawdown: number[] = []
  for (const v of series) {
    peak = Math.max(peak, v)
    const dd = peak > 0 ? v / peak - 1 : 0
    drawdown.push(dd)
    maxDD = Math.min(maxDD, dd)
  }
  return {
    rets,
    drawdown,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(periodsPerYear) : 0,
    sortino: down > 0 ? (mean / down) * Math.sqrt(periodsPerYear) : 0,
    volatility: sd * Math.sqrt(periodsPerYear),
    maxDrawdown: maxDD,
  }
}

export async function runBacktest(input: BacktestInput) {
  if (typeof input.code !== 'string' || !input.code.trim()) fail(400, 'code is required')
  if (input.code.length > 100_000) fail(400, 'code must be under 100KB')
  const ids = [...new Set((input.marketIds ?? []).map(String))].slice(0, MAX_MARKETS)
  if (!ids.length) fail(400, `Pick 1-${MAX_MARKETS} markets to backtest on`)
  if (running >= 3) fail(429, 'Backtester is busy, try again in a few seconds')
  running++
  try {
    return await run(input, ids)
  } finally {
    running--
  }
}

/* ---------------- parameter sweep ---------------- */

export interface SweepInput extends BacktestInput {
  /** 1-2 numeric constants in the code to vary, e.g. [{ name: 'FAST', values: [3, 6, 9] }] */
  params: { name: string; values: number[] }[]
}

const MAX_SWEEP_CELLS = 30
const SWEEP_BUDGET_MS = 90_000

/** Find numeric constants declared as `const NAME = 12` (or in a `const A = 1, B = 2` list). */
export function sweepableParams(code: string) {
  const out: { name: string; value: number }[] = []
  for (const decl of code.matchAll(/^(?:const|let|var)\s+([^;\n]+)/gm)) {
    for (const m of decl[1].matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*(?=,|$|;|\/\/)/g)) {
      if (!out.some((p) => p.name === m[1])) out.push({ name: m[1], value: Number(m[2]) })
    }
  }
  return out
}

function substitute(code: string, name: string, value: number) {
  const re = new RegExp(`(\\b${name.replace(/[$]/g, '\\$')}\\s*=\\s*)(-?\\d+(?:\\.\\d+)?)`)
  if (!re.test(code)) fail(400, `Parameter ${name} is not a numeric constant in the code`)
  return code.replace(re, `$1${value}`)
}

/**
 * Run a strategy over a grid of 1-2 parameters and report Sharpe, return and
 * drawdown per cell. Uses one backtester slot and runs the cells one after another.
 */
export async function runSweep(input: SweepInput) {
  if (typeof input.code !== 'string' || !input.code.trim()) fail(400, 'code is required')
  const params = (input.params ?? []).slice(0, 2).map((p) => ({
    name: String(p?.name ?? ''),
    values: [...new Set((p?.values ?? []).map(Number).filter(Number.isFinite))].slice(0, 12),
  }))
  if (!params.length || params.some((p) => !/^[A-Za-z_$][\w$]*$/.test(p.name) || !p.values.length)) fail(400, 'params must be 1-2 { name, values[] } entries')
  if (params.length === 2 && params[0].name === params[1].name) fail(400, 'Pick two different parameters')
  const xs = params[0].values
  const ys = params[1]?.values ?? [null]
  if (xs.length * ys.length > MAX_SWEEP_CELLS) fail(400, `At most ${MAX_SWEEP_CELLS} combinations per sweep`)
  for (const p of params) substitute(input.code, p.name, p.values[0])
  const ids = [...new Set((input.marketIds ?? []).map(String))].slice(0, MAX_MARKETS)
  if (!ids.length) fail(400, `Pick 1-${MAX_MARKETS} markets to backtest on`)
  if (running >= 3) fail(429, 'Backtester is busy, try again in a few seconds')
  running++
  const started = Date.now()
  try {
    const cells = []
    let truncated = false
    for (const y of ys) {
      for (const x of xs) {
        if (Date.now() - started > SWEEP_BUDGET_MS) { truncated = true; break }
        let code = substitute(input.code, params[0].name, x)
        if (y !== null) code = substitute(code, params[1].name, y)
        const r = await run({ ...input, code }, ids)
        cells.push({
          x, y, ok: r.ok, error: r.error,
          sharpe: r.stats.sharpe, totalReturn: r.stats.totalReturn, maxDrawdown: r.stats.maxDrawdown,
          trades: r.stats.trades, winRate: r.stats.winRate, finalEquity: r.stats.finalEquity,
        })
      }
      if (truncated) break
    }
    const ok = cells.filter((c) => c.ok)
    const best = ok.reduce<(typeof cells)[number] | null>((b, c) => (!b || c.sharpe > b.sharpe ? c : b), null)
    return { params, cells, best, truncated, ms: Date.now() - started }
  } finally {
    running--
  }
}

async function run(input: BacktestInput, ids: string[]) {
  const range = ['1d', '1w', '1m', 'all'].includes(String(input.range)) ? String(input.range) : '1m'
  const startCash = Math.min(Math.max(Number(input.cash) || 1000, 1), 10_000_000)
  const spread = Math.min(Math.max(Number(input.spread ?? 0.02), 0), 0.2)
  const feeRate = Math.min(Math.max(Number(input.feeBps ?? 0), 0), 1000) / 10_000

  const markets: PMMarket[] = []
  for (const id of ids) {
    const m = await marketById(id)
    if (m) markets.push(m)
  }
  if (!markets.length) fail(404, 'None of those markets were found')
  const hist = await Promise.all(markets.map((m) => pmHistory(m, range)))

  // Regular time grid. Each market's history is sampled at slightly different
  // timestamps, so bars use the typical sampling step of the series instead of
  // the union of timestamps (which would create near-zero-length bars).
  const all = hist.flat().map((p) => p.t)
  if (all.length < 2) fail(400, 'Not enough price history for these markets in that range')
  const t0 = Math.min(...all)
  const t1 = Math.max(...all)
  const steps = hist.flatMap((h) => h.slice(1).map((p, i) => p.t - h[i].t)).filter((d) => d > 0).sort((a, b) => a - b)
  let step = steps[Math.floor(steps.length / 2)] || 3600
  if ((t1 - t0) / step > MAX_BARS) step = (t1 - t0) / MAX_BARS
  const grid: number[] = []
  for (let t = t0; t <= t1 + 1e-6; t += step) grid.push(Math.round(t))
  if (grid.length < 2) fail(400, 'Not enough price history for these markets in that range')
  // forward-filled price matrix: prices[m][bar] (null before the market has data)
  const prices: (number | null)[][] = hist.map((h) => {
    const out: (number | null)[] = []
    let j = 0
    let last: number | null = null
    for (const t of grid) {
      while (j < h.length && h[j].t <= t) last = h[j++].p
      out.push(last)
    }
    return out
  })
  const idx = new Map(markets.map((m, i) => [m.id, i]))

  /* ---------------- simulated account ---------------- */
  let bar = 0
  let cash = startCash
  const pos = new Map<string, { yes: number; no: number; yesCost: number; noCost: number }>()
  const orders: SimOrder[] = []
  const fills: SimFill[] = []
  const logs: { t: number; level: string; msg: string }[] = []
  let orderSeq = 0
  let fees = 0

  const getPos = (id: string) => {
    let p = pos.get(id)
    if (!p) pos.set(id, (p = { yes: 0, no: 0, yesCost: 0, noCost: 0 }))
    return p
  }
  const mid = (id: string, outcome: Outcome = 'yes') => {
    const p = prices[idx.get(id)!][bar]
    if (p === null) return null
    return outcome === 'yes' ? p : 1 - p
  }
  const quote = (id: string, outcome: Outcome) => {
    const m = mid(id, outcome)
    if (m === null) return null
    return { bid: Math.max(0.001, px(m - spread / 2)), ask: Math.min(0.999, px(m + spread / 2)) }
  }
  const reservedCash = () => orders.reduce((s, o) => s + (o.status === 'open' && o.side === 'buy' ? (o.size - o.filled) * o.price : 0), 0)
  const reservedShares = (id: string, outcome: Outcome) =>
    orders.reduce((s, o) => s + (o.status === 'open' && o.side === 'sell' && o.marketId === id && o.outcome === outcome ? o.size - o.filled : 0), 0)

  const title = (id: string) => markets[idx.get(id)!].groupTitle
  const fill = (o: SimOrder, q: number, price: number) => {
    const p = getPos(o.marketId)
    const ck = o.outcome === 'yes' ? 'yesCost' : 'noCost'
    const value = price * q
    const fee = value * feeRate
    fees += fee
    let pnl: number | null = null
    if (o.side === 'buy') {
      cash -= value + fee
      p[o.outcome] = shares(p[o.outcome] + q)
      p[ck] += value + fee
    } else {
      const avg = p[o.outcome] > 0 ? p[ck] / p[o.outcome] : 0
      cash += value - fee
      pnl = value - fee - avg * q
      p[o.outcome] = shares(p[o.outcome] - q)
      p[ck] = p[o.outcome] <= 0 ? 0 : p[ck] - avg * q
    }
    o.filled = shares(o.filled + q)
    if (o.filled >= o.size - 1e-9) o.status = 'filled'
    fills.push({ t: grid[bar], marketId: o.marketId, title: title(o.marketId), side: o.side, outcome: o.outcome, price: px(price), size: q, pnl: pnl === null ? null : money(pnl) })
  }

  const place = (raw: Record<string, unknown>) => {
    const marketId = String(raw.marketId)
    if (!idx.has(marketId)) throw new Error(`Market ${marketId} is not part of this backtest`)
    const side = String(raw.side) as Side
    const outcome = String(raw.outcome ?? '').toLowerCase() as Outcome
    if (side !== 'buy' && side !== 'sell') throw new Error('side must be buy or sell')
    if (outcome !== 'yes' && outcome !== 'no') throw new Error('outcome must be yes or no')
    const q = quote(marketId, outcome)
    if (!q) throw new Error('Market has no price yet at this bar')
    const type = raw.type === 'market' || (raw.price === undefined && raw.type !== 'limit') ? 'market' : 'limit'
    const o: SimOrder = { id: `bt_${++orderSeq}`, marketId, side, outcome, type, price: 0, size: 0, filled: 0, status: 'open', createdAt: grid[bar] }
    if (type === 'limit') {
      o.price = px(Number(raw.price))
      o.size = shares(Number(raw.size))
      if (!(o.price > 0 && o.price < 1)) throw new Error('price must be between 0 and 1')
      if (!(o.size >= 0.01)) throw new Error('size must be at least 0.01')
    } else if (side === 'buy') {
      const amount = Number(raw.amount)
      if (!(amount > 0)) throw new Error('amount (dollars) required for market buys')
      o.price = q.ask
      o.size = shares(amount / (q.ask * (1 + feeRate)))
    } else {
      o.price = q.bid
      o.size = shares(Number(raw.size))
    }
    if (side === 'buy') {
      const need = o.size * o.price * (1 + feeRate)
      const avail = cash - reservedCash()
      if (need > avail + 1e-9) throw new Error(`Insufficient cash: need $${need.toFixed(2)}, available $${avail.toFixed(2)}`)
    } else {
      const avail = getPos(marketId)[outcome] - reservedShares(marketId, outcome)
      if (o.size > avail + 1e-9) throw new Error(`Insufficient ${outcome.toUpperCase()} shares: have ${shares(avail)}`)
    }
    orders.push(o)
    // marketable now?
    if (side === 'buy' && q.ask <= o.price + 1e-9) fill(o, o.size, q.ask)
    else if (side === 'sell' && q.bid >= o.price - 1e-9) fill(o, o.size, q.bid)
    if (type === 'market' && o.status === 'open') o.status = 'cancelled'
    return { order: { ...o }, avgPrice: o.filled > 0 ? (side === 'buy' ? q.ask : q.bid) : null, cash: money(cash) }
  }

  const sweep = () => {
    for (const o of orders) {
      if (o.status !== 'open') continue
      const q = quote(o.marketId, o.outcome)
      if (!q) continue
      if (o.side === 'buy' && q.ask <= o.price) fill(o, o.size - o.filled, o.price)
      else if (o.side === 'sell' && q.bid >= o.price) fill(o, o.size - o.filled, o.price)
    }
  }

  const positionsValue = () => {
    let v = 0
    for (const [id, p] of pos) {
      const y = mid(id, 'yes')
      if (y === null) continue
      v += p.yes * y + p.no * (1 - y)
    }
    return v
  }

  const marketView = (m: PMMarket) => {
    const y = mid(m.id, 'yes')
    const q = quote(m.id, 'yes')
    return {
      id: m.id, eventId: m.eventId, title: m.groupTitle, question: m.question, outcomes: m.outcomes,
      price: y, bestBid: q?.bid ?? null, bestAsk: q?.ask ?? null, endDate: m.endDate, active: y !== null, enabled: true,
    }
  }

  /* ---------------- sandbox ---------------- */
  const QuickJS = await getQuickJS()
  const rt = QuickJS.newRuntime()
  rt.setMemoryLimit(64 * 1024 * 1024)
  rt.setMaxStackSize(1024 * 1024)
  const deadline = Date.now() + DEADLINE_MS
  rt.setInterruptHandler(shouldInterruptAfterDeadline(deadline))
  const ctx = rt.newContext()
  let error: string | null = null
  const equity: { t: number; equity: number; cash: number; exposure: number }[] = []
  try {
    const host = ctx.newFunction('__host', (opH, argsH) => {
      const op = ctx.getString(opH)
      const args = JSON.parse(ctx.getString(argsH)) as unknown[]
      try {
        let data: unknown = null
        switch (op) {
          case 'now': data = grid[bar] * 1000; break
          case 'log':
            if (logs.length < MAX_LOGS) logs.push({ t: grid[bar], level: String(args[0]), msg: String(args[1]).slice(0, 500) })
            break
          case 'markets': {
            const lim = Number((args[0] as { limit?: number })?.limit) || markets.length
            data = markets.filter((m) => mid(m.id) !== null).slice(0, lim).map(marketView)
            break
          }
          case 'market': {
            const m = markets[idx.get(String(args[0])) ?? -1]
            if (!m) throw new Error('Market not in this backtest')
            data = marketView(m)
            break
          }
          case 'book': {
            const q = quote(String(args[0]), 'yes')
            data = q ? { source: 'backtest', quotedIn: 'yes', bids: [{ price: q.bid, size: 1e6 }], asks: [{ price: q.ask, size: 1e6 }], last: mid(String(args[0])) } : { bids: [], asks: [], last: null }
            break
          }
          case 'history': {
            const i = idx.get(String(args[0]))
            if (i === undefined) throw new Error('Market not in this backtest')
            const n = Math.min(Math.max(Number(args[1]) || 50, 1), 1000)
            const out: { t: number; p: number }[] = []
            for (let k = Math.max(0, bar - n + 1); k <= bar; k++) {
              const p = prices[i][k]
              if (p !== null) out.push({ t: grid[k], p })
            }
            data = out
            break
          }
          case 'portfolio': {
            const positions = [...pos].flatMap(([id, p]) => (['yes', 'no'] as const).filter((o) => p[o] > 0).map((o) => ({
              marketId: id, title: title(id), outcome: o, size: p[o], avgPrice: px((o === 'yes' ? p.yesCost : p.noCost) / p[o]), curPrice: mid(id, o),
            })))
            const value = cash + positionsValue()
            data = { cash: money(cash), availableCash: money(cash - reservedCash()), positionsValue: money(positionsValue()), value: money(value), pnl: money(value - startCash), positions }
            break
          }
          case 'orders': data = orders.filter((o) => o.status === 'open').map((o) => ({ ...o, remaining: shares(o.size - o.filled) })); break
          case 'order': data = place(args[0] as Record<string, unknown>); break
          case 'cancel': {
            const o = orders.find((x) => x.id === String(args[0]))
            if (o && o.status === 'open') o.status = 'cancelled'
            data = o ?? null
            break
          }
          case 'cancelAll': {
            let n = 0
            for (const o of orders) if (o.status === 'open' && (!args[0] || o.marketId === String(args[0]))) { o.status = 'cancelled'; n++ }
            data = { cancelled: n }
            break
          }
          default: throw new Error(`unknown op ${op}`)
        }
        return ctx.newString(JSON.stringify({ data }))
      } catch (err) {
        return ctx.newString(JSON.stringify({ error: (err as Error).message }))
      }
    })
    ctx.setProp(ctx.global, '__host', host)
    host.dispose()

    const program = `${PRELUDE}\n${input.code}\n;globalThis.__init = () => { if (typeof initialize === 'function') initialize(pm) };\nglobalThis.__tick = () => { if (typeof onTick === 'function') onTick(pm) };`
    const evalRes = ctx.evalCode(program, 'strategy.js')
    if (evalRes.error) {
      const e = ctx.dump(evalRes.error)
      evalRes.error.dispose()
      throw new Error(e?.message ? `${e.name ?? 'Error'}: ${e.message}` : String(e))
    }
    evalRes.value.dispose()
    const initFn = ctx.getProp(ctx.global, '__init')
    const tickFn = ctx.getProp(ctx.global, '__tick')
    const call = (fn: typeof tickFn) => {
      const r = ctx.callFunction(fn, ctx.undefined)
      if (r.error) {
        const e = ctx.dump(r.error)
        r.error.dispose()
        throw new Error(e?.message ? `${e.name ?? 'Error'}: ${e.message}` : String(e))
      }
      r.value.dispose()
    }
    try {
      call(initFn)
      for (bar = 0; bar < grid.length; bar++) {
        sweep()
        call(tickFn)
        const pv = positionsValue()
        equity.push({ t: grid[bar], equity: money(cash + pv), cash: money(cash), exposure: cash + pv > 0 ? pv / (cash + pv) : 0 })
      }
    } finally {
      initFn.dispose()
      tickFn.dispose()
    }
  } catch (err) {
    error = (err as Error).message
    if (Date.now() > deadline) error = `Timed out after ${DEADLINE_MS / 1000}s at bar ${bar}/${grid.length}. ${error}`
  } finally {
    try { ctx.dispose(); rt.dispose() } catch { /* interrupted VM */ }
  }
  if (bar >= grid.length) bar = grid.length - 1

  // settle markets that have resolved on Polymarket (if the backtest runs to the end of their history)
  const settlements: { marketId: string; title: string; payout: [number, number]; value: number }[] = []
  if (!error) {
    for (const m of markets) {
      if (!m.resolved || !m.payout) continue
      const p = pos.get(m.id)
      if (!p || (p.yes <= 0 && p.no <= 0)) continue
      const value = p.yes * m.payout[0] + p.no * m.payout[1]
      const cost = p.yesCost + p.noCost
      fills.push({ t: grid[grid.length - 1], marketId: m.id, title: m.groupTitle, side: 'sell', outcome: m.payout[0] === 1 ? 'yes' : 'no', price: m.payout[0], size: p.yes + p.no, pnl: money(value - cost) })
      cash += value
      settlements.push({ marketId: m.id, title: m.groupTitle, payout: m.payout, value: money(value) })
      pos.delete(m.id)
    }
    if (settlements.length && equity.length) {
      const last = equity[equity.length - 1]
      last.equity = money(cash + positionsValue())
      last.cash = money(cash)
    }
  }

  // benchmark: split cash equally and buy-and-hold YES at each market's first price
  const firstIdx = prices.map((row) => row.findIndex((p) => p !== null))
  const bench = grid.map((t, b) => {
    let v = 0
    markets.forEach((_, i) => {
      const f = firstIdx[i]
      const alloc = startCash / markets.length
      if (f < 0 || b < f) { v += alloc; return }
      const entry = Math.min(0.999, prices[i][f]! + spread / 2)
      v += (alloc / entry) * (prices[i][b] ?? 0)
    })
    return { t, equity: money(v) }
  })

  const series = equity.map((e) => e.equity)
  const dt = step
  const ppy = (365 * 86400) / dt
  const s = stats(series, ppy)
  const b = stats(bench.map((x) => x.equity), ppy)
  const n = Math.min(s.rets.length, b.rets.length)
  const mb = b.rets.slice(0, n).reduce((a, x) => a + x, 0) / (n || 1)
  const ms = s.rets.slice(0, n).reduce((a, x) => a + x, 0) / (n || 1)
  let cov = 0, varB = 0
  for (let i = 0; i < n; i++) { cov += (s.rets[i] - ms) * (b.rets[i] - mb); varB += (b.rets[i] - mb) ** 2 }
  const beta = varB > 0 ? cov / varB : 0
  const closed = fills.filter((f) => f.pnl !== null)
  const wins = closed.filter((f) => (f.pnl ?? 0) > 0)
  const final = series[series.length - 1] ?? startCash
  const years = (grid[grid.length - 1] - grid[0]) / (365 * 86400)

  return {
    ok: !error,
    error,
    config: { range, cash: startCash, spread, feeBps: feeRate * 10_000, bars: grid.length, barSeconds: dt },
    markets: markets.map((m) => ({ id: m.id, title: m.groupTitle, question: m.question, eventSlug: catalog.events.get(m.eventId)?.slug ?? null, resolved: m.resolved })),
    stats: {
      startEquity: startCash,
      finalEquity: money(final),
      totalReturn: final / startCash - 1,
      benchmarkReturn: (bench[bench.length - 1]?.equity ?? startCash) / startCash - 1,
      annualizedReturn: years > 0.002 ? Math.sign(final / startCash) * (Math.abs(final / startCash) ** (1 / years) - 1) : null,
      sharpe: s.sharpe,
      sortino: s.sortino,
      volatility: s.volatility,
      maxDrawdown: s.maxDrawdown,
      beta,
      alpha: (ms - beta * mb) * ppy,
      trades: fills.length,
      closedTrades: closed.length,
      winRate: closed.length ? wins.length / closed.length : null,
      avgWin: wins.length ? wins.reduce((a, f) => a + (f.pnl ?? 0), 0) / wins.length : null,
      avgLoss: closed.length - wins.length ? closed.filter((f) => (f.pnl ?? 0) <= 0).reduce((a, f) => a + (f.pnl ?? 0), 0) / (closed.length - wins.length) : null,
      exposure: equity.length ? equity.reduce((a, e) => a + e.exposure, 0) / equity.length : 0,
      fees: money(fees),
    },
    equity: equity.map((e, i) => ({ ...e, drawdown: s.drawdown[i], benchmark: bench[i]?.equity ?? null })),
    fills: fills.slice(-1000),
    openOrders: orders.filter((o) => o.status === 'open'),
    settlements,
    logs,
  }
}

/* ---------------- scanner ---------------- */

interface ClobCheck { checkedAt: number; sumAsk: number | null; sumBid: number | null; arb: string | null; size: number; profit: number; edge: number | null }

let scanCache: { at: number; data: Awaited<ReturnType<typeof scan>> } | null = null
let scanPending: ReturnType<typeof scan> | null = null

export async function scanner() {
  if (scanCache && Date.now() - scanCache.at < 30_000) return scanCache.data
  scanPending ??= scan().then((data) => { scanCache = { at: Date.now(), data }; return data }).finally(() => { scanPending = null })
  return scanPending
}

async function scan() {
  const events = [...catalog.events.values()].filter((e) => !e.closed)
  const mk = (id: string) => catalog.markets.get(id)
  const mid = (m: PMMarket) =>
    m.bestBid !== null && m.bestAsk !== null && m.bestAsk - m.bestBid <= 0.1 ? (m.bestBid + m.bestAsk) / 2 : (m.lastTrade ?? m.price)
  const ref = (m: PMMarket) => {
    const e = catalog.events.get(m.eventId)
    return { marketId: m.id, title: m.groupTitle, question: m.question, eventSlug: e?.slug ?? null, eventTitle: e?.title ?? '', image: m.image || e?.icon || '' }
  }

  // 1) negRisk overround: in a one-winner event the YES prices should sum to ~100%
  const overround = events
    .filter((e) => e.negRisk)
    .map((e) => {
      const ms = e.marketIds.map(mk).filter((m): m is PMMarket => !!m && m.active && m.bestBid !== null && m.bestAsk !== null && m.bestAsk >= m.bestBid)
      const sumMid = ms.reduce((s, m) => s + mid(m), 0)
      const sumAsk = ms.reduce((s, m) => s + (m.bestAsk ?? mid(m)), 0)
      const sumBid = ms.reduce((s, m) => s + (m.bestBid ?? mid(m)), 0)
      const total = e.marketIds.filter((id) => mk(id)?.active).length
      // buying every YES at the ask for < $1, or selling every YES at the bid for > $1, locks in a profit
      const arb = sumAsk < 1 ? 'buy-all' : sumBid > 1 ? 'sell-all' : null
      return { eventSlug: e.slug, title: e.title, image: e.icon, outcomes: ms.length, complete: ms.length === total, sumMid, sumAsk, sumBid, arb, volume: e.volume }
    })
    .filter((x) => x.outcomes >= 3 && x.complete && x.volume > 50_000)
    .sort((a, b) => Math.abs(b.sumMid - 1) - Math.abs(a.sumMid - 1))
    .slice(0, 25)
    .map((x) => ({ ...x, clob: null as ClobCheck | null }))

  // Gamma's best bid/ask can be stale. Confirm the top candidates against the
  // live CLOB books before flagging an arb, and size it by top-of-book depth.
  const candidates = overround.filter((x) => x.outcomes <= 40).sort((a, b) => Number(!!b.arb) - Number(!!a.arb)).slice(0, 6)
  await Promise.all(candidates.map(async (x) => {
    const ev = events.find((e) => e.slug === x.eventSlug)
    if (!ev) return
    const ms = ev.marketIds.map(mk).filter((m): m is PMMarket => !!m && m.active)
    try {
      const books = await Promise.all(ms.map((m) => pmBook(m, 'yes', 15_000)))
      if (books.some((b) => !b.asks.length || !b.bids.length)) {
        x.clob = { checkedAt: Date.now(), sumAsk: null, sumBid: null, arb: null, size: 0, profit: 0, edge: null }
        return
      }
      const sumAsk = books.reduce((a, b) => a + b.asks[0].price, 0)
      const sumBid = books.reduce((a, b) => a + b.bids[0].price, 0)
      const arb = sumAsk < 1 - 1e-6 ? 'buy-all' : sumBid > 1 + 1e-6 ? 'sell-all' : null
      // the arb is only as big as the thinnest top-of-book level across every leg
      const size = arb === 'buy-all' ? Math.min(...books.map((b) => b.asks[0].size)) : arb === 'sell-all' ? Math.min(...books.map((b) => b.bids[0].size)) : 0
      const edge = arb === 'buy-all' ? 1 - sumAsk : arb === 'sell-all' ? sumBid - 1 : null
      x.clob = { checkedAt: Date.now(), sumAsk, sumBid, arb, size: money(size), profit: money((edge ?? 0) * size), edge }
      x.arb = arb
    } catch { /* keep the Gamma estimate */ }
  }))
  // live-confirmed arbs first, then by how far the mids are from 100%
  overround.sort((a, b) => Number(!!b.clob?.arb) - Number(!!a.clob?.arb))

  const live = [...catalog.markets.values()].filter((m) => m.active && !m.resolved)
  const movers = live
    .filter((m) => m.volume24h > 10_000 && m.price > 0.03 && m.price < 0.97 && m.change24h !== null)
    .sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))
    .slice(0, 25)
    .map((m) => ({ ...ref(m), price: mid(m), change24h: m.change24h, volume24h: m.volume24h }))

  const now = Date.now()
  const coinflips = live
    .filter((m) => m.endDate && Date.parse(m.endDate) > now && Date.parse(m.endDate) - now < 7 * 86400_000)
    .filter((m) => mid(m) > 0.25 && mid(m) < 0.75 && m.volume > 20_000)
    .sort((a, b) => Date.parse(a.endDate!) - Date.parse(b.endDate!))
    .slice(0, 25)
    .map((m) => ({ ...ref(m), price: mid(m), endDate: m.endDate, volume: m.volume }))

  const spreads = live
    .filter((m) => m.bestBid !== null && m.bestAsk !== null && m.volume24h > 25_000)
    .map((m) => ({ ...ref(m), price: mid(m), spread: (m.bestAsk ?? 0) - (m.bestBid ?? 0), volume24h: m.volume24h }))
    .sort((a, b) => b.spread - a.spread)
    .slice(0, 25)

  // longshots: the favorite-longshot bias says cheap YES tends to be overpriced
  const longshots = live
    .filter((m) => mid(m) > 0.005 && mid(m) < 0.05 && m.volume > 100_000)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 25)
    .map((m) => ({ ...ref(m), price: mid(m), volume: m.volume, endDate: m.endDate }))

  return { generatedAt: now, overround, movers, coinflips, spreads, longshots }
}

export const STRATEGY_TEMPLATES = [
  {
    id: 'momentum',
    name: 'Momentum',
    description: 'Buy YES when the price is above its moving average, sell when it drops below.',
    code: `// Momentum: ride trends using a moving-average crossover.
const FAST = 6, SLOW = 24, BET = 100

function onTick(pm) {
  for (const m of pm.markets()) {
    const h = pm.history(m.id, SLOW)
    if (h.length < SLOW) continue
    const avg = (n) => h.slice(-n).reduce((s, x) => s + x.p, 0) / n
    const fast = avg(FAST), slow = avg(SLOW)
    const held = pm.portfolio().positions.find((p) => p.marketId === m.id && p.outcome === 'yes')
    if (fast > slow + 0.01 && !held) {
      pm.marketBuy(m.id, 'yes', BET)
    } else if (fast < slow - 0.01 && held) {
      pm.marketSell(m.id, 'yes', held.size)
    }
  }
}
`,
  },
  {
    id: 'mean-reversion',
    name: 'Mean reversion',
    description: 'Fade sharp moves: buy dips and sell rips relative to a rolling z-score.',
    code: `// Mean reversion with a rolling z-score.
const LOOKBACK = 48, ENTRY = 2, BET = 100

function zscore(h) {
  const xs = h.map((x) => x.p)
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) || 1e-9
  return (xs[xs.length - 1] - mean) / sd
}

function onTick(pm) {
  for (const m of pm.markets()) {
    const h = pm.history(m.id, LOOKBACK)
    if (h.length < LOOKBACK) continue
    const z = zscore(h)
    const pos = pm.portfolio().positions.filter((p) => p.marketId === m.id)
    if (!pos.length && z < -ENTRY) pm.marketBuy(m.id, 'yes', BET)     // dipped: buy YES
    if (!pos.length && z > ENTRY) pm.marketBuy(m.id, 'no', BET)       // ripped: buy NO
    for (const p of pos) if (Math.abs(z) < 0.25) pm.marketSell(m.id, p.outcome, p.size) // back to mean: exit
  }
}
`,
  },
  {
    id: 'market-maker',
    name: 'Market maker',
    description: 'Quote both sides around the price and earn the spread. Works best in exchange leagues.',
    code: `// Two-sided quoting around mid with inventory skew.
const EDGE = 0.02, SIZE = 50, MAX_INV = 300

function onTick(pm) {
  for (const m of pm.markets({ limit: 3 })) {
    if (m.price === null) continue
    pm.cancelAll(m.id)
    const pf = pm.portfolio()
    const yes = pf.positions.find((p) => p.marketId === m.id && p.outcome === 'yes')?.size ?? 0
    const no = pf.positions.find((p) => p.marketId === m.id && p.outcome === 'no')?.size ?? 0
    const skew = ((yes - no) / MAX_INV) * EDGE // lean against inventory
    const bid = Math.max(0.01, m.price - EDGE - skew)
    const ask = Math.min(0.99, m.price + EDGE - skew)
    if (yes - no < MAX_INV) pm.buy(m.id, 'yes', +bid.toFixed(3), SIZE)       // bid for YES
    if (no - yes < MAX_INV) pm.buy(m.id, 'no', +(1 - ask).toFixed(3), SIZE)  // = offer YES
  }
}
`,
  },
  {
    id: 'longshot-fade',
    name: 'Longshot fade',
    description: 'Favorite-longshot bias: sell overpriced long shots by buying NO under 10¢ YES.',
    code: `// Buy NO on long shots (YES < 10¢) once, hold to resolution.
const MAX_YES = 0.10, BET = 50

function initialize(pm) {
  pm.log('starting with', pm.portfolio().cash)
}

function onTick(pm) {
  for (const m of pm.markets()) {
    if (m.price !== null && m.price < MAX_YES && !pm.store[m.id]) {
      pm.marketBuy(m.id, 'no', BET)
      pm.store[m.id] = true
      pm.log('faded', m.title, 'at YES', m.price)
    }
  }
}
`,
  },
  {
    id: 'buy-hold',
    name: 'Buy & hold',
    description: 'Put an equal slice of cash into YES on every market on the first bar.',
    code: `function onTick(pm) {
  if (pm.store.done) return
  const ms = pm.markets()
  const slice = pm.portfolio().cash / ms.length
  for (const m of ms) pm.marketBuy(m.id, 'yes', slice * 0.99)
  pm.store.done = true
}
`,
  },
]
