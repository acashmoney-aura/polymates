import type { Request } from 'express'

/**
 * Token-bucket rate limits, kept in memory (the API is one instance). Each limit has a steady rate and a burst:
 * a key may spend `burst` requests at once, then refills at `perSec`. Logged-in traffic (website session or API
 * key) is limited per account; anonymous traffic per client IP. Per-IP limits are generous because a room of
 * people on campus wifi can share one public IP.
 *
 * Every limit can be tuned without a code change: RL_<NAME>=perSec/burst, e.g. RL_USER=30/120.
 */

export interface Limit { perSec: number; burst: number }

const env = (name: string, perSec: number, burst: number): Limit => {
  const m = String(process.env[`RL_${name}`] ?? '').match(/^([\d.]+)\/(\d+)$/)
  return m ? { perSec: Number(m[1]), burst: Number(m[2]) } : { perSec, burst }
}

export const LIMITS = {
  /** all requests from one account (website session or API key) */
  user: env('USER', 15, 90),
  /** anonymous requests from one IP (a whole room before anyone logs in) */
  ip: env('IP', 100, 600),
  /** order placement/cancel, perps, script runs, MCP calls, per account */
  trade: env('TRADE', 8, 30),
  /** signup / login / Google sign-in per IP; each one runs a blocking scrypt hash */
  auth: env('AUTH', 1, 80),
  /** signup / login across everyone, so a flood can't stall the event loop on scrypt */
  authGlobal: env('AUTH_GLOBAL', 8, 40),
  /** everything, across everyone: past this the server sheds load rather than slowing for all */
  global: env('GLOBAL', 1500, 3000),
}

/** Concurrent streaming connections (/api/live, /api/stream). */
export const STREAMS = {
  perUser: Number(process.env.RL_STREAMS_USER ?? 12),
  perIp: Number(process.env.RL_STREAMS_IP ?? 400),
  total: Number(process.env.RL_STREAMS_TOTAL ?? 4000),
}

interface Bucket { tokens: number; at: number }
const buckets = new Map<string, Bucket>()
const blocked = new Map<string, number>()

/** Takes one token from `key`'s bucket. Returns 0 if allowed, else seconds until a token is available. */
export function take(name: keyof typeof LIMITS, key: string, now = Date.now()): number {
  const lim = LIMITS[name]
  const k = `${name}:${key}`
  let b = buckets.get(k)
  if (!b) buckets.set(k, (b = { tokens: lim.burst, at: now }))
  b.tokens = Math.min(lim.burst, b.tokens + ((now - b.at) / 1000) * lim.perSec)
  b.at = now
  if (b.tokens >= 1) {
    b.tokens -= 1
    return 0
  }
  blocked.set(name, (blocked.get(name) ?? 0) + 1)
  return Math.max(1, Math.ceil((1 - b.tokens) / lim.perSec))
}

/**
 * The caller's IP. Cloud Run's front end appends the real client address as the LAST X-Forwarded-For entry;
 * earlier entries are whatever the client sent, so trusting the first one would let anyone dodge per-IP limits.
 */
export function clientIp(req: Request) {
  const xff = String(req.headers['x-forwarded-for'] ?? '')
  const last = xff.split(',').map((s) => s.trim()).filter(Boolean).pop()
  return last || req.socket.remoteAddress || 'unknown'
}

/* ---------------- streams ---------------- */

const streamCounts = new Map<string, number>()
let streamTotal = 0

/** Reserves a stream slot for each key; returns a release function, or null if any cap is full. */
export function openStream(userKey: string | null, ip: string): (() => void) | null {
  const keys = [`ip:${ip}`, ...(userKey ? [`u:${userKey}`] : [])]
  if (streamTotal >= STREAMS.total) return null
  if ((streamCounts.get(`ip:${ip}`) ?? 0) >= STREAMS.perIp) return null
  if (userKey && (streamCounts.get(`u:${userKey}`) ?? 0) >= STREAMS.perUser) return null
  streamTotal++
  for (const k of keys) streamCounts.set(k, (streamCounts.get(k) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    streamTotal--
    for (const k of keys) {
      const n = (streamCounts.get(k) ?? 1) - 1
      if (n <= 0) streamCounts.delete(k)
      else streamCounts.set(k, n)
    }
  }
}

/** Rejections per limit since boot, plus open streams; shown on /api/admin/stats. */
export function rateLimitStats() {
  return { blocked: Object.fromEntries(blocked), streams: streamTotal, buckets: buckets.size, limits: LIMITS, streamLimits: STREAMS }
}

// full buckets carry no information; drop them so the map doesn't grow with every IP that ever visited
setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) if (now - b.at > 5 * 60_000) buckets.delete(k)
}, 60_000).unref()
