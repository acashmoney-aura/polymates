const B = process.env.API ?? 'http://localhost:8787'
const j = async (m, p, b, t) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.json(); if (!r.ok) throw new Error(JSON.stringify(x)); return x }
const u = await j('POST', '/api/auth/signup', { username: `bt${Date.now() % 1e6}`, password: 'secret1' })
const { events } = await j('GET', '/api/events?tag=politics&limit=40')
const ids = events.flatMap((e) => e.markets).filter((m) => m.price > 0.15 && m.price < 0.85).slice(0, 4).map((m) => m.id)
console.log('markets', ids)
const templates = await j('GET', '/api/backtest/templates')
for (const t of templates) {
  const t0 = Date.now()
  const r = await j('POST', '/api/backtest', { code: t.code, marketIds: ids, range: '1m', cash: 1000 }, u.token)
  const s = r.stats
  console.log(t.id.padEnd(15), r.ok ? 'ok ' : 'ERR', `${Date.now() - t0}ms bars=${r.config.bars} ret=${(s.totalReturn * 100).toFixed(2)}% bench=${(s.benchmarkReturn * 100).toFixed(2)}% sharpe=${s.sharpe.toFixed(2)} dd=${(s.maxDrawdown * 100).toFixed(1)}% trades=${s.trades} win=${s.winRate}`, r.error ?? '', r.logs.slice(0, 1).map((l) => l.msg).join())
}
// lookahead / sandbox checks
const bad = await j('POST', '/api/backtest', { code: 'function onTick(pm){ while(true){} }', marketIds: ids.slice(0, 1), range: '1w' }, u.token)
console.log('infinite loop ->', bad.ok, bad.error)
const sc = await j('GET', '/api/quant/scanner')
console.log('scanner', Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])), sc.overround[0])
// parameter sweep over the momentum template's FAST x SLOW
const mom = templates.find((t) => t.id === 'momentum')
const params = await j('POST', '/api/backtest/params', { code: mom.code })
if (!params.some((p) => p.name === 'FAST')) throw new Error('sweep params missing FAST')
const sw = await j('POST', '/api/backtest/sweep', { code: mom.code, marketIds: ids.slice(0, 2), range: '1m', params: [{ name: 'FAST', values: [3, 6] }, { name: 'SLOW', values: [12, 24] }] }, u.token)
if (sw.cells.length !== 4 || !sw.best) throw new Error(`sweep returned ${sw.cells.length} cells`)
console.log('sweep', sw.cells.map((c) => `${c.x}/${c.y}:${c.sharpe.toFixed(2)}`).join(' '), `${sw.ms}ms`)
const tooBig = await fetch(`${B}/api/backtest/sweep`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${u.token}` }, body: JSON.stringify({ code: mom.code, marketIds: ids, params: [{ name: 'FAST', values: [1, 2, 3, 4, 5, 6] }, { name: 'SLOW', values: [10, 20, 30, 40, 50, 60] }] }) })
console.log('36-cell sweep ->', tooBig.status)
const vol = await j('GET', '/api/quant/volatility?limit=5')
const cone = vol.markets[0] ? await j('GET', `/api/markets/${vol.markets[0].marketId}/volcone`) : null
console.log('volatility', vol.markets.length, 'cone windows', cone?.cone.map((c) => c.window).join(','))
console.log('scanner clob-checked', sc.overround.filter((o) => o.clob).length)
