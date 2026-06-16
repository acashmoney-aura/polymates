export type LeagueMember = {
  name: string
  rank: number
  portfolio: string
  pnl: string
  note: string
}

export type MarketStatus = 'Open' | 'Closing Soon' | 'Resolved'

export type MarketSet = {
  slug: string
  title: string
  description: string
  eventCount: number
  leagueCount: number
}

export type Market = {
  id: string
  title: string
  stage: string
  closes: string
  yesPrice: number
  noPrice: number
  volume: string
  rules: string
  status: MarketStatus
}

export type Position = {
  market: string
  side: 'YES' | 'NO'
  shares: number
  avgPrice: number
  currentValue: string
  pnl: string
}

export type Activity = {
  user: string
  text: string
  time: string
}

export type LeagueMode = {
  title: string
  body: string
}
