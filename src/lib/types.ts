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

export type LeagueConfig = {
  name: string
  inviteCode: string
  inviteLink: string
  approvedSetSlugs: string[]
  memberCount: number
  startingBalance: number
  weeklyBonus: number
}

export type LeagueRuntimeContext = {
  leagueId?: string
  leagueName: string
  inviteCode: string
  viewerName: string
}

export type ResolutionStatus = 'Ready' | 'Paused' | 'Resolved'

export type ResolutionItem = {
  id: string
  marketId: string
  marketTitle: string
  league: string
  result: 'YES' | 'NO' | 'Pending'
  status: ResolutionStatus
  note: string
}

export type LeagueMarketApproval = {
  marketId: string
  source: 'polymarket' | 'seed'
  approved: boolean
  approvedAt: string
}

export type TradeIntentStatus = 'Draft' | 'Queued' | 'Filled'

export type TradeIntent = {
  id: string
  marketId?: string
  marketTitle: string
  side: 'YES' | 'NO'
  shares: number
  estimatedCost: number
  estimatedPrice: number
  status: TradeIntentStatus
  createdAtLabel: string
}

export type RuntimePersistenceMode = 'local' | 'supabase'

export type RuntimeSyncState = {
  level: 'idle' | 'syncing' | 'synced' | 'error'
  message: string
}
