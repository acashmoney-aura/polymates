import { defaultRuntimeConfig } from './runtime-config'
import { supabase } from './supabase'
import type {
  LeagueMarketApproval,
  LeagueRuntimeContext,
  Market,
  ResolutionItem,
  TradeIntent,
} from './types'

const POLYMARKET_SOURCE = 'polymarket'

type PersistedRuntimeSnapshot = {
  context: LeagueRuntimeContext
  approvals: LeagueMarketApproval[]
  tradeIntents: TradeIntent[]
}

async function getLeagueContext(): Promise<LeagueRuntimeContext | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('leagues')
    .select('id, name, invite_code')
    .eq('invite_code', defaultRuntimeConfig.inviteCode)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    leagueId: data.id,
    leagueName: data.name,
    inviteCode: data.invite_code,
    viewerName: defaultRuntimeConfig.viewerName,
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

  const [{ data: approvalsData, error: approvalsError }, { data: intentsData, error: intentsError }] = await Promise.all([
    supabase
      .from('league_markets')
      .select('status, approval_source, created_at, external_markets!inner(external_id)')
      .eq('league_id', context.leagueId)
      .not('external_market_id', 'is', null),
    supabase
      .from('trade_intents')
      .select('id, side, shares, estimated_price, estimated_cost, status, created_at, market_title, external_markets(external_id)')
      .eq('league_id', context.leagueId)
      .order('created_at', { ascending: false })
      .limit(6),
  ])

  if (approvalsError) throw approvalsError
  if (intentsError) throw intentsError

  const approvals: LeagueMarketApproval[] = (approvalsData ?? []).map((row: any) => ({
    marketId: row.external_markets?.external_id ?? '',
    source: row.approval_source === 'seed' ? 'seed' : 'polymarket',
    approved: row.status === 'approved',
    approvedAt: new Date(row.created_at).toLocaleString(),
  }))

  const tradeIntents: TradeIntent[] = (intentsData ?? []).map((row: any) => ({
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

  return { context, approvals, tradeIntents }
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
