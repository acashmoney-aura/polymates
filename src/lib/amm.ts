export type TradePreview = {
  entryPrice: number
  exitPriceEstimate: number
  cost: number
  averagePrice: number
  maxPayout: number
  maxProfit: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export function estimateBinaryTrade(params: {
  currentYesPrice: number
  shares: number
  side: 'YES' | 'NO'
  liquidity?: number
}): TradePreview {
  const { currentYesPrice, shares, side, liquidity = 1600 } = params
  const startingPrice = clamp(currentYesPrice / 100, 0.01, 0.99)
  const signedDemand = shares / liquidity
  const direction = side === 'YES' ? 1 : -1
  const adjustedPrice = clamp(startingPrice + direction * signedDemand * 0.22, 0.01, 0.99)

  const averagePrice = (startingPrice + adjustedPrice) / 2
  const cost = shares * averagePrice
  const payout = shares
  const profit = side === 'YES' ? payout - cost : shares - cost

  return {
    entryPrice: Number((startingPrice * 100).toFixed(1)),
    exitPriceEstimate: Number((adjustedPrice * 100).toFixed(1)),
    cost: Number(cost.toFixed(2)),
    averagePrice: Number(averagePrice.toFixed(4)),
    maxPayout: Number(payout.toFixed(2)),
    maxProfit: Number(profit.toFixed(2)),
  }
}
