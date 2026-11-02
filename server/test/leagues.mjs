// League management over REST + MCP. Run against a fresh local server: node test/leagues.mjs
const BASE = process.env.API ?? 'http://localhost:8787'
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1) } else console.log('ok', m) }
async function call(path, { method = 'GET', body, token } = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => null)
  return { status: r.status, j }
}
const sfx = Math.random().toString(36).slice(2, 7)
const mk = async (n) => (await call('/api/auth/signup', { method: 'POST', body: { username: `${n}_${sfx}`, password: 'secret123' } })).j
const [own, ali, bob] = [await mk('own'), await mk('ali'), await mk('bob')]
const L = (await call('/api/leagues', { method: 'POST', token: own.token, body: { name: 'Test League', mode: 'exchange', description: 'hi' } })).j
ok(L.myRole === 'owner' && L.season === 1 && L.description === 'hi', 'create league')
for (const u of [ali, bob]) await call('/api/leagues/join', { method: 'POST', token: u.token, body: { inviteCode: L.inviteCode } })
let r = await call(`/api/leagues/${L.id}/members/${ali.user.id}`, { method: 'PATCH', token: bob.token, body: { role: 'admin' } })
ok(r.status === 403, 'member cannot promote')
r = await call(`/api/leagues/${L.id}/members/${ali.user.id}`, { method: 'PATCH', token: own.token, body: { role: 'admin' } })
ok(r.j.members.find((m) => m.id === ali.user.id).role === 'admin', 'owner promotes admin')
r = await call(`/api/leagues/${L.id}`, { method: 'PATCH', token: ali.token, body: { name: 'Renamed' } })
ok(r.j.name === 'Renamed', 'admin renames')
r = await call(`/api/leagues/${L.id}/members/${own.user.id}`, { method: 'DELETE', token: ali.token })
ok(r.status === 403, 'admin cannot remove owner')
// bob trades then gets removed
let mkts = []
for (let i = 0; i < 30 && !mkts.length; i++) { mkts = (await call(`/api/markets?league=${L.id}&limit=1`, { token: own.token })).j; if (!mkts.length) await new Promise((r) => setTimeout(r, 1000)) }
const mid = mkts[0].id
await call(`/api/leagues/${L.id}/orders`, { method: 'POST', token: bob.token, body: { marketId: mid, side: 'buy', outcome: 'yes', type: 'limit', price: 0.02, size: 10 } })
r = await call(`/api/leagues/${L.id}/members/${bob.user.id}`, { method: 'DELETE', token: ali.token })
ok(r.status === 200 && r.j.members.length === 2, 'admin removes member')
ok((await call(`/api/leagues/${L.id}/orders`, { token: bob.token })).status === 403, 'removed member locked out')
// MCP
const key = (await call('/api/me/api-keys', { method: 'POST', token: own.token, body: { name: 't' } })).j.key
let rpcId = 0
const mcp = async (name, args) => {
  const res = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) })
  const j = await res.json()
  return { err: j.result?.isError, data: JSON.parse(j.result.content[0].text) }
}
let m = await mcp('get_league', { league_id: L.id })
ok(m.data.name === 'Renamed', 'mcp get_league')
m = await mcp('create_league', { name: 'Agent League', mode: 'mirror' })
ok(m.data.myRole === 'owner', 'mcp create_league')
const L2 = m.data
m = await mcp('reset_season', { league_id: L.id, confirm: 'wrong' })
ok(m.err, 'reset needs exact name')
m = await mcp('reset_season', { league_id: L.id, confirm: 'Renamed' })
ok(m.data.season === 2, 'mcp reset_season')
m = await mcp('transfer_ownership', { league_id: L.id, member: `ali_${sfx}` })
ok(m.data.ownerId === ali.user.id && m.data.myRole === 'admin', 'mcp transfer by username')
m = await mcp('leave_league', { league_id: L.id })
ok(m.data.left && !m.data.deleted, 'mcp leave')
m = await mcp('delete_league', { league_id: L2.id, confirm: 'Agent League' })
ok(m.data.deleted, 'mcp delete_league')
ok((await call(`/api/leagues/${L2.id}`, { token: own.token })).status === 404, 'deleted league gone')
r = await call('/api/auth/google', { method: 'POST', body: { credential: 'x' } })
ok(r.status === 503 || r.status === 401, `google endpoint guarded (${r.status})`)
console.log('all league tests passed')
