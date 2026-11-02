import type { PnlSource } from './leaderboard.ts'
import { db, markDirty, memberKey } from './state.ts'
import type { Activity, OrderSource, PerpPosition, PerpSide } from './types.ts'
import { emit, fail, fetchJson, id, money, now } from './util.ts'

/* ------------------------------------------------------------------
 * Perpetual futures on stocks, crypto, indices and commodities.
 *
 * Data source: Polymarket's own perps venue publishes a public, keyless
 * info API at api.perpetuals.polymarket.com/v1/info (the same calls
 * polymarket.com/perps makes). We mirror its instrument list, mark prices,
 * hourly funding rates, taker fees and 24h hourly klines.
 *
 * Simulated here: fills happen at the mark price (no order book, no slippage,
 * market orders only), margin is isolated, funding accrues continuously from
 * the venue's hourly rate, and liquidation happens on our own price poll
 * (every few seconds) when position equity falls to maintenance margin.
 * ------------------------------------------------------------------ */

const PERPS_API = 'https://api.perpetuals.polymarket.com/v1/info'
const TICK_MS = 5_000
const STATS_MS = 60_000
const INSTRUMENTS_MS = 10 * 60_000
const HOUR = 3_600_000
const MAX_CLOSED = 20_000

export type PerpCategory = 'stocks' | 'crypto' | 'indices' | 'commodities' | 'pre-ipo'
export const PERP_CATEGORIES: PerpCategory[] = ['stocks', 'crypto', 'indices', 'commodities', 'pre-ipo']

const CATEGORY_MAP: Record<string, PerpCategory> = {
  equity: 'stocks', crypto: 'crypto', index: 'indices', commodity: 'commodities', pre_ipo: 'pre-ipo',
}

/** Polymarket's display names (the info API only has tickers). Unknown tickers fall back to the ticker. */
const NAMES: Record<string, string> = {
  AAPL: 'Apple', AAVE: 'Aave', ADA: 'Cardano', AMD: 'AMD', AMZN: 'Amazon', ANT: 'Anthropic', ARB: 'Arbitrum', ARM: 'Arm',
  ASML: 'ASML', AVAX: 'Avalanche', AVGO: 'Broadcom', BABA: 'Alibaba', BNB: 'BNB', BRENTOIL: 'Brent Oil', BTC: 'Bitcoin',
  CASHCAT: 'Cashcat', CBRS: 'Cerebras', COIN: 'Coinbase', CRCL: 'Circle', CRWV: 'CoreWeave', CXMT: 'CXMT', DELL: 'Dell',
  DOGE: 'Dogecoin', DRAM: 'DRAM', ENA: 'Ethena', ETH: 'Ethereum', ETHFI: 'ether.fi', EWY: 'iShares MSCI South Korea ETF',
  FARTCOIN: 'Fartcoin', GOLD: 'Gold', GOOGL: 'Alphabet', HOOD: 'Robinhood', HYPE: 'Hyperliquid', INTC: 'Intel', JUP: 'Jupiter',
  KAITO: 'Kaito', KPEPE: 'kPEPE', KSHIB: 'kSHIB', LDO: 'Lido', LINK: 'Chainlink', LIT: 'Lighter', LITE: 'Lumentum',
  LTC: 'Litecoin', META: 'Meta', MORPHO: 'Morpho', MRVL: 'Marvell', MSFT: 'Microsoft', MSTR: 'Strategy', MU: 'Micron',
  NBIS: 'Nebius', NCLD: 'Roundhill Neocloud ETF', NEAR: 'NEAR Protocol', NVDA: 'Nvidia', ONDO: 'Ondo', ORCL: 'Oracle',
  PENDLE: 'Pendle', PLTR: 'Palantir', PONS: 'Pons', PRL: 'PRL', PUMP: 'Pump.fun', QCOM: 'Qualcomm', RKLB: 'Rocket Lab',
  SAMSUNG: 'Samsung', SILVER: 'Silver', SKHY: 'SK Hynix', SKHYNIX: 'SK Hynix', SNDK: 'Sandisk', SOL: 'Solana',
  SOXL: 'Direxion Daily Semiconductor Bull 3X ETF', SPCX: 'SpaceX', STRC: 'STRC', SUI: 'Sui', TAO: 'Bittensor', TSLA: 'Tesla',
  TSM: 'TSMC', UNI: 'Uniswap', UNITREE: 'Unitree Robotics', US100: 'US100', USA500: 'USA500', USELESS: 'Useless Coin',
  VIRTUAL: 'Virtuals Protocol', VVV: 'Venice', WLD: 'Worldcoin', WTIOIL: 'WTI Oil', XMR: 'Monero', XPL: 'Plasma', XRP: 'XRP',
  ZEC: 'Zcash', ZM: 'Zoom', ZRO: 'LayerZero',
}

/** The instruments API has no logo for a few majors; polymarket.com uses these uploads instead. */
const S3 = 'https://polymarket-upload.s3.us-east-2.amazonaws.com'
const ICONS: Record<string, string> = {
  BTC: `${S3}/BTC+fullsize.png`, ETH: `${S3}/ETH+fullsize.jpg`, SOL: `${S3}/SOL+fullsize.png`,
  SPCX: `${S3}/spacex-ipo-closing-market-cap-eMcPLOPUo_Il.png`,
}

/** Shown first on the discover page, like polymarket.com/perps */
const FEATURED = ['BTC', 'ETH', 'USA500', 'GOLD', 'NVDA', 'ANT', 'SOL', 'TSLA']

export interface PerpAsset {
  instrumentId: number
  symbol: string
  /** the venue's own symbol, e.g. "SP500-USD" */
  venueSymbol: string
  name: string
  category: PerpCategory
  maxLeverage: number
  icon: string
  /** taker fee on notional, charged on open and close */
  feeRate: number
  /** maintenance margin as a fraction of notional */
  maintenanceRate: number
  price: number
  indexPrice: number
  open24h: number | null
  change24h: number | null
  /** 24h traded notional in dollars */
  volume24h: number
  /** in units of the underlying */
  openInterest: number
  /** funding per hour as a fraction of notional; positive = longs pay shorts */
  fundingRate: number
  nextFunding: number | null
  closeOnly: boolean
  /** hourly closes for the last 24h, oldest first */
  spark: number[]
  updatedAt: number
}

interface Instrument {
  instrument_id: number; symbol: string; display_symbol?: string; category: string; base_asset: string
  max_leverage: number; close_only: boolean; liquidation_fee: string; ui_live_time?: number
  logo?: { light?: string; dark?: string }
}
interface Ticker {
  instrument_id: number; symbol: string; index_price: string; mark_price: string; last_price: string
  open_interest: string; funding_rate: string; next_funding: number; timestamp: number
}
type Kline = [number, string, string, string, string, string, number]
interface Stat { instrument_id: number; symbol: string; volume: string; open_price: string; klines: Kline[] }
interface FeeSchedule { fee_schedule: { category: string; taker_fee_rate: string }[] }

export const perps = {
  assets: new Map<string, PerpAsset>(),
  byInstrument: new Map<number, string>(),
  syncedAt: 0,
  statsAt: 0,
  error: null as string | null,
}

/** Test hook (PERPS_TEST=1 only): fixed prices that the live poll will not overwrite. */
const overrides = new Map<string, number>()

const tickerOf = (i: Instrument) => (i.display_symbol || i.symbol).replace(/-USD$/, '').toUpperCase()
const num = (s: string | number | undefined | null) => (s === undefined || s === null || s === '' ? NaN : Number(s))

export function findAsset(symbol: string) {
  const s = String(symbol ?? '').trim().toUpperCase().replace(/-USD$/, '')
  const a = perps.assets.get(s) ?? [...perps.assets.values()].find((x) => x.venueSymbol.replace(/-USD$/, '') === s || String(x.instrumentId) === s)
  return a ?? fail(404, `Perp asset ${symbol} not found`)
}

async function syncInstruments() {
  const [list, fees] = await Promise.all([
    fetchJson<Instrument[]>(`${PERPS_API}/instruments`),
    fetchJson<FeeSchedule>(`${PERPS_API}/fees`).catch(() => null),
  ])
  const feeBy = new Map((fees?.fee_schedule ?? []).map((f) => [f.category, Number(f.taker_fee_rate)]))
  const seen = new Set<string>()
  for (const i of list) {
    if (i.ui_live_time && i.ui_live_time > now()) continue
    const symbol = tickerOf(i)
    seen.add(symbol)
    const prev = perps.assets.get(symbol)
    const maxLeverage = Math.max(1, Math.floor(i.max_leverage || 1))
    const asset: PerpAsset = {
      instrumentId: i.instrument_id,
      symbol,
      venueSymbol: i.symbol,
      name: NAMES[symbol] ?? NAMES[i.base_asset] ?? symbol,
      category: CATEGORY_MAP[i.category] ?? 'stocks',
      maxLeverage,
      icon: i.logo?.dark ?? i.logo?.light ?? ICONS[symbol] ?? '',
      feeRate: Number.isFinite(feeBy.get(i.category)) ? feeBy.get(i.category)! : 0.0004,
      // half the initial margin at max leverage (the same rule Hyperliquid uses)
      maintenanceRate: 1 / (2 * maxLeverage),
      price: prev?.price ?? 0,
      indexPrice: prev?.indexPrice ?? 0,
      open24h: prev?.open24h ?? null,
      change24h: prev?.change24h ?? null,
      volume24h: prev?.volume24h ?? 0,
      openInterest: prev?.openInterest ?? 0,
      fundingRate: prev?.fundingRate ?? 0,
      nextFunding: prev?.nextFunding ?? null,
      closeOnly: i.close_only,
      spark: prev?.spark ?? [],
      updatedAt: prev?.updatedAt ?? 0,
    }
    perps.assets.set(symbol, asset)
    perps.byInstrument.set(i.instrument_id, symbol)
  }
  for (const s of [...perps.assets.keys()]) if (!seen.has(s)) perps.assets.delete(s)
  perps.syncedAt = now()
}

async function syncTickers() {
  const list = await fetchJson<Ticker[]>(`${PERPS_API}/tickers`)
  for (const t of list) {
    const a = perps.assets.get(perps.byInstrument.get(t.instrument_id) ?? '')
    if (!a) continue
    const mark = num(t.mark_price)
    if (Number.isFinite(mark) && mark > 0 && !overrides.has(a.symbol)) a.price = mark
    a.indexPrice = num(t.index_price) || a.price
    a.openInterest = num(t.open_interest) || 0
    a.fundingRate = num(t.funding_rate) || 0
    a.nextFunding = t.next_funding ?? null
    a.updatedAt = t.timestamp ?? now()
    if (a.open24h) a.change24h = a.price / a.open24h - 1
  }
}

async function syncStats() {
  const list = await fetchJson<Stat[]>(`${PERPS_API}/statistics`)
  for (const s of list) {
    const a = perps.assets.get(perps.byInstrument.get(s.instrument_id) ?? '')
    if (!a) continue
    a.open24h = num(s.open_price) || null
    a.volume24h = (num(s.volume) || 0)
    a.spark = s.klines.map((k) => Number(k[4])).filter((x) => Number.isFinite(x))
    if (a.open24h && a.price) a.change24h = a.price / a.open24h - 1
  }
  perps.statsAt = now()
}

/** Make sure we have a catalog and prices (first request after boot, or tests). */
export async function ensurePerps() {
  if (!perps.assets.size || now() - perps.syncedAt > INSTRUMENTS_MS) await syncInstruments()
  if (![...perps.assets.values()].some((a) => a.price > 0)) await syncTickers()
  if (now() - perps.statsAt > STATS_MS) await syncStats().catch((err) => console.error('[perps] stats', err.message))
}

/* ---------------- history ---------------- */

const RANGES: Record<string, { interval: string; span: number }> = {
  '1h': { interval: '1m', span: HOUR },
  '6h': { interval: '5m', span: 6 * HOUR },
  '1d': { interval: '15m', span: 24 * HOUR },
  '1w': { interval: '1h', span: 7 * 24 * HOUR },
  '1m': { interval: '4h', span: 30 * 24 * HOUR },
}
const historyCache = new Map<string, { at: number; data: { t: number; p: number }[] }>()

/** Close prices from the venue's klines: [{ t (unix seconds), p }] */
export async function perpHistory(symbol: string, range = '1d') {
  const a = findAsset(symbol)
  const r = RANGES[range] ?? RANGES['1d']
  const key = `${a.symbol}:${range}`
  const hit = historyCache.get(key)
  if (hit && now() - hit.at < 30_000) return hit.data
  const end = now()
  const url = `${PERPS_API}/klines?instrument_id=${a.instrumentId}&interval=${r.interval}&start_timestamp=${end - r.span}&end_timestamp=${end}`
  let data: { t: number; p: number }[] = []
  try {
    const res = await fetchJson<{ data: Kline[] } | Kline[]>(url)
    const rows = Array.isArray(res) ? res : res.data
    data = rows.map((k) => ({ t: Math.floor(k[0] / 1000), p: Number(k[4]) })).filter((x) => Number.isFinite(x.p))
  } catch {
    // fall back to the 24 hourly closes we already have
    data = a.spark.map((p, i) => ({ t: Math.floor((end - (a.spark.length - i) * HOUR) / 1000), p }))
  }
  if (a.price) data.push({ t: Math.floor(end / 1000), p: a.price })
  historyCache.set(key, { at: now(), data })
  return data
}

/* ---------------- position math ---------------- */

/**
 * Isolated margin. Equity = margin + unrealized P&L - funding paid. A position
 * is liquidated when equity <= maintenanceRate × current notional.
 */
export function liquidationPrice(p: Pick<PerpPosition, 'side' | 'qty' | 'entryPrice' | 'margin' | 'funding'>, mmr: number) {
  const { qty, entryPrice: e, margin, funding } = p
  const liq = p.side === 'long'
    ? (qty * e - margin + funding) / (qty * (1 - mmr))
    : (margin + qty * e - funding) / (qty * (1 + mmr))
  return Math.max(0, liq)
}

export const upnlOf = (p: Pick<PerpPosition, 'side' | 'qty' | 'entryPrice'>, mark: number) =>
  (p.side === 'long' ? 1 : -1) * p.qty * (mark - p.entryPrice)

function markOf(p: PerpPosition) {
  return perps.assets.get(p.symbol)?.price || p.entryPrice
}

export function serializePerp(p: PerpPosition) {
  const a = perps.assets.get(p.symbol)
  const mark = p.status === 'open' ? markOf(p) : (p.exitPrice ?? p.entryPrice)
  const upnl = p.status === 'open' ? upnlOf(p, mark) : 0
  const equity = p.status === 'open' ? p.margin + upnl - p.funding : 0
  return {
    id: p.id,
    leagueId: p.leagueId,
    userId: p.userId,
    symbol: p.symbol,
    name: a?.name ?? p.symbol,
    icon: a?.icon ?? '',
    category: a?.category ?? null,
    side: p.side,
    leverage: p.leverage,
    qty: p.qty,
    notional: money(p.qty * p.entryPrice),
    markNotional: money(p.qty * mark),
    margin: money(p.margin),
    entryPrice: p.entryPrice,
    markPrice: mark,
    liquidationPrice: p.liqPrice,
    takeProfit: p.takeProfit ?? null,
    stopLoss: p.stopLoss ?? null,
    funding: money(p.funding),
    fees: money(p.fees),
    unrealizedPnl: money(upnl),
    /** P&L net of funding (open) or of funding and fees (closed) */
    pnl: p.status === 'open' ? money(upnl - p.funding) : money(p.realized ?? 0),
    pnlPct: p.margin > 0 ? (p.status === 'open' ? (upnl - p.funding) / p.margin : (p.realized ?? 0) / p.margin) : 0,
    equity: money(equity),
    status: p.status,
    closeReason: p.closeReason ?? null,
    exitPrice: p.exitPrice ?? null,
    openedAt: p.openedAt,
    closedAt: p.closedAt ?? null,
    source: p.source,
  }
}

/** Sum of open perp equity (margin + uPnL - funding) for portfolio() and leaderboard(). */
export function perpSummary(leagueId: string, userId: string) {
  const open = []
  let equity = 0
  let realized = 0
  for (const p of db.perps.values()) {
    if (p.leagueId !== leagueId || p.userId !== userId) continue
    if (p.status === 'open') {
      const s = serializePerp(p)
      equity += Math.max(0, s.equity)
      open.push(s)
    } else realized += p.realized ?? 0
  }
  open.sort((a, b) => b.openedAt - a.openedAt)
  return { equity: money(equity), realized: money(realized), positions: open }
}

function logPerp(leagueId: string, userId: string, text: string) {
  const a: Activity = { id: id('act'), leagueId, userId, kind: 'trade', text, ts: now() }
  db.activity.push(a)
  emit({ type: 'activity', leagueId, data: a })
}

const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`

/** Close at `price`. Returns margin + P&L - funding - fee to the member's cash (never below zero). */
function settle(p: PerpPosition, price: number, reason: NonNullable<PerpPosition['closeReason']>) {
  const a = perps.assets.get(p.symbol)
  const member = db.members.get(memberKey(p.leagueId, p.userId))
  const upnl = upnlOf(p, price)
  let fee = reason === 'liquidation' ? 0 : p.qty * price * (a?.feeRate ?? 0.0004)
  let payout = p.margin + upnl - p.funding - fee
  if (reason === 'liquidation') payout = 0
  if (payout < 0) {
    // the fee comes out of what is left; a gap through the liquidation price loses the margin, never more
    fee = Math.max(0, fee + payout)
    payout = 0
  }
  p.fees += fee
  p.status = reason === 'liquidation' ? 'liquidated' : 'closed'
  p.closeReason = reason
  p.exitPrice = price
  p.closedAt = now()
  // realized = what came back minus margin and the opening fee
  p.realized = money(payout - p.margin - p.openFee)
  if (member) member.cash = money(member.cash + payout)
  markDirty()
  emit({ type: 'portfolio', leagueId: p.leagueId, userId: p.userId })
  const name = db.users.get(p.userId)?.displayName ?? 'Someone'
  const verb = reason === 'liquidation' ? 'got liquidated on' : reason === 'tp' ? 'took profit on' : reason === 'sl' ? 'stopped out of' : 'closed'
  logPerp(p.leagueId, p.userId, `${name} ${verb} a ${p.leverage}x ${p.side} ${p.symbol} perp (${p.realized >= 0 ? '+' : '-'}${fmtUsd(Math.abs(p.realized))})`)
  return payout
}

/* ---------------- price loop: funding, TP/SL, liquidation ---------------- */

export function processTick(t = now()) {
  for (const p of db.perps.values()) {
    if (p.status !== 'open') continue
    const a = perps.assets.get(p.symbol)
    if (!a || !a.price) continue
    const mark = a.price
    const dt = Math.max(0, t - p.lastFundingAt)
    if (dt > 0) {
      // longs pay a positive rate, shorts receive it
      p.funding += (p.side === 'long' ? 1 : -1) * a.fundingRate * p.qty * mark * (dt / HOUR)
      p.lastFundingAt = t
      p.liqPrice = liquidationPrice(p, a.maintenanceRate)
    }
    const long = p.side === 'long'
    const equity = p.margin + upnlOf(p, mark) - p.funding
    if (equity <= a.maintenanceRate * p.qty * mark) settle(p, mark, 'liquidation')
    else if (p.takeProfit && (long ? mark >= p.takeProfit : mark <= p.takeProfit)) settle(p, mark, 'tp')
    else if (p.stopLoss && (long ? mark <= p.stopLoss : mark >= p.stopLoss)) settle(p, mark, 'sl')
  }
  pruneClosed()
}

function pruneClosed() {
  if (db.perps.size <= MAX_CLOSED) return
  const closed = [...db.perps.values()].filter((p) => p.status !== 'open').sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))
  for (const p of closed.slice(0, db.perps.size - MAX_CLOSED)) db.perps.delete(p.id)
}

export function startPerps() {
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      if (!perps.assets.size || now() - perps.syncedAt > INSTRUMENTS_MS) await syncInstruments()
      await syncTickers()
      if (now() - perps.statsAt > STATS_MS) await syncStats()
      perps.error = null
    } catch (err) {
      perps.error = (err as Error).message
      console.error('[perps]', perps.error)
    } finally {
      busy = false
    }
    processTick()
  }
  void tick()
  setInterval(tick, TICK_MS).unref()
}

/* ---------------- public API (REST, MCP and scripts share this) ---------------- */

export function serializeAsset(a: PerpAsset, opts: { history?: boolean } = {}) {
  return {
    symbol: a.symbol,
    name: a.name,
    category: a.category,
    icon: a.icon,
    maxLeverage: a.maxLeverage,
    price: a.price,
    indexPrice: a.indexPrice,
    change24h: a.change24h,
    changeUsd24h: a.open24h ? a.price - a.open24h : null,
    volume24h: a.volume24h,
    openInterest: a.openInterest,
    fundingRate: a.fundingRate,
    nextFunding: a.nextFunding,
    feeRate: a.feeRate,
    maintenanceRate: a.maintenanceRate,
    closeOnly: a.closeOnly,
    featured: FEATURED.includes(a.symbol),
    spark: opts.history === false ? undefined : [...a.spark, a.price].filter(Boolean),
    updatedAt: a.updatedAt,
  }
}

export async function listPerpAssets(opts: { category?: string; q?: string; sort?: string; limit?: number } = {}) {
  await ensurePerps()
  let list = [...perps.assets.values()].filter((a) => a.price > 0)
  if (opts.category && opts.category !== 'all') list = list.filter((a) => a.category === opts.category)
  if (opts.q) {
    const q = opts.q.toLowerCase()
    list = list.filter((a) => a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
  }
  const by: Record<string, (a: PerpAsset, b: PerpAsset) => number> = {
    volume: (a, b) => b.volume24h - a.volume24h,
    gainers: (a, b) => (b.change24h ?? 0) - (a.change24h ?? 0),
    losers: (a, b) => (a.change24h ?? 0) - (b.change24h ?? 0),
    name: (a, b) => a.symbol.localeCompare(b.symbol),
  }
  if (opts.sort && by[opts.sort]) list.sort(by[opts.sort])
  else list.sort((a, b) => a.instrumentId - b.instrumentId)
  if (opts.limit) list = list.slice(0, Math.max(1, opts.limit))
  return list.map((a) => serializeAsset(a))
}

export async function getPerpAsset(symbol: string, range = '1d') {
  await ensurePerps()
  const a = findAsset(symbol)
  return { ...serializeAsset(a), history: await perpHistory(a.symbol, range) }
}

export interface OpenPerpInput {
  leagueId?: string
  symbol: string
  side: PerpSide
  /** position size in dollars of notional; margin = amount / leverage */
  amount?: number
  /** alternatively, collateral in dollars; notional = margin × leverage */
  margin?: number
  leverage?: number
  takeProfit?: number | null
  stopLoss?: number | null
}

export function perpsApi(userId: string, source: OrderSource) {
  const resolve = (leagueId?: string) => {
    if (!leagueId) {
      const first = [...db.members.values()].find((m) => m.userId === userId)
      if (!first) fail(400, 'You are not in any league yet. Create or join one first.')
      leagueId = first!.leagueId
    }
    const league = db.leagues.get(leagueId) ?? fail(404, `League ${leagueId} not found`)
    const member = db.members.get(memberKey(league.id, userId)) ?? fail(403, 'You are not a member of this league')
    return { league, member }
  }

  return {
    async open(input: OpenPerpInput) {
      const { league, member } = resolve(input.leagueId)
      await ensurePerps()
      const a = findAsset(input.symbol)
      if (a.closeOnly) fail(400, `${a.symbol} is close-only right now`)
      if (!a.price) fail(503, `No price for ${a.symbol} yet. Try again in a few seconds.`)
      const side = input.side
      if (side !== 'long' && side !== 'short') fail(400, 'side must be "long" or "short"')
      const leverage = Number(input.leverage ?? 1)
      if (!Number.isFinite(leverage) || leverage < 1 || leverage > a.maxLeverage) fail(400, `Leverage must be between 1 and ${a.maxLeverage}x for ${a.symbol}`)
      let notional = Number(input.amount ?? NaN)
      if (!Number.isFinite(notional) && input.margin !== undefined) notional = Number(input.margin) * leverage
      if (!Number.isFinite(notional) || notional < 1) fail(400, 'Give amount (position size in $, at least $1) or margin')
      const price = a.price
      const margin = money(notional / leverage)
      const fee = money(notional * a.feeRate)
      if (margin + fee > member.cash + 1e-9) fail(400, `Not enough cash: need ${fmtUsd(margin + fee)} (margin ${fmtUsd(margin)} + fee ${fmtUsd(fee)}), have ${fmtUsd(member.cash)}`)
      const qty = notional / price
      const tp = input.takeProfit ? Number(input.takeProfit) : undefined
      const sl = input.stopLoss ? Number(input.stopLoss) : undefined
      const long = side === 'long'
      if (tp !== undefined && (!(tp > 0) || (long ? tp <= price : tp >= price))) fail(400, `Take profit must be ${long ? 'above' : 'below'} the current price (${price})`)
      if (sl !== undefined && (!(sl > 0) || (long ? sl >= price : sl <= price))) fail(400, `Stop loss must be ${long ? 'below' : 'above'} the current price (${price})`)
      const p: PerpPosition = {
        id: id('perp'), leagueId: league.id, userId, symbol: a.symbol, side, leverage, qty, entryPrice: price, margin,
        liqPrice: 0, takeProfit: tp, stopLoss: sl, funding: 0, fees: fee, openFee: fee, status: 'open', source,
        openedAt: now(), lastFundingAt: now(),
      }
      p.liqPrice = liquidationPrice(p, a.maintenanceRate)
      if (sl !== undefined && (long ? sl <= p.liqPrice : sl >= p.liqPrice)) fail(400, `Stop loss is past the liquidation price (${p.liqPrice.toPrecision(6)})`)
      member.cash = money(member.cash - margin - fee)
      db.perps.set(p.id, p)
      markDirty()
      emit({ type: 'portfolio', leagueId: league.id, userId })
      const name = db.users.get(userId)?.displayName ?? 'Someone'
      logPerp(league.id, userId, `${name} opened a ${leverage}x ${side} on ${a.symbol} (${fmtUsd(notional)})`)
      return { position: serializePerp(p), cash: member.cash }
    },

    close(positionId: string) {
      const p = db.perps.get(positionId)
      if (!p || p.userId !== userId) fail(404, 'Position not found')
      if (p!.status !== 'open') fail(400, `Position is already ${p!.status}`)
      resolve(p!.leagueId)
      const payout = settle(p!, markOf(p!), 'manual')
      return { position: serializePerp(p!), payout: money(payout), cash: db.members.get(memberKey(p!.leagueId, userId))?.cash ?? 0 }
    },

    update(positionId: string, patch: { takeProfit?: number | null; stopLoss?: number | null }) {
      const p = db.perps.get(positionId)
      if (!p || p.userId !== userId || p.status !== 'open') fail(404, 'Open position not found')
      const mark = markOf(p!)
      const long = p!.side === 'long'
      if (patch.takeProfit !== undefined) {
        const tp = patch.takeProfit ? Number(patch.takeProfit) : undefined
        if (tp !== undefined && (long ? tp <= mark : tp >= mark)) fail(400, `Take profit must be ${long ? 'above' : 'below'} ${mark}`)
        p!.takeProfit = tp
      }
      if (patch.stopLoss !== undefined) {
        const sl = patch.stopLoss ? Number(patch.stopLoss) : undefined
        if (sl !== undefined && (long ? sl >= mark : sl <= mark)) fail(400, `Stop loss must be ${long ? 'below' : 'above'} ${mark}`)
        p!.stopLoss = sl
      }
      markDirty()
      return serializePerp(p!)
    },

    list(leagueId?: string, status: 'open' | 'closed' | 'all' = 'open') {
      const { league } = resolve(leagueId)
      const rows = [...db.perps.values()]
        .filter((p) => p.leagueId === league.id && p.userId === userId)
        .filter((p) => status === 'all' || (status === 'open' ? p.status === 'open' : p.status !== 'open'))
        .sort((a, b) => (b.closedAt ?? b.openedAt) - (a.closedAt ?? a.openedAt))
        .slice(0, 200)
        .map(serializePerp)
      const s = perpSummary(league.id, userId)
      return { leagueId: league.id, equity: s.equity, realized: s.realized, positions: rows }
    },
  }
}

/** Test-only price override, so tests can drive liquidations and TP/SL deterministically. */
export function setTestPrice(symbol: string, price: number | null) {
  const a = findAsset(symbol)
  if (price === null) overrides.delete(a.symbol)
  else {
    if (!(price > 0)) fail(400, 'price must be > 0')
    overrides.set(a.symbol, price)
    a.price = price
  }
  processTick()
  return serializeAsset(a, { history: false })
}

/** League housekeeping: drop perps for a member who leaves or a league that resets. */
export function clearPerps(leagueId: string, userId?: string) {
  for (const [k, p] of db.perps) if (p.leagueId === leagueId && (!userId || p.userId === userId)) db.perps.delete(k)
}

/** Perp P&L for the league leaderboard: realized on positions closed since `since`, plus open positions marked to market (net of funding and fees). */
export const perpPnlSource: PnlSource = {
  key: 'perps',
  label: 'Perps',
  member(league, userId, since) {
    let pnl = 0, volume = 0, trades = 0
    for (const p of db.perps.values()) {
      if (p.leagueId !== league.id || p.userId !== userId) continue
      if (p.openedAt >= since) { volume += p.qty * p.entryPrice; trades++ }
      if (p.status === 'open') {
        pnl += serializePerp(p).equity - p.margin - p.openFee
      } else if ((p.closedAt ?? 0) >= since) {
        pnl += p.realized ?? 0
        volume += p.qty * (p.exitPrice ?? p.entryPrice)
        trades++
      }
    }
    return { pnl: money(pnl), volume: money(volume), trades }
  },
}
