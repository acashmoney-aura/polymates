// Perps end-to-end test. Needs a local server started with PERPS_TEST=1 so it can pin mark prices:
//   PERPS_TEST=1 PORT=8787 node src/index.ts &
//   API=http://localhost:8787 node test/perps.mjs
const B = process.env.API ?? 'http://localhost:8787'
const j = async (method, path, body, token) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${JSON.stringify(t)}`)
  return t
}
const assert = (c, m) => { if (!c) throw new Error('ASSERT ' + m); console.log('ok -', m) }
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol
const rejects = async (p, re) => { try { await p } catch (e) { return re.test(e.message) } return false }
const price = (symbol, p) => j('POST', '/api/perps/test/price', { symbol, price: p })

const sfx = Date.now() % 100000
const a = await j('POST', '/api/auth/signup', { username: `perpa${sfx}`, password: 'secret1' })
const b = await j('POST', '/api/auth/signup', { username: `perpb${sfx}`, password: 'secret1' })
const lg = await j('POST', '/api/leagues', { name: 'Perps', mode: 'mirror', startingBalance: 10000 }, a.token)
await j('POST', '/api/leagues/join', { inviteCode: lg.inviteCode }, b.token)

// catalog
const assets = await j('GET', '/api/perps/assets')
assert(assets.length > 20, `${assets.length} perp assets`)
for (const c of ['crypto', 'stocks', 'indices', 'commodities']) assert(assets.some((x) => x.category === c), `has ${c}`)
const btc0 = assets.find((x) => x.symbol === 'BTC')
assert(btc0 && btc0.price > 0 && btc0.maxLeverage >= 20, `BTC ${btc0.price} up to ${btc0.maxLeverage}x`)
const crypto = await j('GET', '/api/perps/assets?category=crypto&sort=gainers&limit=5')
assert(crypto.length === 5 && crypto.every((x) => x.category === 'crypto'), 'category filter + limit')
const detail = await j('GET', '/api/perps/assets/btc?range=1d')
assert(detail.symbol === 'BTC' && detail.history.length > 5, `BTC history ${detail.history.length} points`)
assert(await rejects(j('GET', '/api/perps/assets/NOPE'), /not found/), 'unknown asset 404')

const L = lg.id
const cash = async (tok) => (await j('GET', `/api/leagues/${L}/portfolio`, null, tok)).cash
const fee = btc0.feeRate

try {
  // ---- open long 10x, mark up 10%, close for profit ----
  await price('BTC', 100_000)
  const o1 = await j('POST', `/api/leagues/${L}/perps`, { symbol: 'BTC', side: 'long', amount: 1000, leverage: 10 }, a.token)
  const p1 = o1.position
  assert(p1.entryPrice === 100_000 && near(p1.qty, 0.01, 1e-9) && near(p1.margin, 100, 1e-6), 'long: qty 0.01, margin $100')
  assert(near(o1.cash, 10000 - 100 - 1000 * fee, 1e-6), `cash after open ${o1.cash} (fee ${1000 * fee})`)
  const mmr = 1 / (2 * btc0.maxLeverage)
  assert(near(p1.liquidationPrice, (1000 - 100) / (0.01 * (1 - mmr)), 1), `long liq price ${p1.liquidationPrice.toFixed(0)}`)
  await price('BTC', 110_000)
  const pf = await j('GET', `/api/leagues/${L}/portfolio`, null, a.token)
  const open1 = pf.perps.find((x) => x.id === p1.id)
  assert(near(open1.unrealizedPnl, 100, 1e-6), `unrealized P&L +$100 at 110k`)
  assert(near(pf.perpsValue, 200, 0.05) && near(pf.value, pf.cash + pf.positionsValue + pf.perpsValue, 1e-6), `portfolio includes perp equity ${pf.perpsValue}`)
  const lb = await j('GET', `/api/leagues/${L}/leaderboard`, null, a.token)
  const meRow = lb.find((r) => r.userId === a.user.id)
  assert(near(meRow.value, pf.value, 0.05) && meRow.rank === 1, `leaderboard counts perps (value ${meRow.value}, rank ${meRow.rank})`)
  const c1 = await j('POST', `/api/leagues/${L}/perps/${p1.id}/close`, null, a.token)
  const expect1 = 10000 + 100 - 1000 * fee - 1100 * fee
  assert(c1.position.status === 'closed' && near(c1.cash, expect1, 0.05), `closed: cash ${c1.cash.toFixed(2)} ≈ ${expect1.toFixed(2)}`)
  assert(near(c1.position.pnl, 100 - 2100 * fee, 0.05), `realized P&L ${c1.position.pnl.toFixed(2)} after fees`)
  assert(await rejects(j('POST', `/api/leagues/${L}/perps/${p1.id}/close`, null, a.token), /already closed/), 'cannot close twice')

  // ---- short 20x, mark up past liquidation ----
  await price('BTC', 100_000)
  const before = await cash(a.token)
  const o2 = await j('POST', `/api/leagues/${L}/perps`, { symbol: 'BTC', side: 'short', margin: 50, leverage: 20 }, a.token)
  const p2 = o2.position
  assert(near(p2.notional, 1000, 1e-6) && p2.liquidationPrice > 100_000 && p2.liquidationPrice < 105_000, `short liq price ${p2.liquidationPrice.toFixed(0)}`)
  await price('BTC', Math.ceil(p2.liquidationPrice) + 10)
  const l2 = await j('GET', `/api/leagues/${L}/perps?status=all`, null, a.token)
  const liq = l2.positions.find((x) => x.id === p2.id)
  assert(liq.status === 'liquidated' && liq.closeReason === 'liquidation', 'short liquidated on tick')
  assert(near(await cash(a.token), before - 50 - 1000 * fee, 1e-6), 'liquidation loses margin + open fee only')
  assert(near(liq.pnl, -50 - 1000 * fee, 1e-6), `liquidated P&L ${liq.pnl.toFixed(2)}`)

  // ---- take profit and stop loss ----
  await price('BTC', 100_000)
  const o3 = await j('POST', `/api/leagues/${L}/perps`, { symbol: 'BTC', side: 'long', amount: 500, leverage: 5, takeProfit: 105_000, stopLoss: 90_000 }, a.token)
  await price('BTC', 106_000)
  const tp = (await j('GET', `/api/leagues/${L}/perps?status=closed`, null, a.token)).positions.find((x) => x.id === o3.position.id)
  assert(tp?.closeReason === 'tp' && tp.exitPrice === 106_000, 'take profit fired')
  await price('BTC', 100_000)
  const o4 = await j('POST', `/api/leagues/${L}/perps`, { symbol: 'BTC', side: 'short', amount: 500, leverage: 5, stopLoss: 103_000 }, b.token)
  await price('BTC', 103_500)
  const sl = (await j('GET', `/api/leagues/${L}/perps?status=closed`, null, b.token)).positions.find((x) => x.id === o4.position.id)
  assert(sl?.closeReason === 'sl' && near(sl.pnl, -17.5 - 500 * fee - 517.5 * fee, 0.05), `stop loss fired, P&L ${sl.pnl.toFixed(2)}`)

  // ---- validation ----
  assert(await rejects(j('POST', `/api/leagues/${L}/perps`, { symbol: 'BTC', side: 'long', amount: 100, leverage: btc0.maxLeverage + 1 }, a.token), /Leverage/), 'leverage above max rejected')
  assert(await rejects(j('POST', `/api/leagues/${L}/perps`, { symbol: 'BTC', side: 'long', amount: 1e7, leverage: 2 }, a.token), /Not enough cash/), 'not enough cash rejected')
  assert(await rejects(j('POST', `/api/leagues/${L}/perps`, { symbol: 'BTC', side: 'long', amount: 100, leverage: 2, takeProfit: 90_000 }, a.token), /Take profit/), 'bad take profit rejected')
  assert(await rejects(j('POST', `/api/leagues/${L}/perps/${o4.position.id}/close`, null, a.token), /not found/), "cannot close someone else's position")

  // ---- MCP ----
  const key = await j('POST', '/api/me/api-keys', { name: 'perps' }, a.token)
  const mcp = async (name, args) => {
    const r = await fetch(B + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key.key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
    const res = (await r.json()).result
    if (res.isError) throw new Error(res.content[0].text)
    return JSON.parse(res.content[0].text)
  }
  const ml = await mcp('list_perp_assets', { category: 'indices' })
  assert(ml.length > 0 && ml.every((x) => x.category === 'indices'), `mcp list_perp_assets: ${ml.map((x) => x.symbol).join(',')}`)
  const ga = await mcp('get_perp_asset', { symbol: 'ETH', range: '1h' })
  assert(ga.symbol === 'ETH' && ga.history.length > 0, 'mcp get_perp_asset')
  const mo = await mcp('open_perp', { league_id: L, symbol: 'BTC', side: 'long', amount: 200, leverage: 4 })
  assert(mo.position.status === 'open' && mo.position.source === 'mcp', 'mcp open_perp')
  const mlist = await mcp('list_perp_positions', { league_id: L })
  assert(mlist.positions.some((x) => x.id === mo.position.id), 'mcp list_perp_positions')
  const mc = await mcp('close_perp', { position_id: mo.position.id })
  assert(mc.position.status === 'closed', 'mcp close_perp')

  // ---- scripts ----
  const sc = await j('POST', `/api/leagues/${L}/scripts`, { name: 'perpbot', enabled: false, code: `function onTick(pm){
    const btc = pm.perps.asset('BTC', '1h'); pm.log('btc', btc.price)
    const r = pm.perps.long('BTC', 300, 3); pm.log('opened', r.position.id)
    pm.store.n = pm.perps.positions().length
    pm.perps.close(r.position.id)
    pm.store.after = pm.perps.positions().length
    pm.store.assets = pm.perps.assets({ category: 'commodities' }).length
  }` }, a.token)
  const run = await j('POST', `/api/scripts/${sc.id}/run`, null, a.token)
  assert(run.result.ok && run.script.store.n === 1 && run.script.store.after === 0 && run.script.store.assets > 0, `pm.perps from a script: ${run.logs.map((l) => l.msg).join(' | ')}`)
} finally {
  await price('BTC', null).catch(() => {})
}
console.log('ALL OK')
