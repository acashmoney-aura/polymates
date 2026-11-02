import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import { OAuth2Client } from 'google-auth-library'
import { agentApi } from './agent-api.ts'
import { eventCurveFor, microstructure, portfolioRisk, volatilityRanking, volCone } from './analytics.ts'
import { runBacktest, runSweep, scanner, STRATEGY_TEMPLATES, sweepableParams } from './backtest.ts'
import { HOUSE_USER, rebuildBooks, settleMarket, sweepMirrorOrders } from './engine.ts'
import { startHouse } from './house.ts'
import { leagueAdmin, publicUser } from './leagues.ts'
import { handleMcp } from './mcp.ts'
import { catalog, marketById, pmHistory, refreshMarkets, syncCatalog } from './polymarket.ts'
import { createScript, deleteScript, listScripts, scriptLogsFor, updateScript } from './script-api.ts'
import { EXAMPLE_SCRIPT, runScript, startScheduler } from './scripts.ts'
import { db, flush, initState, markDirty, memberKey } from './state.ts'
import type { OrderSource, User } from './types.ts'
import {
  bus, type BusEvent, fail, hashPassword, HttpError, id, now, randomToken, sha256, verifyPassword,
} from './util.ts'

const app = express()
app.set('trust proxy', true)
app.use(cors({ origin: true, credentials: false, exposedHeaders: ['Mcp-Session-Id'] }))
app.use(express.json({ limit: '256kb' }))

type Handler = (req: Request, res: Response) => unknown
const wrap = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res)
    if (out !== undefined && !res.headersSent) res.json(out)
  } catch (err) {
    next(err)
  }
}

/* ---------------- auth ---------------- */

interface Authed { user: User; source: OrderSource }

function authenticate(req: Request): Authed | null {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.query.token ?? '')
  if (!token) return null
  if (token.startsWith('pm_')) {
    const hash = sha256(token)
    for (const k of db.apiKeys.values()) {
      if (k.hash === hash) {
        k.lastUsedAt = now()
        const user = db.users.get(k.userId)
        return user ? { user, source: 'api' } : null
      }
    }
    return null
  }
  const session = db.sessions.get(token)
  const user = session && db.users.get(session.userId)
  return user ? { user, source: 'web' } : null
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? ''
const googleClient = new OAuth2Client()

async function verifyGoogleToken(credential: string) {
  if (!GOOGLE_CLIENT_ID) fail(503, 'Google sign-in is not configured on this server')
  if (!credential) fail(400, 'Missing Google credential')
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID })
    const p = ticket.getPayload()
    if (!p?.sub) throw new Error('no subject')
    return { sub: p.sub, email: p.email_verified ? p.email : undefined, name: p.name, picture: p.picture }
  } catch {
    return fail(401, 'Google sign-in failed. Try again.')
  }
}

function uniqueUsername(seed: string) {
  const base = seed.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16).padEnd(3, '0')
  const taken = new Set([...db.users.values()].map((u) => u.username))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`
}

const requireAuth = (req: Request) => authenticate(req) ?? fail(401, 'Sign in or pass an API key as "Authorization: Bearer pm_..."')


function newSession(userId: string) {
  const token = randomToken(32)
  db.sessions.set(token, { token, userId, createdAt: now() })
  markDirty()
  return token
}

app.post('/api/auth/signup', wrap((req) => {
  const username = String(req.body?.username ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  if (!/^[a-z0-9_]{3,20}$/.test(username)) fail(400, 'Username must be 3-20 characters: letters, numbers, _')
  if (password.length < 6) fail(400, 'Password must be at least 6 characters')
  if ([...db.users.values()].some((u) => u.username === username)) fail(409, 'Username is taken')
  const { hash, salt } = hashPassword(password)
  const user: User = {
    id: id('usr'), username, displayName: String(req.body?.displayName || username).slice(0, 40),
    passHash: hash, salt, avatarHue: Math.floor(Math.random() * 360), createdAt: now(),
  }
  db.users.set(user.id, user)
  markDirty()
  return { token: newSession(user.id), user: publicUser(user) }
}))

app.post('/api/auth/login', wrap((req) => {
  const username = String(req.body?.username ?? '').trim().toLowerCase()
  const user = [...db.users.values()].find((u) => u.username === username && u.id !== HOUSE_USER)
  if (user && !user.passHash) fail(401, 'This account signs in with Google')
  if (!user || !verifyPassword(String(req.body?.password ?? ''), user.salt, user.passHash)) fail(401, 'Wrong username or password')
  return { token: newSession(user!.id), user: publicUser(user!) }
}))

/** Public client config (the Google client id is not a secret). */
app.get('/api/config', wrap(() => ({ googleClientId: GOOGLE_CLIENT_ID || null })))

/**
 * Sign in with Google. The browser gets an ID token from Google Identity Services
 * and posts it here; we verify it and sign in (or create) the matching account.
 * If the request already carries a session, the Google account is linked to it.
 */
app.post('/api/auth/google', wrap(async (req) => {
  const profile = await verifyGoogleToken(String(req.body?.credential ?? ''))
  const current = authenticate(req)
  const linked = [...db.users.values()].find((u) => u.googleSub === profile.sub)
  if (current?.source === 'web') {
    if (linked && linked.id !== current.user.id) fail(409, 'That Google account is already linked to another Polymates user')
    Object.assign(current.user, { googleSub: profile.sub, email: profile.email, avatarUrl: current.user.avatarUrl ?? profile.picture })
    markDirty()
    return { token: (req.headers.authorization ?? '').slice(7), user: publicUser(current.user), linked: true }
  }
  let user = linked
  if (!user) {
    user = {
      id: id('usr'), username: uniqueUsername(profile.email ?? profile.name ?? 'player'),
      displayName: (profile.name || profile.email?.split('@')[0] || 'Player').slice(0, 40),
      passHash: '', salt: '', avatarHue: Math.floor(Math.random() * 360), createdAt: now(),
      googleSub: profile.sub, email: profile.email, avatarUrl: profile.picture,
    }
    db.users.set(user.id, user)
  } else if (profile.picture && !user.avatarUrl) {
    user.avatarUrl = profile.picture
  }
  markDirty()
  return { token: newSession(user.id), user: publicUser(user), created: !linked }
}))

app.post('/api/auth/logout', wrap((req) => {
  const token = (req.headers.authorization ?? '').slice(7)
  db.sessions.delete(token)
  markDirty()
  return { ok: true }
}))

app.get('/api/me', wrap((req) => {
  const { user } = requireAuth(req)
  return { user: { ...publicUser(user), google: Boolean(user.googleSub), hasPassword: Boolean(user.passHash) }, leagues: agentApi(user.id, 'web').listLeagues() }
}))

app.get('/api/me/api-keys', wrap((req) => {
  const { user } = requireAuth(req)
  return [...db.apiKeys.values()].filter((k) => k.userId === user.id).map((k) => ({ ...k, hash: undefined }))
}))

app.post('/api/me/api-keys', wrap((req) => {
  const { user, source } = requireAuth(req)
  if (source !== 'web') fail(403, 'API keys can only be created from the website')
  if ([...db.apiKeys.values()].filter((k) => k.userId === user.id).length >= 10) fail(400, 'Limit of 10 API keys')
  const key = `pm_${randomToken(24)}`
  const rec = { id: id('key'), userId: user.id, name: String(req.body?.name || 'My agent').slice(0, 40), prefix: key.slice(0, 10), hash: sha256(key), createdAt: now(), lastUsedAt: null }
  db.apiKeys.set(rec.id, rec)
  markDirty()
  return { ...rec, hash: undefined, key }
}))

app.delete('/api/me/api-keys/:id', wrap((req) => {
  const { user } = requireAuth(req)
  const k = db.apiKeys.get(String(req.params.id))
  if (!k || k.userId !== user.id) fail(404, 'Key not found')
  db.apiKeys.delete(k!.id)
  markDirty()
  return { ok: true }
}))

/* ---------------- leagues ---------------- */

const admin = (req: Request) => leagueAdmin(requireAuth(req).user.id)
const lid = (req: Request) => String(req.params.id)

app.post('/api/leagues', wrap((req) => admin(req).create(req.body ?? {})))
app.post('/api/leagues/join', wrap((req) => admin(req).join(String(req.body?.inviteCode ?? ''))))
app.get('/api/leagues/invite/:code', wrap((req) => leagueAdmin('').preview(String(req.params.code))))
app.get('/api/leagues/:id', wrap((req) => admin(req).get(lid(req))))
app.patch('/api/leagues/:id', wrap((req) => admin(req).update(lid(req), req.body ?? {})))
app.delete('/api/leagues/:id', wrap((req) => admin(req).delete(lid(req), String(req.body?.confirm ?? req.query.confirm ?? ''))))
app.post('/api/leagues/:id/leave', wrap((req) => admin(req).leave(lid(req))))
app.post('/api/leagues/:id/reset', wrap((req) => admin(req).resetSeason(lid(req), String(req.body?.confirm ?? ''))))
app.post('/api/leagues/:id/transfer', wrap((req) => admin(req).transferOwnership(lid(req), String(req.body?.userId ?? ''))))
app.patch('/api/leagues/:id/members/:userId', wrap((req) => admin(req).setRole(lid(req), String(req.params.userId), req.body?.role)))
app.delete('/api/leagues/:id/members/:userId', wrap((req) => admin(req).removeMember(lid(req), String(req.params.userId))))
app.post('/api/leagues/:id/events/:eventId', wrap((req) => admin(req).setEventEnabled(lid(req), String(req.params.eventId), Boolean(req.body?.enabled))))
app.post('/api/leagues/:id/markets/:marketId', wrap((req) => admin(req).setMarketEnabled(lid(req), String(req.params.marketId), Boolean(req.body?.enabled))))

app.get('/api/leagues/:id/leaderboard', wrap((req) => agentApi(requireAuth(req).user.id, 'web').getLeaderboard(String(req.params.id))))
app.get('/api/leagues/:id/portfolio', wrap((req) => agentApi(requireAuth(req).user.id, 'web').getPortfolio(String(req.params.id))))
app.get('/api/leagues/:id/orders', wrap((req) =>
  agentApi(requireAuth(req).user.id, 'web').listOrders(String(req.params.id), req.query.status === 'all' ? 'all' : 'open')))
app.get('/api/leagues/:id/trades', wrap((req) =>
  agentApi(requireAuth(req).user.id, 'web').listTrades(String(req.params.id), {
    marketId: req.query.market ? String(req.query.market) : undefined,
    mine: req.query.mine === '1' || req.query.mine === 'true',
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  })))
app.get('/api/leagues/:id/activity', wrap((req) => {
  const league = admin(req).get(lid(req))
  return db.activity.filter((a) => a.leagueId === league.id).slice(-100).reverse().map((a) => {
    const u = db.users.get(a.userId)
    const m = a.marketId ? catalog.markets.get(a.marketId) : undefined
    return { ...a, user: u ? publicUser(u) : null, eventSlug: m ? catalog.events.get(m.eventId)?.slug : null, image: m?.image ?? null }
  })
}))

app.post('/api/leagues/:id/orders', wrap((req) => {
  const { user, source } = requireAuth(req)
  return agentApi(user.id, source).placeOrder({ ...req.body, leagueId: String(req.params.id) })
}))
app.delete('/api/leagues/:id/orders', wrap((req) => {
  const { user, source } = requireAuth(req)
  return agentApi(user.id, source).cancelAll(String(req.params.id), req.query.market ? String(req.query.market) : undefined)
}))
app.delete('/api/orders/:orderId', wrap((req) => {
  const { user, source } = requireAuth(req)
  return agentApi(user.id, source).cancelOrder(String(req.params.orderId))
}))

/* ---------------- scripts ---------------- */

app.get('/api/scripts/example', wrap(() => ({ code: EXAMPLE_SCRIPT })))
app.get('/api/leagues/:id/scripts', wrap((req) => listScripts(requireAuth(req).user.id, String(req.params.id))))
app.post('/api/leagues/:id/scripts', wrap((req) =>
  createScript(requireAuth(req).user.id, { ...req.body, leagueId: String(req.params.id) })))
app.patch('/api/scripts/:sid', wrap((req) => updateScript(requireAuth(req).user.id, String(req.params.sid), req.body ?? {})))
app.delete('/api/scripts/:sid', wrap((req) => deleteScript(requireAuth(req).user.id, String(req.params.sid))))
app.get('/api/scripts/:sid/logs', wrap((req) => scriptLogsFor(requireAuth(req).user.id, String(req.params.sid))))
app.post('/api/scripts/:sid/run', wrap(async (req) => {
  const { user } = requireAuth(req)
  const s = db.scripts.get(String(req.params.sid))
  if (!s || s.userId !== user.id) fail(404, 'Script not found')
  const result = await runScript(s!)
  return { result, script: { ...s, logs: undefined }, logs: scriptLogsFor(user.id, s!.id).slice(-50) }
}))

/* ---------------- quant ---------------- */

app.get('/api/backtest/templates', wrap(() => STRATEGY_TEMPLATES))
app.post('/api/backtest', wrap((req) => {
  requireAuth(req)
  return runBacktest(req.body ?? {})
}))
app.get('/api/quant/scanner', wrap(() => scanner()))
app.post('/api/backtest/sweep', wrap((req) => {
  requireAuth(req)
  return runSweep(req.body ?? {})
}))
app.post('/api/backtest/params', wrap((req) => sweepableParams(String(req.body?.code ?? ''))))
app.get('/api/quant/volatility', wrap((req) => volatilityRanking(Number(req.query.limit) || 30)))
app.get('/api/markets/:mid/volcone', wrap((req) => volCone(String(req.params.mid))))
app.get('/api/markets/:mid/microstructure', wrap((req) => {
  const leagueId = req.query.league ? String(req.query.league) : undefined
  return microstructure(leagueId ? requireAuth(req).user.id : (authenticate(req)?.user.id ?? ''), String(req.params.mid), leagueId)
}))
app.get('/api/events/:slug/curve', wrap((req) => {
  const leagueId = req.query.league ? String(req.query.league) : undefined
  return eventCurveFor(leagueId ? requireAuth(req).user.id : (authenticate(req)?.user.id ?? ''), String(req.params.slug), leagueId)
}))
app.get('/api/leagues/:id/risk', wrap((req) => portfolioRisk(String(req.params.id), requireAuth(req).user.id)))

/* ---------------- markets (public, optionally league-scoped) ---------------- */

const optionalLeague = (req: Request) => {
  const leagueId = req.query.league ? String(req.query.league) : undefined
  const auth = leagueId ? requireAuth(req) : authenticate(req)
  return { leagueId, api: agentApi(auth?.user.id ?? '', auth?.source ?? 'web') }
}

app.get('/api/categories', wrap((req) => optionalLeague(req).api.categories()))
app.get('/api/events', wrap((req) => {
  const { leagueId, api } = optionalLeague(req)
  return api.listEvents({
    leagueId,
    tag: req.query.tag ? String(req.query.tag) : undefined,
    q: req.query.q ? String(req.query.q) : undefined,
    sort: req.query.sort ? String(req.query.sort) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
    includeDisabled: req.query.all === '1',
  })
}))
app.get('/api/events/:slug', wrap((req) => {
  const { leagueId, api } = optionalLeague(req)
  return api.getEvent(String(req.params.slug), leagueId)
}))
app.get('/api/markets', wrap((req) => {
  const { leagueId, api } = optionalLeague(req)
  return api.listMarkets({ leagueId, q: req.query.q ? String(req.query.q) : undefined, tag: req.query.tag ? String(req.query.tag) : undefined, limit: Number(req.query.limit) || 20 })
}))
app.get('/api/markets/:mid', wrap((req) => {
  const { leagueId, api } = optionalLeague(req)
  return api.getMarket(String(req.params.mid), leagueId)
}))
app.get('/api/markets/:mid/book', wrap((req) => {
  const { leagueId, api } = optionalLeague(req)
  return api.getBook(String(req.params.mid), leagueId)
}))
app.get('/api/markets/:mid/history', wrap(async (req) => {
  const m = (await marketById(String(req.params.mid))) ?? fail(404, 'Market not found')
  return pmHistory(m, String(req.query.range ?? '1d'))
}))

/* ---------------- live stream ---------------- */

app.get('/api/stream', (req, res) => {
  const auth = authenticate(req)
  const leagueId = String(req.query.league ?? '')
  if (!auth || !db.members.has(memberKey(leagueId, auth.user.id))) {
    res.status(401).end()
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' })
  res.write(': connected\n\n')
  const pending = new Map<string, BusEvent>()
  let timer: NodeJS.Timeout | null = null
  const onEvent = (e: BusEvent) => {
    if (e.leagueId !== leagueId) return
    // coalesce bursts (e.g. a sweep filling many orders) into one message per key
    pending.set(`${e.type}:${e.marketId ?? ''}:${e.userId ?? ''}`, { ...e, data: e.type === 'trade' ? e.data : undefined })
    timer ??= setTimeout(() => {
      timer = null
      for (const ev of pending.values()) res.write(`data: ${JSON.stringify(ev)}\n\n`)
      pending.clear()
    }, 150)
  }
  bus.on('event', onEvent)
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
  req.on('close', () => {
    bus.off('event', onEvent)
    clearInterval(ping)
    if (timer) clearTimeout(timer)
  })
})

/* ---------------- MCP ---------------- */

const mcpAuth = (req: Request, res: Response) => {
  const auth = authenticate(req)
  if (!auth) {
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Pass your Polymates API key as Authorization: Bearer pm_...' }, id: null })
    return null
  }
  return auth
}
app.post('/mcp', async (req, res) => {
  const auth = mcpAuth(req, res)
  if (!auth) return
  try {
    await handleMcp(req, res, auth.user.id)
  } catch (err) {
    console.error('[mcp]', err)
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null })
  }
})
app.get('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').json({ error: 'Use POST (stateless Streamable HTTP)' }))
app.delete('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').end())

/* ---------------- misc ---------------- */

app.get(['/', '/api', '/healthz'], (_req, res) => {
  res.json({
    name: 'polymates-api',
    ok: true,
    catalog: { events: catalog.events.size, markets: catalog.markets.size, syncedAt: catalog.syncedAt },
    docs: 'https://github.com/acashmoney-aura/polymates/blob/main/docs/API.md',
    mcp: '/mcp',
  })
})

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  console.error(err)
  res.status(500).json({ error: (err as Error)?.message ?? 'Internal error' })
})

/* ---------------- background jobs ---------------- */

async function resolveMarkets() {
  // every market anyone in any league holds or has an order on
  const ids = new Set<string>()
  for (const p of db.positions.values()) if (p.yes > 0 || p.no > 0) ids.add(p.marketId)
  for (const o of db.orders.values()) if (o.status === 'open') ids.add(o.marketId)
  if (!ids.size) return
  await refreshMarkets([...ids])
  for (const mid of ids) {
    const m = catalog.markets.get(mid)
    if (m?.resolved) settleMarket(m)
  }
}

function every(ms: number, fn: () => Promise<unknown>) {
  let busy = false
  setInterval(async () => {
    if (busy) return
    busy = true
    try {
      await fn()
    } catch (err) {
      console.error('[job]', err)
    } finally {
      busy = false
    }
  }, ms).unref()
}

async function main() {
  await initState()
  rebuildBooks()
  const port = Number(process.env.PORT ?? 8787)
  app.listen(port, () => console.log(`[polymates] listening on :${port}`))
  await syncCatalog()
  await resolveMarkets().catch((err) => console.error('[resolve]', err))
  every(90_000, syncCatalog)
  every(60_000, resolveMarkets)
  every(8_000, sweepMirrorOrders)
  startHouse()
  startScheduler()
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    console.log(`[polymates] ${sig}, saving state`)
    markDirty()
    await flush()
    process.exit(0)
  })
}

void main()
