import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, compactUsd } from '../api'
import { AssetIcon, changeClass, PerpPositions, PerpTradePanel, Sparkline, StarButton } from '../components/PerpTrade'
import { LiveChart } from '../components/LiveChart'
import { Flash } from '../components/Motion'
import { usePerpMark } from '../live'
import { Empty, Spinner } from '../components/ui'
import { Icon } from '../icons'
import {
  fmtPct, fmtPrice, fmtSignedPrice, PERP_TABS, usePerpAsset, usePerpAssets, useWatchlist, type PerpAsset, type PerpPosition,
} from '../perps'
import { Link, navigate, useLocation, useTitle } from '../router'
import { useApp, useStream } from '../store'

const FEATURED = ['ANT', 'BTC', 'USA500', 'GOLD', 'NVDA', 'ETH', 'SOL', 'TSLA']

function FeaturedCard({ a, starred, onStar }: { a: PerpAsset; starred: boolean; onStar: () => void }) {
  const up = (a.change24h ?? 0) >= 0
  return (
    <Link to={`/perps/${a.symbol}`} className="perp-feat">
      <div className="perp-feat-head">
        <span><b>{a.symbol}</b><small>{a.name}</small></span>
        <StarButton on={starred} onToggle={onStar} label={a.symbol} />
      </div>
      <div className="perp-feat-spark"><Sparkline values={a.spark ?? []} up={up} width={200} height={84} fill /></div>
      <div className="perp-feat-foot">
        <b className="tabular">{fmtPrice(a.price)}</b>
        <span className={`tabular ${changeClass(a.change24h)}`}>{fmtPct(a.change24h)}</span>
        <span className="grow" />
        <span className="perp-lev-badge">{a.maxLeverage}X</span>
      </div>
    </Link>
  )
}

function MoverRow({ a }: { a: PerpAsset }) {
  return (
    <Link to={`/perps/${a.symbol}`} className="perp-mover">
      <AssetIcon asset={a} size={36} />
      <span className="perp-mover-name"><b>{a.symbol}</b><small className="ellipsis">{a.name}</small></span>
      <span className="perp-mover-spark"><Sparkline values={a.spark ?? []} up={(a.change24h ?? 0) >= 0} width={80} height={28} /></span>
      <span className="perp-mover-px tabular">
        <b>{fmtPrice(a.price)}</b>
        <small className={changeClass(a.change24h)}>{fmtSignedPrice(a.changeUsd24h)} ({fmtPct(Math.abs(a.change24h ?? 0)).replace('+', '')})</small>
      </span>
    </Link>
  )
}

function AssetTable({ assets, watch }: { assets: PerpAsset[]; watch: ReturnType<typeof useWatchlist> }) {
  const [sort, setSort] = useState<'volume' | 'change' | 'name'>('volume')
  const rows = useMemo(() => {
    const r = [...assets]
    if (sort === 'volume') r.sort((a, b) => b.volume24h - a.volume24h)
    if (sort === 'change') r.sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))
    if (sort === 'name') r.sort((a, b) => a.symbol.localeCompare(b.symbol))
    return r
  }, [assets, sort])
  return (
    <div className="perp-table">
      <div className="perp-table-head">
        <button onClick={() => setSort('name')} className={sort === 'name' ? 'active' : ''}>Asset</button>
        <span className="hide-sm">24h</span>
        <span>Price</span>
        <button onClick={() => setSort('change')} className={sort === 'change' ? 'active' : ''}>24h %</button>
        <button onClick={() => setSort('volume')} className={`hide-sm ${sort === 'volume' ? 'active' : ''}`}>Volume</button>
        <span className="hide-sm">Max</span>
        <span />
      </div>
      {rows.map((a) => (
        <Link key={a.symbol} to={`/perps/${a.symbol}`} className="perp-table-row">
          <span className="perp-mover-name with-icon"><AssetIcon asset={a} size={32} /><span><b>{a.symbol}</b><small className="ellipsis">{a.name}</small></span></span>
          <span className="hide-sm"><Sparkline values={a.spark ?? []} up={(a.change24h ?? 0) >= 0} width={90} height={28} /></span>
          <span className="tabular"><b>{fmtPrice(a.price)}</b></span>
          <span className={`tabular ${changeClass(a.change24h)}`}>{fmtPct(a.change24h)}</span>
          <span className="hide-sm tabular muted">{compactUsd(a.volume24h)}</span>
          <span className="hide-sm"><span className="perp-lev-badge">{a.maxLeverage}X</span></span>
          <span><StarButton on={watch.has(a.symbol)} onToggle={() => watch.toggle(a.symbol)} label={a.symbol} /></span>
        </Link>
      ))}
    </div>
  )
}

export function PerpsPage() {
  const { query } = useLocation()
  const tab = query.get('tab') ?? 'discover'
  const { assets, error } = usePerpAssets()
  const watch = useWatchlist()
  const [q, setQ] = useState('')
  useTitle('Perps')

  const featured = useMemo(() => {
    if (!assets) return []
    const by = new Map(assets.map((a) => [a.symbol, a]))
    return FEATURED.map((s) => by.get(s)).filter((a): a is PerpAsset => Boolean(a)).slice(0, 5)
  }, [assets])
  const movers = useMemo(() => {
    const list = (assets ?? []).filter((a) => a.change24h !== null)
    const sorted = [...list].sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))
    return { gainers: sorted.slice(0, 6), losers: sorted.slice(-6).reverse() }
  }, [assets])

  const current = PERP_TABS.find((t) => t.key === tab) ?? PERP_TABS[0]
  const filtered = (assets ?? [])
    .filter((a) => (current.category ? a.category === current.category : tab === 'watchlist' ? watch.has(a.symbol) : true))
    .filter((a) => !q || a.symbol.toLowerCase().includes(q.toLowerCase()) || a.name.toLowerCase().includes(q.toLowerCase()))
  const counts = (key: string) => {
    const t = PERP_TABS.find((x) => x.key === key)
    if (!assets || !t) return null
    if (t.category) return assets.filter((a) => a.category === t.category).length
    if (key === 'watchlist') return watch.list.length
    if (key === 'all') return assets.length
    return null
  }

  return (
    <div className="wrap page perps-page">
      <div className="perps-head">
        <div>
          <h1>Perps</h1>
          <p className="muted">Trade stocks, crypto, indices, and commodities 24/7 with up to 50x leverage</p>
        </div>
        <label className="search small-search perps-search"><Icon name="search" size={16} /><input value={q} placeholder="Search assets" aria-label="Search perp assets"
          onChange={(e) => { setQ(e.target.value); if (tab === 'discover' && e.target.value) navigate('/perps?tab=all', { replace: true }) }} /></label>
      </div>
      <nav className="perps-tabs" aria-label="Perp categories">
        {PERP_TABS.filter((t) => t.key !== 'pre-ipo' || (counts('pre-ipo') ?? 0) > 0).map((t) => (
          <Link key={t.key} to={t.key === 'discover' ? '/perps' : `/perps?tab=${t.key}`} className={tab === t.key ? 'active' : ''}>
            {t.label}{counts(t.key) !== null && <small>{counts(t.key)}</small>}
          </Link>
        ))}
      </nav>

      {!assets ? (error ? <Empty title="Perps are unavailable">{error}</Empty> : <Spinner />) : tab === 'discover' ? (
        <>
          <h2 className="perps-h2">Featured</h2>
          <div className="perp-featured">
            {featured.map((a) => <FeaturedCard key={a.symbol} a={a} starred={watch.has(a.symbol)} onStar={() => watch.toggle(a.symbol)} />)}
          </div>
          <div className="perp-movers">
            <section>
              <div className="perps-h2-row"><h2 className="perps-h2">Top gainers</h2><Link to="/perps?tab=all" className="muted small">View all</Link></div>
              {movers.gainers.map((a) => <MoverRow key={a.symbol} a={a} />)}
            </section>
            <section>
              <div className="perps-h2-row"><h2 className="perps-h2">Top losers</h2><Link to="/perps?tab=all" className="muted small">View all</Link></div>
              {movers.losers.map((a) => <MoverRow key={a.symbol} a={a} />)}
            </section>
          </div>
          <div className="perps-about card">
            <h2 className="perps-h2">About Perps</h2>
            <p className="muted small">Perpetual futures let you go long or short with leverage and no expiry. Prices, funding rates and fees are mirrored live from Polymarket Perps; your league's fantasy cash is the margin. Positions use isolated margin: if the price moves against you far enough to reach the liquidation price, you lose that position's margin and nothing more.</p>
          </div>
        </>
      ) : !filtered.length ? (
        <Empty title={tab === 'watchlist' ? 'Your watchlist is empty' : 'No assets match'}>{tab === 'watchlist' ? 'Tap the star on any asset to add it here.' : null}</Empty>
      ) : (
        <AssetTable assets={filtered} watch={watch} />
      )}
    </div>
  )
}

const RANGES = ['1h', '6h', '1d', '1w', '1m'] as const

export function PerpAssetPage({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>('1d')
  const { asset, error } = usePerpAsset(symbol, range)
  const { leagueId, user, refreshPortfolio } = useApp()
  const watch = useWatchlist()
  const mark = usePerpMark(symbol)
  const [positions, setPositions] = useState<PerpPosition[] | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  useTitle(asset ? `${fmtPrice(mark?.price ?? asset.price)} ${asset.symbol}` : symbol.toUpperCase())

  const loadPositions = useCallback(() => {
    if (!leagueId || !user) return
    api<{ positions: PerpPosition[] }>(`/api/leagues/${leagueId}/perps?status=all`)
      .then((r) => {
        setPositions(r.positions.filter((p) => p.symbol === symbol.toUpperCase()))
        // keep the header's portfolio value moving with unrealized perp P&L
        if (r.positions.some((p) => p.status === 'open')) void refreshPortfolio()
      })
      .catch(() => setPositions([]))
  }, [leagueId, user, symbol, refreshPortfolio])
  useEffect(() => {
    loadPositions()
    const t = setInterval(loadPositions, 5000)
    return () => clearInterval(t)
  }, [loadPositions])
  useStream((e) => e.type === 'portfolio', loadPositions)

  if (!asset) {
    return <div className="wrap page">{error ? <Empty title="Asset not found">{error} <Link to="/perps">Back to Perps</Link></Empty> : <Spinner />}</div>
  }
  const hist = asset.history
  // the pushed mark is newer than the polled asset, so price everything off it
  const price = mark?.price ?? asset.price
  const liveAsset = price === asset.price ? asset : { ...asset, price }
  const first = hist[0]?.p
  const rangeChange = first ? price / first - 1 : null
  const up = (rangeChange ?? 0) >= 0
  const open = (positions ?? []).filter((p) => p.status === 'open')
  const closed = (positions ?? []).filter((p) => p.status !== 'open')

  return (
    <div className="wrap page perp-asset-page">
      <div className="perp-asset-main">
        <Link to="/perps" className="perp-back muted small"><Icon name="chevronLeft" size={14} /> Perps</Link>
        <div className="perp-asset-head">
          <AssetIcon asset={asset} size={48} />
          <div className="grow">
            <h1>{asset.symbol} <span className="perp-lev-badge">{asset.maxLeverage}X</span></h1>
            <span className="muted">{asset.name} · {asset.category === 'pre-ipo' ? 'Pre-IPO' : asset.category[0].toUpperCase() + asset.category.slice(1)}</span>
          </div>
          <StarButton on={watch.has(asset.symbol)} onToggle={() => watch.toggle(asset.symbol)} label={asset.symbol} />
        </div>
        <div className="perp-price-row">
          <Flash value={price}><b className="tabular">{fmtPrice(price)}</b></Flash>
          <span className={`tabular ${up ? 'yes-accent' : 'no-color'}`}>{fmtPct(rangeChange)} <small className="muted">{range.toUpperCase()}</small></span>
        </div>
        <div className="perp-chart card">
          <LiveChart points={hist} live={mark} rangeKey={`${asset.symbol}:${range}`} height={300} format={fmtPrice} />
          <div className="perp-ranges">
            {RANGES.map((r) => <button key={r} className={r === range ? 'active' : ''} onClick={() => setRange(r)}>{r.toUpperCase()}</button>)}
          </div>
        </div>
        <div className="perp-stats">
          <div><span>24h change</span><b className={changeClass(asset.change24h)}>{fmtPct(asset.change24h)}</b></div>
          <div><span>24h volume</span><b>{compactUsd(asset.volume24h)}</b></div>
          <div><span>Open interest</span><b>{compactUsd(asset.openInterest * asset.price)}</b></div>
          <div><span>Funding / 1h</span><b className={asset.fundingRate >= 0 ? 'yes-accent' : 'no-color'}>{fmtPct(asset.fundingRate, 4)}</b></div>
          <div><span>Index price</span><b>{fmtPrice(asset.indexPrice)}</b></div>
          <div><span>Max leverage</span><b>{asset.maxLeverage}x</b></div>
        </div>

        <div className="perp-mobile-trade"><PerpTradePanel asset={liveAsset} onDone={loadPositions} /></div>

        <div className="text-tabs big">
          <button className={!showClosed ? 'active' : ''} onClick={() => setShowClosed(false)}>Positions {open.length ? `(${open.length})` : ''}</button>
          <button className={showClosed ? 'active' : ''} onClick={() => setShowClosed(true)}>History</button>
        </div>
        {!user || !leagueId ? (
          <p className="muted small">Join a league to trade perps with your league's fantasy cash.</p>
        ) : !positions ? <Spinner /> : (showClosed ? closed : open).length ? (
          <PerpPositions positions={showClosed ? closed : open} onChange={loadPositions} showAsset={false} />
        ) : (
          <p className="muted small">{showClosed ? 'No closed positions yet.' : `No open ${asset.symbol} positions.`}</p>
        )}
      </div>
      <aside className="perp-asset-aside"><PerpTradePanel asset={liveAsset} onDone={loadPositions} /></aside>
    </div>
  )
}
