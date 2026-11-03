import { useSyncExternalStore } from 'react'
import { API_URL } from './api'

/**
 * Live Polymarket prices pushed by the API (/api/live) once a second, plus perps mark prices every couple of
 * seconds (as `perps` events, keyed `perp:SYMBOL` here). One shared EventSource for the
 * whole app, opened when the first component subscribes and closed when the last one leaves.
 */

export interface LiveQuote { price: number; bid: number | null; ask: number | null; last: number | null; at: number }

const quotes = new Map<string, LiveQuote>()
export interface PerpMark { price: number; prev: number | null; at: number }
const perpMarks = new Map<string, PerpMark>()
const listeners = new Map<string, Set<() => void>>()
let es: EventSource | null = null
let retry: ReturnType<typeof setTimeout> | null = null
let subscribers = 0

function connect() {
  es = new EventSource(`${API_URL}/api/live`)
  es.onmessage = (msg) => {
    const batch = JSON.parse(msg.data) as { t: number; u: [string, number, number | null, number | null, number | null][] }
    for (const [id, price, bid, ask, last] of batch.u) {
      quotes.set(id, { price, bid, ask, last, at: batch.t })
      listeners.get(id)?.forEach((fn) => fn())
    }
  }
  es.addEventListener('perps', (msg) => {
    const batch = JSON.parse((msg as MessageEvent).data) as { t: number; u: [string, number][] }
    for (const [symbol, price] of batch.u) {
      const key = `perp:${symbol}`
      const prev = perpMarks.get(key)
      if (prev && prev.price === price) continue
      perpMarks.set(key, { price, prev: prev?.price ?? null, at: batch.t })
      listeners.get(key)?.forEach((fn) => fn())
    }
  })
  es.onerror = () => {
    es?.close()
    es = null
    if (subscribers > 0) retry = setTimeout(connect, 3000)
  }
}

function subscribe(id: string, fn: () => void) {
  let set = listeners.get(id)
  if (!set) listeners.set(id, (set = new Set()))
  set.add(fn)
  if (subscribers++ === 0 && !es) connect()
  return () => {
    set.delete(fn)
    if (!set.size) listeners.delete(id)
    if (--subscribers === 0) {
      // keep the stream briefly so page changes don't reconnect
      setTimeout(() => {
        if (subscribers === 0) {
          es?.close()
          es = null
          if (retry) clearTimeout(retry)
        }
      }, 5000)
    }
  }
}

/**
 * The live Polymarket quote for a market, or null until one arrives. Pass `enabled=false` (e.g. in an
 * exchange league, where prices come from the league's own book) to skip subscribing.
 */
export function useLiveQuote(marketId: string | undefined, enabled = true): LiveQuote | null {
  return useSyncExternalStore(
    (fn) => (enabled && marketId ? subscribe(marketId, fn) : () => {}),
    () => (enabled && marketId ? quotes.get(marketId) ?? null : null),
  )
}

/** The latest perps mark price pushed for `symbol` (with the one before it), or null until one arrives. */
export function usePerpMark(symbol: string | undefined): PerpMark | null {
  const key = symbol ? `perp:${symbol.toUpperCase()}` : undefined
  return useSyncExternalStore(
    (fn) => (key ? subscribe(key, fn) : () => {}),
    () => (key ? perpMarks.get(key) ?? null : null),
  )
}
