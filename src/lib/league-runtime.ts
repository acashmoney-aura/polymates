import { useEffect, useMemo, useState } from 'react'
import { estimateBinaryTrade } from './amm'
import {
  leagueConfig,
  marketApprovals as seedApprovals,
  markets as fallbackMarkets,
  resolutionQueue as seedResolutionQueue,
  tradeIntents as seedTradeIntents,
} from './mock-data'
import { fetchPolymarketMarkets } from './polymarket'
import { runtimePersistenceMode } from './supabase'
import type { LeagueMarketApproval, Market, ResolutionItem, TradeIntent } from './types'

function makeTradeIntent(market: Market, side: 'YES' | 'NO', shares = 100): TradeIntent {
  const preview = estimateBinaryTrade({
    currentYesPrice: market.yesPrice,
    shares,
    side,
  })

  return {
    id: `intent-${market.id}-${Date.now()}`,
    marketTitle: market.title,
    side,
    shares,
    estimatedCost: preview.cost,
    estimatedPrice: side === 'YES' ? market.yesPrice : market.noPrice,
    status: runtimePersistenceMode === 'supabase' ? 'Queued' : 'Draft',
    createdAtLabel: 'just now',
  }
}

export function useLeagueRuntime() {
  const [liveMarkets, setLiveMarkets] = useState<Market[]>([])
  const [liveStatus, setLiveStatus] = useState<'loading' | 'live' | 'fallback'>('loading')
  const [selectedSetSlugs, setSelectedSetSlugs] = useState<string[]>(leagueConfig.approvedSetSlugs)
  const [approvals, setApprovals] = useState<LeagueMarketApproval[]>(seedApprovals)
  const [resolutionQueue, setResolutionQueue] = useState<ResolutionItem[]>(seedResolutionQueue)
  const [tradeIntents, setTradeIntents] = useState<TradeIntent[]>(seedTradeIntents)
  const [selectedMarketId, setSelectedMarketId] = useState(fallbackMarkets[0].id)

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

  const discoveryMarkets = liveMarkets.length > 0 ? liveMarkets : fallbackMarkets

  useEffect(() => {
    if (discoveryMarkets.length === 0 || approvals.length > 0) return
    setApprovals(
      discoveryMarkets.slice(0, 3).map((market) => ({
        marketId: market.id,
        source: liveMarkets.length > 0 ? 'polymarket' : 'seed',
        approved: true,
        approvedAt: 'Just synced',
      })),
    )
  }, [approvals.length, discoveryMarkets, liveMarkets.length])

  const whitelistedMarketIds = useMemo(
    () => approvals.filter((item) => item.approved).map((item) => item.marketId),
    [approvals],
  )

  const leagueVisibleMarkets = useMemo(() => {
    const approved = discoveryMarkets.filter((market) => whitelistedMarketIds.includes(market.id))
    return approved.length > 0 ? approved : discoveryMarkets
  }, [discoveryMarkets, whitelistedMarketIds])

  useEffect(() => {
    if (!leagueVisibleMarkets.some((market) => market.id === selectedMarketId)) {
      setSelectedMarketId(leagueVisibleMarkets[0]?.id ?? '')
    }
  }, [leagueVisibleMarkets, selectedMarketId])

  const selectedMarket = useMemo(
    () => leagueVisibleMarkets.find((market) => market.id === selectedMarketId) ?? leagueVisibleMarkets[0],
    [leagueVisibleMarkets, selectedMarketId],
  )

  function toggleMarketSet(slug: string) {
    setSelectedSetSlugs((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    )
  }

  function toggleMarketApproval(market: Market) {
    setApprovals((current) => {
      const existing = current.find((item) => item.marketId === market.id)
      if (existing) {
        return current.map((item) =>
          item.marketId === market.id
            ? {
                ...item,
                approved: !item.approved,
                approvedAt: !item.approved ? 'Just synced' : item.approvedAt,
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
  }

  function updateResolution(id: string, next: Partial<ResolutionItem>) {
    setResolutionQueue((current) =>
      current.map((item) => (item.id === id ? { ...item, ...next } : item)),
    )
  }

  function queueTrade(side: 'YES' | 'NO', shares = 100) {
    if (!selectedMarket) return
    setTradeIntents((current) => [makeTradeIntent(selectedMarket, side, shares), ...current].slice(0, 6))
  }

  return {
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
    toggleMarketSet,
    toggleMarketApproval,
    updateResolution,
    queueTrade,
    setSelectedMarketId,
  }
}
