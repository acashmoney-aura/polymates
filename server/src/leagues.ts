import { HOUSE_USER, logActivity, rebuildBooks } from './engine.ts'
import { eventById, marketById } from './polymarket.ts'
import { db, markDirty, memberKey } from './state.ts'
import type { League, Member, User } from './types.ts'
import { emit, fail, id, inviteCode, now } from './util.ts'

/**
 * League lifecycle and administration, shared by the REST API and MCP so a
 * person on the website and their agent have exactly the same powers.
 *
 * Roles: the owner can do everything; admins can change settings, switch
 * markets on/off and remove members; members trade.
 */

export type Role = Member['role']
const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 }
const MAX_MEMBERS = 100
const MAX_OWNED = 20

export function publicUser(u: User) {
  return { id: u.id, username: u.username, displayName: u.displayName, avatarHue: u.avatarHue, avatarUrl: u.avatarUrl, createdAt: u.createdAt }
}

const humans = (leagueId: string) => [...db.members.values()].filter((m) => m.leagueId === leagueId && m.userId !== HOUSE_USER)

export interface CreateLeagueInput {
  name?: string
  mode?: string
  startingBalance?: number
  marketScope?: string
  houseLiquidity?: boolean
  description?: string
  enabledEvents?: string[]
}

export interface UpdateLeagueInput {
  name?: string
  description?: string
  marketScope?: string
  houseLiquidity?: boolean
  startingBalance?: number
  regenerateInvite?: boolean
}

export function leagueAdmin(userId: string) {
  const user = () => db.users.get(userId) ?? fail(401, 'Unknown user')

  /** Load a league the caller belongs to, optionally requiring a minimum role. */
  function load(leagueId: string, need: Role = 'member') {
    const league = db.leagues.get(leagueId) ?? fail(404, 'League not found')
    const me = db.members.get(memberKey(league.id, userId)) ?? fail(403, 'You are not a member of this league')
    if (RANK[me.role] < RANK[need]) fail(403, need === 'owner' ? 'Only the league owner can do that' : 'Only league admins can do that')
    return { league, me }
  }

  function changed(league: League) {
    markDirty()
    emit({ type: 'league', leagueId: league.id })
  }

  function view(league: League) {
    const me = db.members.get(memberKey(league.id, userId))
    const members = humans(league.id)
      .map((m) => ({ ...publicUser(db.users.get(m.userId)!), role: m.role, joinedAt: m.joinedAt }))
      .sort((a, b) => RANK[b.role] - RANK[a.role] || a.joinedAt - b.joinedAt)
    return { ...league, season: league.season ?? 1, myRole: me?.role ?? null, members }
  }

  const findMember = (leagueId: string, target: string) => {
    const t = target.trim().replace(/^@/, '').toLowerCase()
    const m = humans(leagueId).find((x) => x.userId === target || db.users.get(x.userId)?.username === t)
    return m ?? fail(404, `No member "${target}" in this league`)
  }

  /** Cancel every open order for one member (or everyone) in a league, then rebuild the books once. */
  function cancelOrdersIn(leagueId: string, onlyUser?: string) {
    let n = 0
    for (const o of db.orders.values()) {
      if (o.leagueId === leagueId && o.status === 'open' && (!onlyUser || o.userId === onlyUser)) {
        o.status = 'cancelled'
        o.updatedAt = now()
        n++
      }
    }
    if (n) rebuildBooks()
    return n
  }

  return {
    get(leagueId: string) {
      return view(load(leagueId).league)
    },

    create(input: CreateLeagueInput) {
      const u = user()
      const owned = [...db.leagues.values()].filter((l) => l.ownerId === u.id).length
      if (owned >= MAX_OWNED) fail(400, `You can own at most ${MAX_OWNED} leagues`)
      const mode = input.mode === 'exchange' ? 'exchange' : 'mirror'
      const startingBalance = Math.min(Math.max(Number(input.startingBalance) || 10_000, 100), 10_000_000)
      const league: League = {
        id: id('lg'),
        name: String(input.name || `${u.displayName}'s league`).trim().slice(0, 60),
        description: input.description ? String(input.description).slice(0, 280) : undefined,
        inviteCode: inviteCode(),
        mode,
        startingBalance,
        ownerId: u.id,
        createdAt: now(),
        marketScope: input.marketScope === 'curated' ? 'curated' : 'all',
        enabledEvents: Array.isArray(input.enabledEvents) ? input.enabledEvents.map(String).slice(0, 500) : [],
        disabledMarkets: [],
        houseLiquidity: mode === 'exchange' && input.houseLiquidity !== false,
        season: 1,
      }
      db.leagues.set(league.id, league)
      db.members.set(memberKey(league.id, u.id), { leagueId: league.id, userId: u.id, role: 'owner', cash: startingBalance, joinedAt: now() })
      logActivity(league.id, u.id, 'create', `${u.displayName} created the league`)
      markDirty()
      return view(league)
    },

    preview(code: string) {
      const league = [...db.leagues.values()].find((l) => l.inviteCode === code.trim().toUpperCase()) ?? fail(404, 'Invite not found')
      return {
        id: league.id, name: league.name, description: league.description, mode: league.mode,
        startingBalance: league.startingBalance, owner: db.users.get(league.ownerId)?.displayName, members: humans(league.id).length,
      }
    },

    join(code: string) {
      const u = user()
      const league = [...db.leagues.values()].find((l) => l.inviteCode === code.trim().toUpperCase()) ?? fail(404, 'No league with that invite code')
      const k = memberKey(league.id, u.id)
      if (!db.members.has(k)) {
        if (humans(league.id).length >= MAX_MEMBERS) fail(400, 'League is full')
        db.members.set(k, { leagueId: league.id, userId: u.id, role: 'member', cash: league.startingBalance, joinedAt: now() })
        logActivity(league.id, u.id, 'join', `${u.displayName} joined the league`)
        changed(league)
      }
      return view(league)
    },

    update(leagueId: string, b: UpdateLeagueInput) {
      const { league } = load(leagueId, 'admin')
      if (b.name !== undefined) league.name = String(b.name).trim().slice(0, 60) || league.name
      if (b.description !== undefined) league.description = String(b.description).slice(0, 280) || undefined
      if (b.marketScope === 'all' || b.marketScope === 'curated') league.marketScope = b.marketScope
      if (b.houseLiquidity !== undefined) league.houseLiquidity = Boolean(b.houseLiquidity) && league.mode === 'exchange'
      // only applies to people who join (or a season restart) from now on
      if (b.startingBalance !== undefined) league.startingBalance = Math.min(Math.max(Number(b.startingBalance) || league.startingBalance, 100), 10_000_000)
      if (b.regenerateInvite) league.inviteCode = inviteCode()
      changed(league)
      return view(league)
    },

    /** Turn a whole event (all its outcome markets) on or off. */
    async setEventEnabled(leagueId: string, eventId: string, enabled: boolean) {
      const { league } = load(leagueId, 'admin')
      const event = (await eventById(eventId)) ?? fail(404, 'Event not found')
      const set = new Set(league.enabledEvents)
      const disabled = new Set(league.disabledMarkets)
      if (enabled) {
        set.add(event.id)
        for (const mid of event.marketIds) disabled.delete(mid)
      } else {
        set.delete(event.id)
        if (league.marketScope === 'all') for (const mid of event.marketIds) disabled.add(mid)
      }
      league.enabledEvents = [...set]
      league.disabledMarkets = [...disabled]
      changed(league)
      return view(league)
    },

    /** Turn a single outcome market on or off. */
    async setMarketEnabled(leagueId: string, marketId: string, enabled: boolean) {
      const { league } = load(leagueId, 'admin')
      const market = (await marketById(marketId)) ?? fail(404, 'Market not found')
      const disabled = new Set(league.disabledMarkets)
      if (enabled) {
        disabled.delete(market.id)
        if (league.marketScope === 'curated' && !league.enabledEvents.includes(market.eventId)) league.enabledEvents.push(market.eventId)
      } else {
        disabled.add(market.id)
      }
      league.disabledMarkets = [...disabled]
      changed(league)
      return view(league)
    },

    setRole(leagueId: string, target: string, role: 'admin' | 'member') {
      const { league } = load(leagueId, 'owner')
      const m = findMember(league.id, target)
      if (m.role === 'owner') fail(400, 'Use transfer ownership to change the owner')
      if (role !== 'admin' && role !== 'member') fail(400, 'Role must be "admin" or "member"')
      m.role = role
      const name = db.users.get(m.userId)?.displayName
      logActivity(league.id, userId, 'admin', `${user().displayName} made ${name} ${role === 'admin' ? 'an admin' : 'a member'}`)
      changed(league)
      return view(league)
    },

    removeMember(leagueId: string, target: string) {
      const { league, me } = load(leagueId, 'admin')
      const m = findMember(league.id, target)
      if (m.userId === userId) fail(400, 'Use leave to leave a league')
      if (RANK[m.role] >= RANK[me.role]) fail(403, 'You can only remove people with a lower role than yours')
      cancelOrdersIn(league.id, m.userId)
      db.members.delete(memberKey(league.id, m.userId))
      for (const [k, p] of db.positions) if (p.leagueId === league.id && p.userId === m.userId) db.positions.delete(k)
      for (const s of db.scripts.values()) if (s.leagueId === league.id && s.userId === m.userId) s.enabled = false
      const name = db.users.get(m.userId)?.displayName
      logActivity(league.id, userId, 'admin', `${user().displayName} removed ${name}`)
      changed(league)
      return view(league)
    },

    transferOwnership(leagueId: string, target: string) {
      const { league, me } = load(leagueId, 'owner')
      const m = findMember(league.id, target)
      if (m.userId === userId) fail(400, 'You already own this league')
      m.role = 'owner'
      me.role = 'admin'
      league.ownerId = m.userId
      const name = db.users.get(m.userId)?.displayName
      logActivity(league.id, userId, 'admin', `${user().displayName} handed ownership to ${name}`)
      changed(league)
      return view(league)
    },

    leave(leagueId: string) {
      const { league, me } = load(leagueId)
      if (me.role === 'owner') {
        if (humans(league.id).length > 1) fail(400, 'Transfer ownership to someone else before leaving, or delete the league')
        return { left: true, deleted: deleteLeague(league) }
      }
      cancelOrdersIn(league.id, userId)
      db.members.delete(memberKey(league.id, userId))
      for (const [k, p] of db.positions) if (p.leagueId === league.id && p.userId === userId) db.positions.delete(k)
      for (const s of db.scripts.values()) if (s.leagueId === league.id && s.userId === userId) s.enabled = false
      logActivity(league.id, userId, 'admin', `${user().displayName} left the league`)
      changed(league)
      return { left: true, deleted: false }
    },

    /** Start a new season: cancel every order, clear positions and trades, and reset everyone's cash. */
    resetSeason(leagueId: string, confirmName: string) {
      const { league } = load(leagueId, 'owner')
      if (confirmName.trim() !== league.name) fail(400, `Type the league name exactly ("${league.name}") to confirm`)
      cancelOrdersIn(league.id)
      for (const [k, p] of db.positions) if (p.leagueId === league.id) db.positions.delete(k)
      for (const [k, s] of db.settlements) if (s.leagueId === league.id) db.settlements.delete(k)
      db.trades = db.trades.filter((t) => t.leagueId !== league.id)
      for (const m of db.members.values()) if (m.leagueId === league.id && m.userId !== HOUSE_USER) m.cash = league.startingBalance
      league.season = (league.season ?? 1) + 1
      league.seasonStartedAt = now()
      for (const k of db.equity.keys()) if (k.startsWith(`${league.id}:`)) db.equity.delete(k)
      rebuildBooks()
      logActivity(league.id, userId, 'admin', `${user().displayName} started season ${league.season}. Everyone is back to the starting balance.`)
      changed(league)
      return view(league)
    },

    delete(leagueId: string, confirmName: string) {
      const { league } = load(leagueId, 'owner')
      if (confirmName.trim() !== league.name) fail(400, `Type the league name exactly ("${league.name}") to confirm`)
      return { deleted: deleteLeague(league) }
    },
  }
}

function deleteLeague(league: League) {
  const lid = league.id
  for (const [k, m] of db.members) if (m.leagueId === lid) db.members.delete(k)
  for (const [k, p] of db.positions) if (p.leagueId === lid) db.positions.delete(k)
  for (const [k, o] of db.orders) if (o.leagueId === lid) db.orders.delete(k)
  for (const [k, s] of db.settlements) if (s.leagueId === lid) db.settlements.delete(k)
  for (const [k, s] of db.scripts) if (s.leagueId === lid) db.scripts.delete(k)
  db.trades = db.trades.filter((t) => t.leagueId !== lid)
  db.activity = db.activity.filter((a) => a.leagueId !== lid)
  for (const k of db.equity.keys()) if (k.startsWith(`${lid}:`)) db.equity.delete(k)
  db.leagues.delete(lid)
  rebuildBooks()
  markDirty()
  emit({ type: 'league', leagueId: lid })
  return true
}
