// Leaderboard periods, sorting, biggest wins, chart, profile and MCP tools.
// Starts its own server (DEV_TOOLS=1, temp state file) so it can backdate trades:
//   node test/leaderboard.mjs
// or point it at a server you started with DEV_TOOLS=1: API=http://localhost:8799 node test/leaderboard.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const DAY = 86_400_000
const HOUR = 3_600_000
let BASE = process.env.API
let child = null
if (!BASE) {
  const port = await new Promise((resolve) => {
    const srv = net.createServer().listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)) })
  })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-lb-'))
  child = spawn(process.execPath, ['src/index.ts'], {
    cwd: path.join(path.dirname(new URL(import.meta.url).pathname), '..'),
    env: { ...process.env, PORT: String(port), DEV_TOOLS: '1', STATE_FILE: path.join(dir, 'state.json'), STATE_BUCKET: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  BASE = `http://localhost:${port}`
}
const done = (code) => { child?.kill(); process.exit(code) }
const ok = (c, m) => { if (!c) { console.error('FAIL', m); done(1) } else console.log('ok', m) }
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps
async function call(p, { method = 'GET', body, token } = {}) {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => null)
  if (!r.ok && !p.includes('period=never')) throw new Error(`${method} ${p} ${r.status} ${JSON.stringify(j)}`)
  return { status: r.status, j }
}
const get = async (p, token) => (await call(p, { token })).j
const post = async (p, body, token) => (await call(p, { method: 'POST', body, token })).j
const at = (offsetMs) => post('/api/dev/clock', { offsetMs })

try {
  for (let i = 0; ; i++) {
    try { await fetch(BASE + '/healthz'); break } catch { if (i > 60) throw new Error('server did not start'); await new Promise((r) => setTimeout(r, 250)) }
  }
  await at(-21 * DAY)
  const sfx = Math.random().toString(36).slice(2, 7)
  const mk = async (n) => post('/api/auth/signup', { username: `${n}_${sfx}`, password: 'secret123', displayName: n })
  const [A, B, C] = [await mk('ada'), await mk('ben'), await mk('cy')]
  const L = await post('/api/leagues', { name: 'LB test', mode: 'exchange', houseLiquidity: false }, A.token)
  for (const u of [B, C]) await post('/api/leagues/join', { inviteCode: L.inviteCode }, u.token)

  let events = []
  for (let i = 0; i < 60 && events.length < 2; i++) {
    events = (await get(`/api/events?league=${L.id}&limit=30`, A.token)).events.filter((e) => e.markets.some((m) => m.active && !m.resolved))
    if (events.length < 2) await new Promise((r) => setTimeout(r, 1000))
  }
  const [e1, e2] = events
  const m1 = e1.markets.find((m) => m.active && !m.resolved).id
  const m2 = e2.markets.find((m) => m.active && !m.resolved).id
  const order = (u, marketId, side, outcome, price, size) =>
    post(`/api/leagues/${L.id}/orders`, { marketId, side, outcome, type: 'limit', price, size }, u.token)

  // 20 days ago: Ada buys 100 YES @30c, Ben 100 NO @70c (mint)
  await at(-20 * DAY)
  await order(A, m1, 'buy', 'yes', 0.3, 100)
  await order(B, m1, 'buy', 'no', 0.7, 100)
  // 3 days ago: Ada sells her 100 YES to Cy @50c  -> Ada closes 30 -> 50
  await at(-3 * DAY)
  await order(A, m1, 'sell', 'yes', 0.5, 100)
  await order(C, m1, 'buy', 'yes', 0.5, 100)
  // 2 days ago: second market, Ada 10 YES @20c vs Ben 10 NO @80c; it resolves YES 30h ago
  await at(-2 * DAY)
  await order(A, m2, 'buy', 'yes', 0.2, 10)
  await order(B, m2, 'buy', 'no', 0.8, 10)
  await at(-30 * HOUR)
  await post('/api/dev/settle', { marketId: m2, outcome: 'yes' })
  // 1 hour ago: merge at 60c. Ben sells 50 NO @40c, Cy sells 50 YES @60c
  await at(-1 * HOUR)
  await order(B, m1, 'sell', 'no', 0.4, 50)
  await order(C, m1, 'sell', 'yes', 0.6, 50)
  await at(0)

  const board = async (q = '') => {
    const rows = await get(`/api/leagues/${L.id}/leaderboard${q}`, A.token)
    return { rows, by: Object.fromEntries(rows.map((r) => [r.displayName, r])) }
  }
  const expect = {
    all: { ada: 28, ben: -38, cy: 10 },
    month: { ada: 28, ben: -38, cy: 10 },
    week: { ada: 28, ben: -38, cy: 10 },
    day: { ada: 0, ben: -10, cy: 10 },
  }
  for (const [period, exp] of Object.entries(expect)) {
    const { rows, by } = await board(`?period=${period}`)
    ok(rows.length === 3 && Object.entries(exp).every(([n, v]) => near(by[n].pnl, v)),
      `${period} pnl ${rows.map((r) => `${r.displayName}:${r.pnl}`).join(' ')}`)
    ok(near(rows.reduce((s, r) => s + r.pnl, 0), 0), `${period} zero-sum`)
    ok(rows.every((r, i) => r.rank === i + 1 && (i === 0 || rows[i - 1].pnl >= r.pnl)), `${period} ranked by pnl`)
  }
  // all-time matches the portfolio endpoint
  for (const u of [A, B, C]) {
    const pf = await get(`/api/leagues/${L.id}/portfolio`, u.token)
    const { by } = await board('?period=all')
    ok(near(by[u.user.displayName].pnl, pf.pnl, 0.001), `${u.user.displayName} all-time pnl = portfolio pnl (${pf.pnl})`)
  }

  let { rows, by } = await board('?period=all&sort=volume')
  ok(rows.map((r) => r.displayName).join() === 'ben,ada,cy' && near(by.ben.volume, 98) && near(by.ada.volume, 82) && near(by.cy.volume, 80),
    `volume sort ${rows.map((r) => `${r.displayName}:${r.volume}`).join(' ')}`)
  ok(by.ada.trades === 3 && by.ben.trades === 3 && by.cy.trades === 2, 'trade counts')
  ;({ rows, by } = await board('?period=day&sort=volume'))
  ok(rows[0].displayName === 'cy' && near(by.cy.volume, 30) && near(by.ben.volume, 20) && by.ada.volume === 0, 'day volume')
  ;({ rows } = await board('?period=day&sort=return'))
  ok(rows.map((r) => r.displayName).join() === 'cy,ada,ben' && rows[0].pnlPct > 0 && rows[2].pnlPct < 0, 'return sort')
  ;({ by } = await board('?period=week'))
  ok(by.ada.winRate === 1 && by.ben.winRate === 0 && by.cy.winRate === null, 'win rate on resolved markets')
  ok(by.ada.bestTrade?.marketId === m1 && near(by.ada.bestTrade.cost, 30) && near(by.ada.bestTrade.payout, 50), 'best trade')
  ok(by.ada.streak?.kind === 'win' && by.ada.streak.count === 2 && by.ben.streak?.kind === 'loss', 'streaks')

  const tag = e1.tags?.map((t) => t.slug).find((s) => !e2.tags?.some((t) => t.slug === s))
  if (tag) {
    ;({ by } = await board(`?period=all&category=${tag}`))
    ok(near(by.ada.pnl, 20) && near(by.ben.pnl, -30) && near(by.cy.pnl, 10), `category ${tag} counts only its markets`)
  }
  ok((await call(`/api/leagues/${L.id}/leaderboard?period=never`, { token: A.token })).status === 400, 'bad period rejected')

  let wins = await get(`/api/leagues/${L.id}/biggest-wins?period=month`, B.token)
  ok(wins.length === 2 && wins[0].displayName === 'ada' && near(wins[0].cost, 30) && near(wins[0].payout, 50) && near(wins[1].pnl, 8),
    `biggest wins ${wins.map((w) => `${w.displayName} ${w.cost}->${w.payout}`).join(', ')}`)
  wins = await get(`/api/leagues/${L.id}/biggest-wins?period=day`, B.token)
  ok(wins.length === 0, 'no wins closed today')

  const chart = await get(`/api/leagues/${L.id}/leaderboard/chart?period=day`, A.token)
  ;({ by } = await board('?period=day'))
  ok(chart.series.length === 3 && chart.t.length === 25 && chart.series.every((s) => s.values.length === 25 && s.values[0] === 0 && near(s.values.at(-1), by[s.displayName].pnl)),
    'day race chart')
  const wk = await get(`/api/leagues/${L.id}/leaderboard/chart?period=week&users=${C.user.id}`, A.token)
  ok(wk.series.length === 1 && near(wk.series[0].values.at(-1), 10), 'chart for one member')

  const prof = await get(`/api/leagues/${L.id}/members/${A.user.id}/profile?period=week`, C.token)
  ok(prof.displayName === 'ada' && near(prof.pnl, 28) && prof.trades.length === 3 && prof.closed.length === 2 && prof.positions.length === 0, 'member profile')

  await post('/api/dev/snapshot', {})
  ;({ by } = await board('?period=day'))
  ok(near(by.cy.pnl, 10) && near(by.ben.pnl, -10), 'snapshots keep numbers stable')

  // MCP
  const key = (await post('/api/me/api-keys', { name: 't' }, C.token)).key
  let rpcId = 0
  const mcp = async (name, args) => {
    const res = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) })
    const j = await res.json()
    if (j.result?.isError) throw new Error(j.result.content[0].text)
    return JSON.parse(j.result.content[0].text)
  }
  const lb = await mcp('get_leaderboard', { league_id: L.id, period: 'day', sort: 'volume' })
  ok(lb[0].displayName === 'cy' && lb[0].period === 'day', 'mcp get_leaderboard period + sort')
  const bw = await mcp('get_biggest_wins', { league_id: L.id, period: 'week' })
  ok(bw.length === 2 && bw[0].payout > bw[0].cost, 'mcp get_biggest_wins')
  const mp = await mcp('get_member_profile', { league_id: L.id, member: `ben_${sfx}` })
  ok(mp.displayName === 'ben' && mp.positions.length === 1, 'mcp get_member_profile by username')
  console.log('all leaderboard tests passed')
  done(0)
} catch (err) {
  console.error(err)
  done(1)
}
