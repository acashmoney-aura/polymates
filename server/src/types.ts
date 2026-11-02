export type Outcome = 'yes' | 'no'
export type Side = 'buy' | 'sell'
export type LeagueMode = 'mirror' | 'exchange'
export type OrderType = 'limit' | 'market'
export type OrderSource = 'web' | 'api' | 'mcp' | 'script'

export interface User {
  id: string
  username: string
  displayName: string
  /** empty for accounts that only sign in with Google */
  passHash: string
  salt: string
  avatarHue: number
  createdAt: number
  googleSub?: string
  email?: string
  avatarUrl?: string
}

export interface Session {
  token: string
  userId: string
  createdAt: number
}

export interface ApiKey {
  id: string
  userId: string
  name: string
  prefix: string
  hash: string
  createdAt: number
  lastUsedAt: number | null
}

/**
 * A league is a private game. `mirror` leagues fill orders against the live
 * Polymarket order book (paper trading with friends). `exchange` leagues run
 * their own central limit order book where members only trade with each other.
 * Either way markets are Polymarket markets and resolve exactly as Polymarket does.
 */
export interface League {
  id: string
  name: string
  inviteCode: string
  mode: LeagueMode
  startingBalance: number
  ownerId: string
  createdAt: number
  /** 'all' = every Polymarket market is tradable; 'curated' = only enabledEvents */
  marketScope: 'all' | 'curated'
  enabledEvents: string[]
  disabledMarkets: string[]
  /** exchange mode: a house bot quotes around the Polymarket price so books are never empty */
  houseLiquidity: boolean
  description?: string
  /** bumps every time the owner restarts the league from scratch */
  season?: number
  seasonStartedAt?: number
}

export interface Member {
  leagueId: string
  userId: string
  /** owner: everything; admin: settings, markets and members; member: trade */
  role: 'owner' | 'admin' | 'member'
  cash: number
  joinedAt: number
}

export interface Position {
  leagueId: string
  userId: string
  marketId: string
  yes: number
  no: number
  yesCost: number
  noCost: number
  realized: number
}

export interface Order {
  id: string
  leagueId: string
  userId: string
  marketId: string
  side: Side
  outcome: Outcome
  type: OrderType
  /** limit price for the chosen outcome (0..1). Market orders store their worst acceptable price. */
  price: number
  size: number
  filled: number
  /** dollars spent / received so far */
  notional: number
  status: 'open' | 'filled' | 'cancelled'
  source: OrderSource
  createdAt: number
  updatedAt: number
}

export interface Trade {
  id: string
  leagueId: string
  marketId: string
  /** price of the YES outcome at which the fill happened */
  yesPrice: number
  size: number
  takerOrderId: string
  makerOrderId: string | null
  takerUserId: string
  makerUserId: string | null
  takerSide: Side
  takerOutcome: Outcome
  /** recorded since leaderboards; older trades look the maker order up */
  makerSide?: Side
  makerOutcome?: Outcome
  ts: number
}

export interface Script {
  id: string
  userId: string
  leagueId: string
  name: string
  code: string
  enabled: boolean
  intervalSec: number
  createdAt: number
  updatedAt: number
  lastRunAt: number | null
  lastError: string | null
  runs: number
  store: unknown
}

export interface ScriptLog {
  ts: number
  level: 'info' | 'error'
  msg: string
}

export interface Settlement {
  leagueId: string
  marketId: string
  payout: [number, number]
  ts: number
}

/** a member's prediction-market P&L since they joined (or the season began), sampled for leaderboard charts */
export interface EquityPoint {
  ts: number
  pnl: number
}

export interface Activity {
  id: string
  leagueId: string
  userId: string
  kind: 'trade' | 'join' | 'resolve' | 'create' | 'admin'
  text: string
  marketId?: string
  ts: number
}

/* ---------------- Polymarket catalog ---------------- */

export interface PMMarket {
  id: string
  conditionId: string
  eventId: string
  slug: string
  question: string
  groupTitle: string
  image: string
  tokenYes: string
  tokenNo: string
  outcomes: [string, string]
  /** Gamma's current price for outcome[0] */
  price: number
  bestBid: number | null
  bestAsk: number | null
  lastTrade: number | null
  change24h: number | null
  volume: number
  volume24h: number
  endDate: string | null
  tick: number
  active: boolean
  closed: boolean
  resolved: boolean
  payout: [number, number] | null
  description: string
  threshold: number
}

export interface PMEvent {
  id: string
  slug: string
  title: string
  description: string
  image: string
  icon: string
  tags: { slug: string; label: string }[]
  marketIds: string[]
  volume: number
  volume24h: number
  liquidity: number
  endDate: string | null
  startDate: string | null
  createdAt: string | null
  negRisk: boolean
  closed: boolean
  commentCount: number
  resolutionSource: string
  rank: number
}

export interface BookLevel {
  price: number
  size: number
}

export interface Book {
  bids: BookLevel[]
  asks: BookLevel[]
}

/* ---------------- perps ---------------- */

export type PerpSide = 'long' | 'short'

/** An isolated-margin perpetual futures position in a league (see perps.ts). */
export interface PerpPosition {
  id: string
  leagueId: string
  userId: string
  symbol: string
  side: PerpSide
  leverage: number
  /** units of the underlying */
  qty: number
  entryPrice: number
  /** collateral locked from league cash */
  margin: number
  liqPrice: number
  takeProfit?: number
  stopLoss?: number
  /** cumulative funding paid (negative = received) */
  funding: number
  /** opening + closing taker fees */
  fees: number
  openFee: number
  status: 'open' | 'closed' | 'liquidated'
  closeReason?: 'manual' | 'tp' | 'sl' | 'liquidation'
  exitPrice?: number
  /** net P&L after funding and fees, set on close */
  realized?: number
  source: OrderSource
  openedAt: number
  closedAt?: number
  lastFundingAt: number
}
