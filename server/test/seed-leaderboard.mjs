// Seeds a league with 30 days of backdated trading for working on the leaderboard UI.
// Needs a server started with DEV_TOOLS=1, e.g.
//   DEV_TOOLS=1 PORT=8796 STATE_FILE=/tmp/lb/state.json node src/index.ts
//   API=http://localhost:8796 node test/seed-leaderboard.mjs
// Prints a session token for the "you" account; put it in localStorage.pm_token.
const BASE = process.env.API ?? 'http://localhost:8787'
const DAY = 86_400_000
const HOUR = 3_600_000
async function call(p, { method = 'GET', body, token } = {}) {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${JSON.stringify(j)}`)
  return j
}
let seed = 7
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const pick = (xs) => xs[Math.floor(rand() * xs.length)]
const at = (offsetMs) => call('/api/dev/clock', { method: 'POST', body: { offsetMs: Math.round(offsetMs) } })

await at(-31 * DAY)
const sfx = Math.random().toString(36).slice(2, 6)
const names = [
  ['you', 'You'], ['maya', 'Maya Chen'], ['dev', 'Dev Patel'], ['sofia', 'Sofia R'], ['jordan', 'Jordan'],
  ['kai', 'Kai Nakamura'], ['ola', 'Ola Adeyemi'], ['liam', 'Liam O'], ['priya', 'Priya'], ['theo', 'Theo B'],
]
const users = []
for (const [u, d] of names) users.push(await call('/api/auth/signup', { method: 'POST', body: { username: `${u}_${sfx}`, password: 'secret123', displayName: d } }))
const L = await call('/api/leagues', { method: 'POST', token: users[0].token, body: { name: 'Group Chat Degens', mode: 'exchange', houseLiquidity: false } })
for (const u of users.slice(1)) await call('/api/leagues/join', { method: 'POST', token: u.token, body: { inviteCode: L.inviteCode } })

let events = []
for (let i = 0; i < 60 && events.length < 8; i++) {
  events = (await call(`/api/events?league=${L.id}&limit=40`, { token: users[0].token })).events.filter((e) => e.markets.some((m) => m.active && !m.resolved))
  if (events.length < 8) await new Promise((r) => setTimeout(r, 1000))
}
// spread across categories where we can
const byTag = new Map()
for (const e of events) { const t = e.tags?.[0]?.slug ?? 'x'; if (!byTag.has(t)) byTag.set(t, e) }
const chosen = [...new Set([...byTag.values(), ...events])].slice(0, 8)
const markets = chosen.map((e) => {
  const m = e.markets.find((x) => x.active && !x.resolved)
  return { id: m.id, title: m.title, p: Math.min(0.85, Math.max(0.15, Math.round(m.price * 100) / 100 || 0.5)), drift: (rand() - 0.5) * 0.02 }
})
const hold = new Map() // `${user}:${market}:${outcome}` -> shares
const held = (u, m, o) => hold.get(`${u}:${m}:${o}`) ?? 0
const add = (u, m, o, q) => hold.set(`${u}:${m}:${o}`, held(u, m, o) + q)
const skill = users.map(() => rand() * 0.6 - 0.15) // some members are better at this than others
const order = (u, marketId, side, outcome, price, size) =>
  call(`/api/leagues/${L.id}/orders`, { method: 'POST', token: users[u].token, body: { marketId, side, outcome, type: 'limit', price, size } })
const clamp = (p) => Math.min(0.96, Math.max(0.04, Math.round(p * 100) / 100))

async function step(m) {
  const before = m.p
  m.p = clamp(m.p + m.drift + (rand() - 0.5) * 0.08)
  const up = m.p > before
  // skilled members tend to be on the right side of the next move
  const ranked = users.map((_, i) => i).sort((a, b) => skill[b] - skill[a] + (rand() - 0.5) * 0.9)
  const smart = ranked[0], other = ranked[ranked.length - 1 - Math.floor(rand() * 3)]
  if (smart === other) return
  const size = Math.round(20 + rand() * 280)
  const p = m.p
  const holder = users.map((_, i) => i).find((i) => i !== smart && held(i, m.id, up ? 'yes' : 'no') >= 10)
  try {
    if (holder !== undefined && rand() < 0.45) {
      // the holder sells to the smart money
      const o = up ? 'yes' : 'no'
      const q = Math.min(size, Math.floor(held(holder, m.id, o)))
      const price = o === 'yes' ? p : clamp(1 - p)
      await order(holder, m.id, 'sell', o, price, q)
      await order(smart, m.id, 'buy', o, price, q)
      add(holder, m.id, o, -q); add(smart, m.id, o, q)
    } else {
      // mint: smart buys the side that is about to win, the other buys the opposite
      const o = up ? 'yes' : 'no'
      const po = o === 'yes' ? p : clamp(1 - p)
      await order(other, m.id, 'buy', o === 'yes' ? 'no' : 'yes', clamp(1 - po), size)
      await order(smart, m.id, 'buy', o, po, size)
      add(smart, m.id, o, size); add(other, m.id, o === 'yes' ? 'no' : 'yes', size)
    }
  } catch (err) {
    console.warn('skip', err.message.slice(0, 120))
  }
  for (const i of [smart, other, holder]) if (i !== undefined) await call(`/api/leagues/${L.id}/orders`, { method: 'DELETE', token: users[i].token }).catch(() => {})
}

const settleAt = new Map([[markets[0].id, -12 * DAY], [markets[1].id, -5 * DAY], [markets[2].id, -18 * HOUR]])
let n = 0
for (let t = -30 * DAY; t < -0.25 * HOUR; t += (t > -2 * DAY ? 1.5 : 7) * HOUR) {
  await at(t)
  for (const m of markets) {
    const s = settleAt.get(m.id)
    if (m.done) continue
    if (s !== undefined && t >= s) {
      await call('/api/dev/settle', { method: 'POST', body: { marketId: m.id, outcome: m.p >= 0.5 ? 'yes' : 'no' } })
      m.done = true
      console.log(`settled ${m.title} ${m.p >= 0.5 ? 'YES' : 'NO'}`)
      continue
    }
    if (rand() < 0.55) { await step(m); n++ }
  }
  await call('/api/dev/snapshot', { method: 'POST' })
}
await at(0)
await call('/api/dev/snapshot', { method: 'POST' })
console.log(`${n} trading steps in league ${L.id} (${L.name})`)
console.log(`TOKEN=${users[0].token}`)
