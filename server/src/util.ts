import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'

export const id = (prefix: string) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`
export const now = () => Date.now()

/** money is kept to 1e-6 dollars, shares to 1e-4, prices to 1e-4 */
export const money = (x: number) => Math.round(x * 1e6) / 1e6
export const shares = (x: number) => Math.floor(x * 1e4 + 1e-6) / 1e4
export const px = (x: number) => Math.round(x * 1e4) / 1e4

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const fail = (status: number, message: string): never => {
  throw new HttpError(status, message)
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex')
  return { hash, salt }
}

export function verifyPassword(password: string, salt: string, expected: string) {
  const { hash } = hashPassword(password, salt)
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'))
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url')

export function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (const b of crypto.randomBytes(6)) out += alphabet[b % alphabet.length]
  return out
}

/** league-scoped pub/sub feeding the SSE stream */
export interface BusEvent {
  type: 'trade' | 'book' | 'orders' | 'portfolio' | 'activity' | 'resolve' | 'league'
  leagueId: string
  marketId?: string
  userId?: string
  data?: unknown
}

export const bus = new EventEmitter()
bus.setMaxListeners(0)
export const emit = (e: BusEvent) => bus.emit('event', e)

export async function fetchJson<T>(url: string, timeoutMs = 10_000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return (await res.json()) as T
}
