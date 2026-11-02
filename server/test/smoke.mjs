const B = process.env.API ?? 'http://localhost:8787'
const j = async (method, path, body, token) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${JSON.stringify(t)}`)
  return t
}
const assert = (c, m) => { if (!c) throw new Error('ASSERT ' + m); console.log('ok -', m) }
const sfx = Date.now() % 100000
const a = await j('POST', '/api/auth/signup', { username: `alice${sfx}`, password: 'secret1' })
const b = await j('POST', '/api/auth/signup', { username: `bob${sfx}`, password: 'secret1' })
const ex = await j('POST', '/api/leagues', { name: 'Ex', mode: 'exchange', houseLiquidity: false }, a.token)
await j('POST', '/api/leagues/join', { inviteCode: ex.inviteCode }, b.token)
const { events } = await j('GET', `/api/events?league=${ex.id}&limit=5`, null, a.token)
const mkt = events[0].markets.find((m) => m.active)
console.log('market', mkt.id, mkt.title, mkt.price)
// alice bids YES 40c x 100; bob buys NO 60c x 60 -> mint 60
await j('POST', `/api/leagues/${ex.id}/orders`, { marketId: mkt.id, side: 'buy', outcome: 'yes', type: 'limit', price: 0.4, size: 100 }, a.token)
const r2 = await j('POST', `/api/leagues/${ex.id}/orders`, { marketId: mkt.id, side: 'buy', outcome: 'no', type: 'limit', price: 0.6, size: 60 }, b.token)
assert(r2.order.status === 'filled' && r2.avgPrice === 0.6, 'bob NO fully filled at 60c (mint)')
const pa = await j('GET', `/api/leagues/${ex.id}/portfolio`, null, a.token)
const pb = await j('GET', `/api/leagues/${ex.id}/portfolio`, null, b.token)
assert(pa.positions[0].size === 60 && pa.positions[0].outcome === 'yes', 'alice has 60 YES')
assert(Math.abs(pa.cash - 9976) < 1e-6 && Math.abs(pa.availableCash - 9960) < 1e-6, 'alice cash 9976, 16 reserved')
assert(Math.abs(pb.cash - 9964) < 1e-6, 'bob cash 9964')
const book = await j('GET', `/api/markets/${mkt.id}/book?league=${ex.id}`, null, a.token)
assert(book.bids[0].price === 0.4 && book.bids[0].size === 40, 'book shows remaining 40 @ 40c')
// bob market-sells 10 NO -> hits alice's yes bid? sell NO = bid side; needs an ask. Instead alice sells 20 YES at 0.55, bob market buys $11 YES
await j('POST', `/api/leagues/${ex.id}/orders`, { marketId: mkt.id, side: 'sell', outcome: 'yes', type: 'limit', price: 0.55, size: 20 }, a.token)
const r3 = await j('POST', `/api/leagues/${ex.id}/orders`, { marketId: mkt.id, side: 'buy', outcome: 'yes', type: 'market', amount: 11 }, b.token)
assert(r3.order.filled === 20 && r3.avgPrice === 0.55, 'bob market-bought 20 YES @55c')
// merge: bob sells 20 YES at 0.5 as limit -> rests? alice bid 0.4 is below; then bob sells 20 NO market -> hits... skip
let threw = false
try { await j('POST', `/api/leagues/${ex.id}/orders`, { marketId: mkt.id, side: 'sell', outcome: 'no', type: 'limit', price: 0.5, size: 1000 }, b.token) } catch { threw = true }
assert(threw, 'cannot oversell NO')
// mirror league
const mi = await j('POST', '/api/leagues', { name: 'Mirror', mode: 'mirror' }, a.token)
const r4 = await j('POST', `/api/leagues/${mi.id}/orders`, { marketId: mkt.id, side: 'buy', outcome: 'yes', type: 'market', amount: 50 }, a.token)
assert(r4.order.filled > 0, `mirror market buy filled ${r4.order.filled} @ ${r4.avgPrice}`)
const r5 = await j('POST', `/api/leagues/${mi.id}/orders`, { marketId: mkt.id, side: 'sell', outcome: 'yes', type: 'market', size: r4.order.filled }, a.token)
assert(r5.order.filled === r4.order.filled, `mirror market sell ${r5.avgPrice}`)
// toggle market off
await j('POST', `/api/leagues/${mi.id}/markets/${mkt.id}`, { enabled: false }, a.token)
threw = false
try { await j('POST', `/api/leagues/${mi.id}/orders`, { marketId: mkt.id, side: 'buy', outcome: 'yes', type: 'market', amount: 5 }, a.token) } catch (e) { threw = /turned off/.test(e.message) }
assert(threw, 'disabled market rejects orders')
await j('POST', `/api/leagues/${mi.id}/markets/${mkt.id}`, { enabled: true }, a.token)
// api key + MCP
const key = await j('POST', '/api/me/api-keys', { name: 'agent' }, a.token)
const mcp = async (method, params, id = 1) => {
  const r = await fetch(B + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key.key}` }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })
  return r.json()
}
const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } })
assert(init.result?.serverInfo?.name === 'polymates', 'mcp initialize')
const tools = await mcp('tools/list', {})
assert(tools.result.tools.length > 10, `mcp tools: ${tools.result.tools.map((t) => t.name).join(',')}`)
const po = await mcp('tools/call', { name: 'place_order', arguments: { league_id: ex.id, market_id: mkt.id, side: 'buy', outcome: 'yes', type: 'limit', price: 0.3, size: 5 } })
assert(!po.result.isError && JSON.parse(po.result.content[0].text).order.status === 'open', 'mcp place_order rests')
// script
const sc = await j('POST', `/api/leagues/${ex.id}/scripts`, { name: 'bot', intervalSec: 60, code: `function onTick(pm){ const p = pm.portfolio(); pm.log('cash', p.cash); pm.store.n = (pm.store.n||0)+1; const ms = pm.markets({limit:2}); pm.log(ms.length, ms[0].title); pm.buy('${mkt.id}','yes',0.2,3) }` }, a.token)
const run = await j('POST', `/api/scripts/${sc.id}/run`, null, a.token)
assert(run.result.ok, `script ran in ${run.result.ms}ms: ${run.logs.map((l) => l.msg).join(' | ')}`)
const run2 = await j('POST', `/api/scripts/${sc.id}/run`, null, a.token)
assert(run2.script.store.n === 2, 'script store persists')
const bad = await j('POST', '/api/leagues/' + ex.id + '/scripts', { name: 'loop', code: 'function onTick(){ while(true){} }' }, a.token)
const run3 = await j('POST', `/api/scripts/${bad.id}/run`, null, a.token)
assert(!run3.result.ok && run3.result.ms < 7000, `infinite loop interrupted: ${run3.result.error}`)
const lb = await j('GET', `/api/leagues/${ex.id}/leaderboard`, null, a.token)
assert(lb.length === 2, 'leaderboard ' + lb.map((r) => `${r.username}:${r.pnl}`).join(' '))
console.log('ALL OK')
