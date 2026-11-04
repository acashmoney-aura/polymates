// Load test for a bot-competition night: N people trading by hand in one mirror league,
// hosted bot scripts of several strategy types, and a few REST bots polling hard.
//
//   API=http://localhost:8788 HUMANS=40 BOT_USERS=10 REST_BOTS=5 MINUTES=5 SERVER_PID=1234 node server/test/load.mjs
//
// Prints latency percentiles per endpoint, error counts, event-loop lag (from a /healthz probe),
// server CPU/RSS (when SERVER_PID is set) and how well hosted scripts kept their schedule.

import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const B = process.env.API ?? 'http://localhost:8787'
const HUMANS = Number(process.env.HUMANS ?? 40)
const BOT_USERS = Number(process.env.BOT_USERS ?? 10)
const REST_BOTS = Number(process.env.REST_BOTS ?? 5)
const MINUTES = Number(process.env.MINUTES ?? 5)
const MODE = process.env.MODE ?? 'mirror'
const PID = process.env.SERVER_PID
const OUT = process.env.OUT
// for a private Cloud Run service: `IAM_TOKEN=$(gcloud auth print-identity-token)`, sent in the header Cloud Run
// reads instead of Authorization, which the app uses for its own sessions
const IAM = process.env.IAM_TOKEN ? { 'x-serverless-authorization': `Bearer ${process.env.IAM_TOKEN}` } : {}
const sfx = Date.now().toString(36).slice(-5)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rand = (a, b) => a + Math.random() * (b - a)
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)]

/* ---------------- metrics ---------------- */

const stats = new Map() // route -> { ms: [], errors: Map<status, n> }
const record = (route, ms, status) => {
  const s = stats.get(route) ?? { ms: [], errors: new Map() }
  s.ms.push(ms)
  if (status >= 400 || status === 0) s.errors.set(status, (s.errors.get(status) ?? 0) + 1)
  stats.set(route, s)
}
const q = (xs, p) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const errorSamples = []

async function call(route, method, path, body, token, { quiet = false } = {}) {
  const t0 = performance.now()
  let status = 0
  try {
    const r = await fetch(B + path, {
      method,
      headers: { 'content-type': 'application/json', ...IAM, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
    status = r.status
    const data = await r.json().catch(() => null)
    record(route, performance.now() - t0, status)
    if (!r.ok) {
      // 400s from trading (insufficient cash, size too small, closed market) are normal user errors
      if (status >= 500 || !quiet) errorSamples.push(`${status} ${route}: ${JSON.stringify(data)?.slice(0, 160)}`)
      return null
    }
    return data
  } catch (err) {
    record(route, performance.now() - t0, 0)
    errorSamples.push(`ERR ${route}: ${err.message}`)
    return null
  }
}

/* ---------------- bot scripts (run in the server's QuickJS sandbox) ---------------- */

const SCRIPTS = {
  momentum: `
const LOOKBACK = 12, EDGE = 0.02, SIZE = 25
function onTick(pm) {
  for (const m of pm.markets({ limit: 8, sort: 'volume24h' })) {
    const h = pm.history(m.id, LOOKBACK)
    if (h.length < LOOKBACK) continue
    const drift = h[h.length - 1].p - h[0].p
    if (drift > EDGE) pm.marketBuy(m.id, 'yes', SIZE)
    else if (drift < -EDGE) pm.marketBuy(m.id, 'no', SIZE)
  }
}`,
  meanReversion: `
const N = 24, Z = 1.5, SIZE = 20
function onTick(pm) {
  for (const m of pm.markets({ limit: 8, sort: 'volume24h' })) {
    const h = pm.history(m.id, N).map((x) => x.p)
    if (h.length < N) continue
    const mu = h.reduce((a, b) => a + b, 0) / N
    const sd = Math.sqrt(h.reduce((a, b) => a + (b - mu) ** 2, 0) / N) || 1e-9
    const z = (m.price - mu) / sd
    if (z > Z) pm.marketBuy(m.id, 'no', SIZE)
    if (z < -Z) pm.marketBuy(m.id, 'yes', SIZE)
  }
}`,
  marketMaker: `
const HALF = 0.02, SIZE = 30
function onTick(pm) {
  for (const m of pm.markets({ limit: 5, sort: 'volume24h' })) {
    const b = pm.book(m.id)
    const bid = b.bids[0]?.price, ask = b.asks[0]?.price
    if (!(bid > 0 && ask > 0)) continue
    const mid = (bid + ask) / 2
    pm.cancelAll(m.id)
    pm.buy(m.id, 'yes', Math.max(0.01, +(mid - HALF).toFixed(2)), SIZE)
    pm.buy(m.id, 'no', Math.max(0.01, +(1 - mid - HALF).toFixed(2)), SIZE)
  }
  pm.store.ticks = (pm.store.ticks ?? 0) + 1
}`,
  longshotFade: `
function onTick(pm) {
  for (const m of pm.markets({ limit: 40 })) {
    if (m.price > 0.02 && m.price < 0.08 && !pm.store[m.id]) {
      pm.marketBuy(m.id, 'no', 15)
      pm.store[m.id] = 1
    }
  }
}`,
  // the worst case a participant could write: reads a book for every market it can see
  scanner: `
function onTick(pm) {
  const ms = pm.markets({ limit: 60 })
  let wide = 0
  for (const m of ms.slice(0, 60)) {
    const b = pm.book(m.id)
    if ((b.asks[0]?.price ?? 1) - (b.bids[0]?.price ?? 0) > 0.05) wide++
  }
  pm.log('wide spreads', wide, 'of', ms.length)
  pm.portfolio()
}`,
}

/* ---------------- setup ---------------- */

async function signup(name) {
  const r = await call('POST /auth/signup', 'POST', '/api/auth/signup', { username: name, password: 'loadtest1', displayName: name })
  if (!r) throw new Error(`signup failed for ${name}: ${errorSamples.at(-1)}`)
  return r.token
}

console.log(`[load] ${B} · ${HUMANS} humans · ${BOT_USERS} bot users · ${REST_BOTS} REST bots · ${MINUTES} min · ${MODE}`)
const ownerToken = await signup(`lt_owner_${sfx}`)
const league = await call('POST /leagues', 'POST', '/api/leagues', { name: `Load ${sfx}`, mode: MODE, startingBalance: 10_000 }, ownerToken)
if (!league) throw new Error('could not create league: ' + errorSamples.at(-1))

const join = async (name) => {
  const t = await signup(name)
  await call('POST /leagues/join', 'POST', '/api/leagues/join', { inviteCode: league.inviteCode }, t)
  return t
}
const humanTokens = await Promise.all(Array.from({ length: HUMANS }, (_, i) => join(`lt_h${i}_${sfx}`)))
const botTokens = await Promise.all(Array.from({ length: BOT_USERS }, (_, i) => join(`lt_b${i}_${sfx}`)))
const restTokens = await Promise.all(Array.from({ length: REST_BOTS }, (_, i) => join(`lt_r${i}_${sfx}`)))

// what people actually click on: liquid, undecided markets across categories
const pools = await Promise.all(['sports', 'politics', 'crypto', 'esports', 'finance', 'tech'].map((tag) =>
  call('GET /markets', 'GET', `/api/markets?league=${league.id}&limit=100&tag=${tag}`, null, ownerToken)))
const markets = [...new Map(pools.flat().filter(Boolean).filter((m) => m.price > 0.05 && m.price < 0.95).map((m) => [m.id, m])).values()]
if (!markets.length) throw new Error('no tradable markets found')
const slugs = [...new Set(markets.map((m) => m.eventSlug))]
console.log(`[load] league ${league.id} · ${markets.length} tradable markets across ${slugs.length} events`)

// two scripts per bot user, every strategy type represented, all on the 10s minimum interval
const kinds = Object.keys(SCRIPTS)
const scripts = []
for (const [i, t] of botTokens.entries()) {
  for (let k = 0; k < 2; k++) {
    const kind = kinds[(i * 2 + k) % kinds.length]
    const s = await call('POST /scripts', 'POST', `/api/leagues/${league.id}/scripts`, { name: kind, code: SCRIPTS[kind], intervalSec: 10, enabled: true }, t)
    if (s) scripts.push({ ...s, token: t, kind })
  }
}
console.log(`[load] ${scripts.length} hosted scripts enabled (${kinds.join(', ')})`)

/* ---------------- actors ---------------- */

const deadline = Date.now() + MINUTES * 60_000
const running = () => Date.now() < deadline
const streams = []

function openStream(path) {
  const ctl = new AbortController()
  streams.push(ctl)
  let events = 0
  fetch(`${B}${path}`, { signal: ctl.signal, headers: IAM })
    .then(async (r) => {
      const reader = r.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        events += (new TextDecoder().decode(value).match(/^data:/gm) ?? []).length
      }
    })
    .catch(() => {})
  return () => events
}

const tradeStats = { market: 0, limit: 0, sells: 0, cancels: 0 }

/** A person on the website: browse, open an event, sometimes trade, check portfolio and the leaderboard. */
async function human(token) {
  // each browser tab holds the league stream and the live price stream
  const sse = openStream(`/api/stream?league=${league.id}&token=${token}`)
  openStream('/api/live')
  await sleep(rand(0, 5000))
  while (running()) {
    await call('GET /events', 'GET', `/api/events?league=${league.id}&limit=24&compact=1&tag=${pick(['trending', 'sports', 'politics', 'crypto'])}`, null, token)
    const m = pick(markets)
    await Promise.all([
      call('GET /events/:slug', 'GET', `/api/events/${m.eventSlug}?league=${league.id}`, null, token),
      call('GET /markets/:id/book', 'GET', `/api/markets/${m.id}/book?league=${league.id}`, null, token),
      call('GET /markets/:id/history', 'GET', `/api/markets/${m.id}/history?range=1d`, null, token),
    ])
    await sleep(rand(2000, 6000))
    const roll = Math.random()
    if (roll < 0.55) {
      tradeStats.market++
      await call('POST /orders (market)', 'POST', `/api/leagues/${league.id}/orders`,
        { marketId: m.id, side: 'buy', outcome: pick(['yes', 'no']), type: 'market', amount: Math.round(rand(5, 80)) }, token, { quiet: true })
    } else if (roll < 0.75) {
      tradeStats.limit++
      const p = Math.min(0.97, Math.max(0.03, +(m.price - rand(0.01, 0.05)).toFixed(2)))
      await call('POST /orders (limit)', 'POST', `/api/leagues/${league.id}/orders`,
        { marketId: m.id, side: 'buy', outcome: 'yes', type: 'limit', price: p, size: Math.round(rand(10, 100)) }, token, { quiet: true })
    } else if (roll < 0.85) {
      const pf = await call('GET /portfolio', 'GET', `/api/leagues/${league.id}/portfolio`, null, token)
      const pos = pf?.positions?.[0]
      if (pos) {
        tradeStats.sells++
        await call('POST /orders (sell)', 'POST', `/api/leagues/${league.id}/orders`,
          { marketId: pos.marketId, side: 'sell', outcome: pos.outcome, type: 'market', size: pos.size }, token, { quiet: true })
      }
    } else {
      const open = await call('GET /orders', 'GET', `/api/leagues/${league.id}/orders?status=open`, null, token)
      if (open?.[0]) {
        tradeStats.cancels++
        await call('DELETE /orders/:id', 'DELETE', `/api/orders/${open[0].id}`, null, token, { quiet: true })
      }
    }
    await Promise.all([
      call('GET /portfolio', 'GET', `/api/leagues/${league.id}/portfolio`, null, token),
      call('GET /leaderboard', 'GET', `/api/leagues/${league.id}/leaderboard?period=day`, null, token),
      call('GET /activity', 'GET', `/api/leagues/${league.id}/activity`, null, token),
    ])
    await sleep(rand(4000, 12000))
  }
  return sse()
}

/** Someone running a bot on their laptop against the REST API: tight polling loop. */
async function restBot(token) {
  while (running()) {
    const m = pick(markets)
    const book = await call('GET /markets/:id/book', 'GET', `/api/markets/${m.id}/book?league=${league.id}`, null, token)
    await call('GET /portfolio', 'GET', `/api/leagues/${league.id}/portfolio`, null, token)
    if (book && Math.random() < 0.3) {
      await call('POST /orders (market)', 'POST', `/api/leagues/${league.id}/orders`,
        { marketId: m.id, side: 'buy', outcome: pick(['yes', 'no']), type: 'market', amount: 10 }, token, { quiet: true })
    }
    await sleep(500)
  }
}

/** Event-loop lag: how long a trivial request takes while everything else is going on (/api: Cloud Run reserves /healthz). */
const lag = []
async function probe() {
  while (running()) {
    const t0 = performance.now()
    try { await fetch(`${B}/api`, { signal: AbortSignal.timeout(30_000), headers: IAM }) } catch { /* counted as slow */ }
    lag.push(performance.now() - t0)
    await sleep(1000)
  }
}

const proc = []
async function sampleProc() {
  if (!PID) return
  while (running()) {
    try {
      const [cpu, rss] = execSync(`ps -o %cpu=,rss= -p ${PID}`).toString().trim().split(/\s+/).map(Number)
      proc.push({ cpu, rssMb: rss / 1024 })
    } catch { /* process gone */ }
    await sleep(2000)
  }
}

const t0 = Date.now()
const results = await Promise.all([
  ...humanTokens.map(human),
  ...restTokens.map(restBot),
  probe(),
  sampleProc(),
])
const elapsed = (Date.now() - t0) / 1000
const sseEvents = results.slice(0, HUMANS)
streams.forEach((c) => c.abort())

/* ---------------- script schedule ---------------- */

const scriptRows = []
for (const s of scripts) {
  const list = await call('GET /scripts', 'GET', `/api/leagues/${league.id}/scripts`, null, s.token)
  const cur = list?.find((x) => x.id === s.id)
  const logs = await call('GET /scripts/:id/logs', 'GET', `/api/scripts/${s.id}/logs`, null, s.token)
  scriptRows.push({ kind: s.kind, runs: cur?.runs ?? 0, enabled: cur?.enabled, errors: (logs ?? []).filter((l) => l.level === 'error').length, lastError: cur?.lastError })
  await call('PATCH /scripts/:id', 'PATCH', `/api/scripts/${s.id}`, { enabled: false }, s.token)
}

/* ---------------- report ---------------- */

const rows = [...stats.entries()].map(([route, s]) => ({
  route, n: s.ms.length, rps: +(s.ms.length / elapsed).toFixed(2),
  p50: Math.round(q(s.ms, 0.5)), p95: Math.round(q(s.ms, 0.95)), p99: Math.round(q(s.ms, 0.99)), max: Math.round(Math.max(...s.ms)),
  errors: Object.fromEntries(s.errors),
})).sort((a, b) => b.n - a.n)
const total = rows.reduce((a, r) => a + r.n, 0)
const expectedRuns = Math.floor(elapsed / 10)
const byKind = {}
for (const r of scriptRows) {
  const k = (byKind[r.kind] ??= { scripts: 0, runs: 0, errors: 0, disabled: 0 })
  k.scripts++; k.runs += r.runs; k.errors += r.errors; k.disabled += r.enabled === false ? 0 : 0
}
const summary = {
  config: { api: B, mode: MODE, humans: HUMANS, botUsers: BOT_USERS, restBots: REST_BOTS, scripts: scripts.length, seconds: Math.round(elapsed) },
  totals: { requests: total, rps: +(total / elapsed).toFixed(1), trades: tradeStats, sseEventsPerHuman: Math.round(sseEvents.reduce((a, b) => a + b, 0) / Math.max(1, HUMANS)) },
  healthz: { p50: Math.round(q(lag, 0.5)), p95: Math.round(q(lag, 0.95)), p99: Math.round(q(lag, 0.99)), max: Math.round(Math.max(...lag, 0)) },
  server: proc.length ? { cpuAvg: Math.round(proc.reduce((a, p) => a + p.cpu, 0) / proc.length), cpuMax: Math.round(Math.max(...proc.map((p) => p.cpu))), rssMaxMb: Math.round(Math.max(...proc.map((p) => p.rssMb))) } : null,
  scripts: { expectedRunsEach: expectedRuns, byKind, rows: scriptRows },
  routes: rows,
  errorSamples: [...new Set(errorSamples)].slice(0, 25),
}

console.log('\n=== routes (ms) ===')
console.table(rows.map((r) => ({ ...r, errors: Object.entries(r.errors).map(([k, v]) => `${k}×${v}`).join(' ') })))
console.log('=== healthz lag (ms) ===', summary.healthz)
console.log('=== server ===', summary.server)
console.log('=== scripts === expected ~', expectedRuns, 'runs each')
console.table(scriptRows)
console.log('=== totals ===', summary.totals)
if (summary.errorSamples.length) console.log('=== error samples ===\n' + summary.errorSamples.join('\n'))
if (OUT) writeFileSync(OUT, JSON.stringify(summary, null, 2))
process.exit(0)
