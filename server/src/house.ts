import { cancelAll, HOUSE_USER, placeOrder } from './engine.ts'
import { catalog, displayPrice } from './polymarket.ts'
import { db, markDirty, memberKey } from './state.ts'
import type { League } from './types.ts'
import { now } from './util.ts'

/**
 * Optional market maker for exchange leagues. When a league turns on
 * "house liquidity", a house account quotes a two-sided market around the
 * live Polymarket price on any market someone has looked at recently, so a
 * small group always has someone to trade against. The house is excluded
 * from leaderboards and has effectively unlimited cash.
 */

const HALF_SPREAD = 0.02
const QUOTE_SIZE = 250
const ACTIVE_MS = 30 * 60_000
const touched = new Map<string, number>()

export function ensureHouseUser() {
  if (!db.users.has(HOUSE_USER)) {
    db.users.set(HOUSE_USER, {
      id: HOUSE_USER, username: 'house', displayName: 'House MM', passHash: '', salt: '', avatarHue: 0, createdAt: now(),
    })
  }
}

function ensureHouseMember(league: League) {
  const k = memberKey(league.id, HOUSE_USER)
  if (!db.members.has(k)) db.members.set(k, { leagueId: league.id, userId: HOUSE_USER, role: 'member', cash: 1e9, joinedAt: now() })
  const m = db.members.get(k)!
  if (m.cash < 1e8) m.cash = 1e9
}

export function touchMarket(league: League, marketId: string) {
  if (league.mode !== 'exchange' || !league.houseLiquidity) return
  const k = `${league.id}:${marketId}`
  const first = !touched.has(k)
  touched.set(k, now())
  if (first) void quote(league, marketId)
}

async function quote(league: League, marketId: string) {
  const m = catalog.markets.get(marketId)
  if (!m || !m.active || m.resolved) return
  ensureHouseMember(league)
  cancelAll(league.id, HOUSE_USER, marketId)
  const mid = displayPrice(m)
  const tick = Math.max(m.tick, 0.001)
  const bid = Math.floor((mid - HALF_SPREAD) / tick) * tick
  const ask = Math.ceil((mid + HALF_SPREAD) / tick) * tick
  try {
    if (bid >= tick) {
      await placeOrder({ leagueId: league.id, userId: HOUSE_USER, marketId, side: 'buy', outcome: 'yes', type: 'limit', price: bid, size: QUOTE_SIZE, source: 'script' })
    }
    if (ask <= 1 - tick) {
      // an ask on YES is posted as a bid for NO, so the house never needs inventory
      await placeOrder({ leagueId: league.id, userId: HOUSE_USER, marketId, side: 'buy', outcome: 'no', type: 'limit', price: 1 - ask, size: QUOTE_SIZE, source: 'script' })
    }
  } catch (err) {
    console.warn('[house] quote failed', marketId, (err as Error).message)
  }
  markDirty()
}

export function startHouse() {
  ensureHouseUser()
  setInterval(async () => {
    const cutoff = now() - ACTIVE_MS
    for (const [k, at] of touched) {
      const [leagueId, marketId] = k.split(':')
      const league = db.leagues.get(leagueId)
      if (at < cutoff || !league || league.mode !== 'exchange' || !league.houseLiquidity) {
        touched.delete(k)
        if (league) cancelAll(league.id, HOUSE_USER, marketId)
        continue
      }
      await quote(league, marketId)
    }
  }, 20_000).unref()
}
