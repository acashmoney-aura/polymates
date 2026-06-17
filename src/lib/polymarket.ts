import type { Market, PolymarketAccountPosition } from './types'

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
const POLYMARKET_POSITIONS_URL = 'https://data-api.polymarket.com/positions'

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

type PolymarketPositionResponse = {
  conditionId?: string
  title?: string
  outcome?: string
  size?: number
  avgPrice?: number
  currentValue?: number
  cashPnl?: number
  percentPnl?: number
  curPrice?: number
  endDate?: string
}

function isWalletAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim())
}

export async function fetchPolymarketAccountPositions(walletAddress: string): Promise<PolymarketAccountPosition[]> {
  const user = walletAddress.trim()
  if (!isWalletAddress(user)) {
    throw new Error('Enter a valid 0x wallet or Polymarket proxy-wallet address.')
  }

  const url = new URL(POLYMARKET_POSITIONS_URL)
  url.searchParams.set('user', user)
  url.searchParams.set('limit', '25')
  url.searchParams.set('sortBy', 'CASHPNL')
  url.searchParams.set('sortDirection', 'DESC')

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Polymarket positions fetch failed: ${response.status}`)
  }

  const data = (await response.json()) as PolymarketPositionResponse[]
  return data.map((item) => ({
    conditionId: item.conditionId ?? '',
    title: item.title ?? 'Untitled market',
    outcome: item.outcome ?? 'Outcome',
    size: Number(item.size ?? 0),
    avgPrice: Number(item.avgPrice ?? 0),
    currentValue: Number(item.currentValue ?? 0),
    cashPnl: Number(item.cashPnl ?? 0),
    percentPnl: Number(item.percentPnl ?? 0),
    curPrice: Number(item.curPrice ?? 0),
    endDate: item.endDate,
  }))
}
