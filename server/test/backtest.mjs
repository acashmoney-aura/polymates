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
