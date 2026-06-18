import { defaultRuntimeConfig } from './runtime-config'
import { supabase } from './supabase'
import type {
  Activity,
  LeagueMarketApproval,
  LeagueMember,
  LeagueRuntimeContext,
  Market,
  MarketSet,
  Position,
  ResolutionItem,
  TradeIntent,
} from './types'

const POLYMARKET_SOURCE = 'polymarket'

type PersistedRuntimeSnapshot = {
  context: LeagueRuntimeContext
  approvals: LeagueMarketApproval[]
  tradeIntents: TradeIntent[]
  activity: Activity[]
  members: LeagueMember[]
  marketSets: MarketSet[]
  positions: Position[]
  approvedMarkets: Market[]
}

type ApprovalRow = {
  status: string
  approval_source: string
  created_at: string
  external_markets: {
    external_id?: string
    title?: string
    stage_label?: string | null
    closes_label?: string | null
    yes_price?: number | string | null
    no_price?: number | string | null
    volume_label?: string | null
    raw_payload?: {
      rules?: string
      status?: string
      gamma?: {
        clobTokenIds?: string | string[]
        conditionId?: string
        slug?: string
        category?: string
      }
    } | null
  } | null
}

type TradeIntentRow = {
  id: string
  side: string | null
  shares: number | string
  estimated_price: number | string
  estimated_cost: number | string
  status: string | null
  created_at: string
  market_title: string
  external_markets: { external_id?: string } | null
}

type MarketSetRow = {
  market_sets: {
    slug: string
    name: string
    description: string | null
  } | { slug: string; name: string; description: string | null }[] | null
}

type SnapshotRow = {
  rank: number | null
  cash_balance: number | string
  portfolio_value: number | string
  realized_pnl: number | string
  unrealized_pnl: number | string
  users: { username?: string | null } | null
}

type ActivityRow = {
  created_at: string
  metadata: { text?: string; amount?: string; side?: string } | null
  users: { username?: string | null } | null
}

function parseJsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

async function getLeagueContext(): Promise<LeagueRuntimeContext | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('leagues')
    .select('id, name, invite_code, starting_balance, weekly_bonus')
    .eq('invite_code', defaultRuntimeConfig.inviteCode)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    leagueId: data.id,
    leagueName: data.name,
    inviteCode: data.invite_code,
    viewerName: defaultRuntimeConfig.viewerName,
    startingBalance: Number(data.starting_balance ?? 10000),
    weeklyBonus: Number(data.weekly_bonus ?? 2000),
  }
}

async function ensureExternalMarket(market: Market) {
  if (!supabase) return null

  const payload = {
    source: POLYMARKET_SOURCE,
    external_id: market.id,
    title: market.title,
    stage_label: market.stage,
    closes_label: market.closes,
    yes_price: market.yesPrice,
    no_price: market.noPrice,
    volume_label: market.volume,
    raw_payload: {
      rules: market.rules,
      status: market.status,
    },
  }

  const { data, error } = await supabase
    .from('external_markets')
    .upsert(payload, { onConflict: 'source,external_id' })
    .select('id')
    .single()

  if (error) throw error
  return data.id as string
}

export async function loadPersistedRuntimeSnapshot(): Promise<PersistedRuntimeSnapshot | null> {
  if (!supabase) return null

  const context = await getLeagueContext()
  if (!context?.leagueId) return null
  const db = supabase
  const leagueId = context.leagueId

  async function loadApprovalRows() {
    const pageSize = 1000
    const rows: ApprovalRow[] = []
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db
        .from('league_markets')
        .select('status, approval_source, created_at, external_markets!inner(external_id, title, stage_label, closes_label, yes_price, no_price, volume_label, raw_payload)')
        .eq('league_id', leagueId)
        .not('external_market_id', 'is', null)
        .range(from, from + pageSize - 1)

      if (error) throw error
      const pageRows = ((data ?? []) as unknown as ApprovalRow[])
      rows.push(...pageRows)
      if (pageRows.length < pageSize) break
    }
    return rows
  }

  const [
    approvalRows,
    { data: intentsData, error: intentsError },
    { data: marketSetsData, error: marketSetsError },
    { data: snapshotsData, error: snapshotsError },
    { data: activityData, error: activityError },
  ] = await Promise.all([
    loadApprovalRows(),
    db
      .from('trade_intents')
      .select('id, side, shares, estimated_price, estimated_cost, status, created_at, market_title, external_markets(external_id)')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
      .limit(6),
    db
      .from('league_market_sets')
      .select('market_sets!inner(slug, name, description)')
      .eq('league_id', leagueId)
      .eq('enabled', true),
    db
      .from('league_snapshots')
      .select('rank, cash_balance, portfolio_value, realized_pnl, unrealized_pnl, users!inner(username)')
      .eq('league_id', leagueId)
      .order('rank', { ascending: true })
      .limit(12),
    db
      .from('activity_feed')
      .select('created_at, metadata, users(username)')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
      .limit(8),
  ])

  if (intentsError) throw intentsError
  if (marketSetsError) throw marketSetsError
  if (snapshotsError) throw snapshotsError
  if (activityError) throw activityError

  const approvals: LeagueMarketApproval[] = approvalRows.map((row) => ({
    marketId: row.external_markets?.external_id ?? '',
    source: row.approval_source === 'seed' ? 'seed' : 'polymarket',
    approved: row.status === 'approved',
    approvedAt: new Date(row.created_at).toLocaleString(),
  }))

  const approvedMarkets: Market[] = approvalRows
    .filter((row) => row.status === 'approved' && row.external_markets)
    .map((row) => {
      const gamma = row.external_markets?.raw_payload?.gamma
      const tokenIds = Array.isArray(gamma?.clobTokenIds)
        ? gamma.clobTokenIds.map(String)
        : typeof gamma?.clobTokenIds === 'string'
          ? parseJsonStringArray(gamma.clobTokenIds)
          : []

      return {
        id: row.external_markets?.external_id ?? '',
        title: row.external_markets?.title ?? 'Untitled market',
        stage: row.external_markets?.stage_label ?? 'Live Polymarket Market',
        closes: row.external_markets?.closes_label ?? 'Close time unavailable',
        yesPrice: Number(row.external_markets?.yes_price ?? 50),
        noPrice: Number(row.external_markets?.no_price ?? 50),
        volume: row.external_markets?.volume_label ?? 'Volume unavailable',
        rules: row.external_markets?.raw_payload?.rules ?? 'Live Polymarket market mirrored into a fantasy league.',
        status: row.external_markets?.raw_payload?.status === 'Resolved' ? 'Resolved' : 'Open',
        clobTokenIds: tokenIds,
        conditionId: gamma?.conditionId,
        slug: gamma?.slug,
        category: gamma?.category,
      }
    })

  const tradeIntents: TradeIntent[] = ((intentsData ?? []) as TradeIntentRow[]).map((row) => ({
    id: row.id,
    marketId: row.external_markets?.external_id ?? undefined,
    marketTitle: row.market_title,
    side: row.side?.toUpperCase() === 'NO' ? 'NO' : 'YES',
    shares: Number(row.shares),
    estimatedCost: Number(row.estimated_cost),
    estimatedPrice: Number(row.estimated_price),
    status: row.status === 'filled' ? 'Filled' : row.status === 'queued' ? 'Queued' : 'Draft',
    createdAtLabel: new Date(row.created_at).toLocaleString(),
  }))

  const marketSets: MarketSet[] = ((marketSetsData ?? []) as unknown as MarketSetRow[]).map((row) => {
    const marketSet = Array.isArray(row.market_sets) ? row.market_sets[0] : row.market_sets
    return {
      slug: marketSet?.slug ?? '',
      title: marketSet?.name ?? 'Market set',
      description: marketSet?.description ?? '',
      eventCount: approvedMarkets.length,
      leagueCount: 1,
    }
  })

  const members: LeagueMember[] = ((snapshotsData ?? []) as SnapshotRow[]).map((row, index) => {
    const portfolio = Number(row.portfolio_value)
    const realizedPnl = Number(row.realized_pnl)
    const unrealizedPnl = Number(row.unrealized_pnl)
    const pnl = realizedPnl + unrealizedPnl
    return {
      name: row.users?.username ?? `Member ${index + 1}`,
      rank: row.rank ?? index + 1,
      portfolio: `$${portfolio.toLocaleString()}`,
      pnl: `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toLocaleString()}`,
      note: pnl >= 0 ? 'Positive fantasy P/L' : 'Chasing a comeback',
      portfolioValue: portfolio,
      cashBalance: Number(row.cash_balance),
      realizedPnl,
      unrealizedPnl,
    }
  })

  const activity: Activity[] = ((activityData ?? []) as ActivityRow[]).map((row) => ({
    user: row.users?.username ?? 'League member',
    text: row.metadata?.text ?? 'updated league activity.',
    time: new Date(row.created_at).toLocaleString(),
  }))

  const positions: Position[] = tradeIntents.slice(0, 6).map((intent) => ({
    market: intent.marketTitle,
    side: intent.side,
    shares: intent.shares,
    avgPrice: intent.estimatedPrice / 100,
    currentValue: `$${intent.estimatedCost.toFixed(2)}`,
    pnl: intent.status === 'Filled' ? '+$0.00' : 'Queued',
  }))

  return { context: { ...context, memberCount: members.length }, approvals, tradeIntents, activity, members, marketSets, positions, approvedMarkets }
}

export async function persistMarketApproval(market: Market, approved: boolean) {
  if (!supabase) return { mode: 'local' as const }

  const context = await getLeagueContext()
  if (!context?.leagueId) return { mode: 'local' as const }

  const externalMarketId = await ensureExternalMarket(market)

  const payload = {
    league_id: context.leagueId,
    external_market_id: externalMarketId,
    approval_source: POLYMARKET_SOURCE,
    status: approved ? 'approved' : 'archived',
  }

  const { error } = await supabase.from('league_markets').upsert(payload, {
    onConflict: 'league_id,external_market_id',
  })

  if (error) throw error
  return { mode: 'supabase' as const, context }
}

export async function persistTradeIntent(intent: TradeIntent, market: Market) {
  if (!supabase) return { mode: 'local' as const }

  const context = await getLeagueContext()
  if (!context?.leagueId) return { mode: 'local' as const }

  const externalMarketId = await ensureExternalMarket(market)

  const payload = {
    league_id: context.leagueId,
    external_market_id: externalMarketId,
    side: intent.side.toLowerCase(),
    shares: intent.shares,
    estimated_price: intent.estimatedPrice,
    estimated_cost: intent.estimatedCost,
    status: intent.status.toLowerCase(),
    market_title: intent.marketTitle,
  }

  const { error } = await supabase.from('trade_intents').insert(payload)
  if (error) throw error

  return { mode: 'supabase' as const, context }
}

export async function persistSettlementAction(item: ResolutionItem) {
  if (!supabase) return { mode: 'local' as const }

  const context = await getLeagueContext()
  if (!context?.leagueId) return { mode: 'local' as const }

  const market: Market = {
    id: item.marketId,
    title: item.marketTitle,
    stage: item.league,
    closes: item.note,
    yesPrice: 0,
    noPrice: 0,
    volume: '',
    rules: item.note,
    status: 'Open',
  }

  const externalMarketId = await ensureExternalMarket(market)

  const payload = {
    league_id: context.leagueId,
    external_market_id: externalMarketId,
    result: item.result === 'Pending' ? null : item.result,
    action_type: item.status.toLowerCase(),
    note: item.note,
    market_title: item.marketTitle,
  }

  const { error } = await supabase.from('settlement_actions').insert(payload)
  if (error) throw error

  return { mode: 'supabase' as const, context }
}
