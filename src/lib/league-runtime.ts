import { useEffect, useMemo, useState } from 'react'
import { estimateBinaryTrade } from './amm'
import {
  leagueConfig,
  marketApprovals as seedApprovals,
  markets as fallbackMarkets,
  resolutionQueue as seedResolutionQueue,
  tradeIntents as seedTradeIntents,
} from './mock-data'
import {
  loadPersistedRuntimeSnapshot,
  persistMarketApproval,
  persistSettlementAction,
  persistTradeIntent,
} from './persistence'
import { fetchPolymarketMarkets } from './polymarket'
import { defaultRuntimeConfig } from './runtime-config'
import { runtimePersistenceMode } from './supabase'
import type {
  LeagueMarketApproval,
  LeagueRuntimeContext,
  Market,
  ResolutionItem,
  RuntimeSyncState,
  TradeIntent,
} from './types'

function makeTradeIntent(market: Market, side: 'YES' | 'NO', shares = 100): TradeIntent {
  const preview = estimateBinaryTrade({
    currentYesPrice: market.yesPrice,
    shares,
    side,
  })

  return {
    id: `intent-${market.id}-${Date.now()}`,
    marketId: market.id,
    marketTitle: market.title,
    side,
    shares,
    estimatedCost: preview.cost,
    estimatedPrice: side === 'YES' ? market.yesPrice : market.noPrice,
    status: runtimePersistenceMode === 'supabase' ? 'Queued' : 'Draft',
    createdAtLabel: 'just now',
  }
}

const fallbackContext: LeagueRuntimeContext = {
  leagueName: defaultRuntimeConfig.leagueName || leagueConfig.name,
  inviteCode: defaultRuntimeConfig.inviteCode || leagueConfig.inviteCode,
  viewerName: defaultRuntimeConfig.viewerName,
}

export function useLeagueRuntime() {
  const [context, setContext] = useState<LeagueRuntimeContext>(fallbackContext)
  const [liveMarkets, setLiveMarkets] = useState<Market[]>([])
  const [liveStatus, setLiveStatus] = useState<'loading' | 'live' | 'fallback'>('loading')
  const [selectedSetSlugs, setSelectedSetSlugs] = useState<string[]>(leagueConfig.approvedSetSlugs)
  const [approvals, setApprovals] = useState<LeagueMarketApproval[]>(seedApprovals)
  const [resolutionQueue, setResolutionQueue] = useState<ResolutionItem[]>(seedResolutionQueue)
  const [tradeIntents, setTradeIntents] = useState<TradeIntent[]>(seedTradeIntents)
  const [selectedMarketId, setSelectedMarketId] = useState(fallbackMarkets[0].id)
  const [syncState, setSyncState] = useState<RuntimeSyncState>({
    level: 'idle',
    message: runtimePersistenceMode === 'supabase' ? 'Waiting to sync runtime state.' : 'Local runtime fallback active.',
  })

  useEffect(() => {
    let cancelled = false

    async function loadLiveMarkets() {
      try {
        const fetched = await fetchPolymarketMarkets()
        if (cancelled) return
        if (fetched.length > 0) {
          setLiveMarkets(fetched)
          setLiveStatus('live')
          return
        }
        setLiveStatus('fallback')
      } catch {
        if (!cancelled) setLiveStatus('fallback')
      }
    }

    void loadLiveMarkets()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (runtimePersistenceMode !== 'supabase') return

    let cancelled = false

    async function hydrateFromSupabase() {
      try {
        setSyncState({ level: 'syncing', message: 'Loading persisted runtime state from Supabase…' })
        const snapshot = await loadPersistedRuntimeSnapshot()
        if (cancelled || !snapshot) return
        setContext(snapshot.context)
        if (snapshot.approvals.length > 0) setApprovals(snapshot.approvals)
        if (snapshot.tradeIntents.length > 0) setTradeIntents(snapshot.tradeIntents)
        setSyncState({ level: 'synced', message: 'Hydrated league context, approvals, and trade intents from Supabase.' })
      } catch (error) {
        if (cancelled) return
        setSyncState({
          level: 'error',
          message: error instanceof Error ? error.message : 'Supabase hydration failed.',
        })
      }
    }

    void hydrateFromSupabase()
    return () => {
      cancelled = true
    }
  }, [])

  const discoveryMarkets = liveMarkets.length > 0 ? liveMarkets : fallbackMarkets

  const whitelistedMarketIds = useMemo(
    () => approvals.filter((item) => item.approved).map((item) => item.marketId),
    [approvals],
  )

  const leagueVisibleMarkets = useMemo(() => {
    const approved = discoveryMarkets.filter((market) => whitelistedMarketIds.includes(market.id))
    return approved.length > 0 ? approved : discoveryMarkets
  }, [discoveryMarkets, whitelistedMarketIds])

  const selectedMarket = useMemo(
    () => leagueVisibleMarkets.find((market) => market.id === selectedMarketId) ?? leagueVisibleMarkets[0],
    [leagueVisibleMarkets, selectedMarketId],
  )

  function toggleMarketSet(slug: string) {
    setSelectedSetSlugs((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    )
  }

  async function toggleMarketApproval(market: Market) {
    const existing = approvals.find((item) => item.marketId === market.id)
    const nextApproved = !(existing?.approved ?? false)

    setApprovals((current) => {
      const found = current.find((item) => item.marketId === market.id)
      if (found) {
        return current.map((item) =>
          item.marketId === market.id
            ? {
                ...item,
                approved: nextApproved,
                approvedAt: nextApproved ? 'Just synced' : item.approvedAt,
              }
            : item,
        )
      }

      return [
        ...current,
        {
          marketId: market.id,
          source: liveMarkets.length > 0 ? 'polymarket' : 'seed',
          approved: true,
          approvedAt: 'Just synced',
        },
      ]
    })

    try {
      setSyncState({ level: 'syncing', message: `Saving market approval for ${market.title}…` })
      const result = await persistMarketApproval(market, nextApproved)
      if (result.mode === 'supabase' && result.context) setContext(result.context)
      setSyncState({
        level: result.mode === 'supabase' ? 'synced' : 'idle',
        message: result.mode === 'supabase' ? `Saved ${market.title} approval to Supabase.` : 'Local runtime fallback active.',
      })
    } catch (error) {
      setSyncState({
        level: 'error',
        message: error instanceof Error ? error.message : 'Failed to persist market approval.',
      })
    }
  }

  async function updateResolution(id: string, next: Partial<ResolutionItem>) {
    const currentItem = resolutionQueue.find((item) => item.id === id)
    if (!currentItem) return

    const updatedItem: ResolutionItem = { ...currentItem, ...next }

    setResolutionQueue((current) =>
      current.map((item) => (item.id === id ? updatedItem : item)),
    )

    try {
      setSyncState({ level: 'syncing', message: `Saving settlement action for ${updatedItem.marketTitle}…` })
      const result = await persistSettlementAction(updatedItem)
      if (result.mode === 'supabase' && result.context) setContext(result.context)
      setSyncState({
        level: result.mode === 'supabase' ? 'synced' : 'idle',
        message:
          result.mode === 'supabase'
            ? `Saved settlement action for ${updatedItem.marketTitle}.`
            : 'Local runtime fallback active.',
      })
    } catch (error) {
      setSyncState({
        level: 'error',
        message: error instanceof Error ? error.message : 'Failed to persist settlement action.',
      })
    }
  }

  async function queueTrade(side: 'YES' | 'NO', shares = 100) {
    if (!selectedMarket) return
    const intent = makeTradeIntent(selectedMarket, side, shares)
    setTradeIntents((current) => [intent, ...current].slice(0, 6))

    try {
      setSyncState({ level: 'syncing', message: `Saving ${side} trade intent for ${selectedMarket.title}…` })
      const result = await persistTradeIntent(intent, selectedMarket)
      if (result.mode === 'supabase' && result.context) setContext(result.context)
      setSyncState({
        level: result.mode === 'supabase' ? 'synced' : 'idle',
        message:
          result.mode === 'supabase'
            ? `Saved trade intent for ${selectedMarket.title}.`
            : 'Local runtime fallback active.',
      })
    } catch (error) {
      setSyncState({
        level: 'error',
        message: error instanceof Error ? error.message : 'Failed to persist trade intent.',
      })
    }
  }

  return {
    context,
    runtimePersistenceMode,
    liveStatus,
    selectedSetSlugs,
    approvals,
    resolutionQueue,
    tradeIntents,
    selectedMarketId,
    selectedMarket,
    discoveryMarkets,
    leagueVisibleMarkets,
    syncState,
    toggleMarketSet,
    toggleMarketApproval,
    updateResolution,
    queueTrade,
    setSelectedMarketId,
  }
}
