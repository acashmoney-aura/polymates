import { newAsyncContext, shouldInterruptAfterDeadline } from 'quickjs-emscripten'
import { agentApi } from './agent-api.ts'
import { getPerpAsset, listPerpAssets, perpsApi } from './perps.ts'
import { db, markDirty, scriptLogs } from './state.ts'
import type { Script, ScriptLog } from './types.ts'
import { now } from './util.ts'

/**
 * User trading bots run inside a QuickJS WebAssembly sandbox: no network,
 * filesystem, timers or Node APIs — only the `pm` object below, which calls
 * the same agent API that REST and MCP clients use (scoped to the script's
 * owner and league). Each tick gets a fresh VM with a wall-clock deadline
 * and a memory cap; `pm.store` is the only state carried between ticks.
 */

export const MIN_INTERVAL_SEC = 10
const TICK_DEADLINE_MS = 5000
const MEMORY_LIMIT = 32 * 1024 * 1024
const MAX_CALLS_PER_TICK = 200
const MAX_LOGS = 200

const PRELUDE = `
const __call = (op, ...args) => {
  const r = JSON.parse(__host(op, JSON.stringify(args)));
  if (r.error) throw new Error(r.error);
  return r.data;
};
const pm = {
  leagueId: __ctx.leagueId,
  mode: __ctx.mode,
  now: __ctx.now,
  store: __ctx.store ?? {},
  markets: (opts) => __call('markets', opts ?? {}),
  event: (slug) => __call('event', slug),
  market: (marketId) => __call('market', marketId),
  book: (marketId) => __call('book', marketId),
  history: (marketId, n) => __call('history', marketId, n ?? 50),
  portfolio: () => __call('portfolio'),
  orders: () => __call('orders'),
  leaderboard: () => __call('leaderboard'),
  order: (o) => __call('order', o),
  buy: (marketId, outcome, price, size) => __call('order', { marketId, outcome, side: 'buy', type: 'limit', price, size }),
  sell: (marketId, outcome, price, size) => __call('order', { marketId, outcome, side: 'sell', type: 'limit', price, size }),
  marketBuy: (marketId, outcome, amount) => __call('order', { marketId, outcome, side: 'buy', type: 'market', amount }),
  marketSell: (marketId, outcome, size) => __call('order', { marketId, outcome, side: 'sell', type: 'market', size }),
  cancel: (orderId) => __call('cancel', orderId),
  cancelAll: (marketId) => __call('cancelAll', marketId),
  perps: {
    assets: (opts) => __call('perpAssets', opts ?? {}),
    asset: (symbol, range) => __call('perpAsset', symbol, range ?? '1d'),
    positions: (status) => __call('perpPositions', status ?? 'open'),
    open: (o) => __call('perpOpen', o),
    long: (symbol, amount, leverage, opts) => __call('perpOpen', { ...(opts ?? {}), symbol, side: 'long', amount, leverage: leverage ?? 1 }),
    short: (symbol, amount, leverage, opts) => __call('perpOpen', { ...(opts ?? {}), symbol, side: 'short', amount, leverage: leverage ?? 1 }),
    close: (positionId) => __call('perpClose', positionId),
  },
  log: (...a) => __call('log', 'info', a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
};
const console = { log: pm.log, info: pm.log, warn: pm.log, error: (...a) => __call('log', 'error', a.map(String).join(' ')) };
`

export function pushLog(scriptId: string, level: ScriptLog['level'], msg: string) {
  const logs = scriptLogs.get(scriptId) ?? []
  logs.push({ ts: now(), level, msg: msg.slice(0, 2000) })
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS)
  scriptLogs.set(scriptId, logs)
}

export async function runScript(script: Script) {
  const league = db.leagues.get(script.leagueId)
  if (!league) return { ok: false, error: 'league missing' }
  const api = agentApi(script.userId, 'script')
  const perp = perpsApi(script.userId, 'script')
  const ctx = await newAsyncContext()
  ctx.runtime.setMemoryLimit(MEMORY_LIMIT)
  ctx.runtime.setMaxStackSize(512 * 1024)
  ctx.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + TICK_DEADLINE_MS))
  let calls = 0
  const started = now()
  try {
    const host = ctx.newAsyncifiedFunction('__host', async (opH, argsH) => {
      const op = ctx.getString(opH)
      const args = JSON.parse(ctx.getString(argsH)) as unknown[]
      if (++calls > MAX_CALLS_PER_TICK) return ctx.newString(JSON.stringify({ error: 'call limit per tick exceeded' }))
      try {
        let data: unknown
        const L = script.leagueId
        switch (op) {
          case 'log':
            pushLog(script.id, args[0] === 'error' ? 'error' : 'info', String(args[1]))
            break
          case 'markets': data = await api.listMarkets({ leagueId: L, ...(args[0] as object) }); break
          case 'event': data = await api.getEvent(String(args[0]), L); break
          case 'market': data = await api.getMarket(String(args[0]), L); break
          case 'book': data = await api.getBook(String(args[0]), L); break
          case 'history': data = await api.getHistory(String(args[0]), Number(args[1]) || 50); break
          case 'portfolio': data = api.getPortfolio(L); break
          case 'orders': data = api.listOrders(L, 'open'); break
          case 'leaderboard': data = api.getLeaderboard(L); break
          case 'order': data = await api.placeOrder({ ...(args[0] as object), leagueId: L } as never); break
          case 'cancel': data = api.cancelOrder(String(args[0])); break
          case 'cancelAll': data = api.cancelAll(L, args[0] ? String(args[0]) : undefined); break
          case 'perpAssets': data = (await listPerpAssets(args[0] as object)).map((x) => ({ ...x, spark: undefined })); break
          case 'perpAsset': data = await getPerpAsset(String(args[0]), String(args[1] ?? '1d')); break
          case 'perpPositions': data = perp.list(L, args[0] === 'all' || args[0] === 'closed' ? args[0] : 'open').positions; break
          case 'perpOpen': data = await perp.open({ ...(args[0] as object), leagueId: L } as never); break
          case 'perpClose': data = perp.close(String(args[0])); break
          default: throw new Error(`unknown op ${op}`)
        }
        return ctx.newString(JSON.stringify({ data: data ?? null }))
      } catch (err) {
        return ctx.newString(JSON.stringify({ error: (err as Error).message }))
      }
    })
    ctx.setProp(ctx.global, '__host', host)
    host.dispose()
    const ctxObj = { leagueId: script.leagueId, mode: league.mode, now: Date.now(), store: script.store ?? {} }
    const ctxH = ctx.unwrapResult(ctx.evalCode(`(${JSON.stringify(ctxObj)})`))
    ctx.setProp(ctx.global, '__ctx', ctxH)
    ctxH.dispose()

    const program = `${PRELUDE}\n${script.code}\n;if (typeof onTick === 'function') onTick(pm);\nJSON.stringify(pm.store ?? {});`
    const result = await ctx.evalCodeAsync(program, `${script.name}.js`)
    if (result.error) {
      const err = ctx.dump(result.error)
      result.error.dispose()
      throw new Error(typeof err === 'object' && err ? `${err.name ?? 'Error'}: ${err.message ?? JSON.stringify(err)}` : String(err))
    }
    const storeJson = ctx.getString(result.value)
    result.value.dispose()
    if (storeJson.length > 64 * 1024) throw new Error('pm.store exceeds 64KB')
    script.store = JSON.parse(storeJson)
    script.lastError = null
    return { ok: true, ms: now() - started, calls }
  } catch (err) {
    const msg = (err as Error).message ?? String(err)
    script.lastError = msg
    pushLog(script.id, 'error', msg)
    return { ok: false, error: msg, ms: now() - started, calls }
  } finally {
    script.lastRunAt = now()
    script.runs++
    markDirty()
    try {
      ctx.dispose()
    } catch {
      /* VM may be in a broken state after an interrupt */
    }
  }
}

let running = false
export function startScheduler() {
  setInterval(async () => {
    if (running) return
    running = true
    try {
      const due = [...db.scripts.values()].filter(
        (s) => s.enabled && (!s.lastRunAt || Date.now() - s.lastRunAt >= Math.max(MIN_INTERVAL_SEC, s.intervalSec) * 1000),
      )
      for (const s of due) {
        if (!db.members.has(`${s.leagueId}:${s.userId}`)) continue
        await runScript(s)
        // a script that keeps crashing gets switched off
        const recent = (scriptLogs.get(s.id) ?? []).slice(-10)
        if (recent.length === 10 && recent.every((l) => l.level === 'error')) {
          s.enabled = false
          pushLog(s.id, 'error', 'Disabled after 10 consecutive errors')
        }
      }
    } finally {
      running = false
    }
  }, 1000).unref()
}

export const EXAMPLE_SCRIPT = `// Runs every interval inside a sandbox. Use pm.* to read markets and trade.
// pm.store persists between runs (JSON, max 64KB).

function onTick(pm) {
  const markets = pm.markets({ limit: 5, sort: 'volume' })
  for (const m of markets) {
    const yes = m.price            // league price for YES, 0..1
    if (yes < 0.10 && !pm.store[m.id]) {
      // buy $25 of long-shot YES once per market
      const res = pm.marketBuy(m.id, 'yes', 25)
      pm.store[m.id] = res.order.id
      pm.log('bought', m.title, 'avg', res.avgPrice)
    }
  }
}
`
