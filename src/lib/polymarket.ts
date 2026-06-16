import type { Market } from './types'

type GammaMarket = {
  id?: string | number
  question?: string
  title?: string
  volume?: number | string
  endDate?: string
  active?: boolean
  closed?: boolean
  outcomes?: string | string[]
  outcomePrices?: string | string[]
}

const POLYMARKET_GAMMA_URL =
  'https://gamma-api.polymarket.com/markets?limit=12&closed=false&active=true'

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

function formatCloseLabel(endDate?: string): string {
  if (!endDate) return 'Close time unavailable'
  const date = new Date(endDate)
  if (Number.isNaN(date.getTime())) return 'Close time unavailable'
  return `Live on Polymarket · closes ${date.toLocaleString()}`
}

function formatVolume(value?: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value ?? 0
  if (!Number.isFinite(n)) return 'Volume unavailable'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M live volume`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k live volume`
  return `$${n.toFixed(0)} live volume`
}

function marketStatus(item: GammaMarket): Market['status'] {
  if (item.closed) return 'Resolved'
  return 'Open'
}

function toAppMarket(item: GammaMarket): Market | null {
  const outcomes = parseStringArray(item.outcomes)
  const prices = parseStringArray(item.outcomePrices).map(Number)
  const yesIndex = outcomes.findIndex((label) => label.toLowerCase() === 'yes')
  const noIndex = outcomes.findIndex((label) => label.toLowerCase() === 'no')
  if (yesIndex === -1 || noIndex === -1) return null

  const yesPrice = Math.round((prices[yesIndex] ?? 0.5) * 100)
  const noPrice = Math.round((prices[noIndex] ?? 0.5) * 100)
  const title = item.question || item.title
  if (!title) return null

  return {
    id: String(item.id ?? title),
    title,
    stage: 'Live Polymarket Market',
    closes: formatCloseLabel(item.endDate),
    yesPrice,
    noPrice,
    volume: formatVolume(item.volume),
    rules: 'Live read from Polymarket Gamma API. Fantasy leagues can mirror or whitelist these markets.',
    status: marketStatus(item),
  }
}

export async function fetchPolymarketMarkets(): Promise<Market[]> {
  const response = await fetch(POLYMARKET_GAMMA_URL, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Polymarket fetch failed: ${response.status}`)
  }

  const data = (await response.json()) as GammaMarket[]
  return data.map(toAppMarket).filter((market): market is Market => Boolean(market))
}
