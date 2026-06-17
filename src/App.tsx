import './App.css'
import { useMemo, useState } from 'react'
import logoMark from '/polymates-mark.svg'
import {
  activityFeed,
  leagueConfig,
  leagueMembers,
  marketSets,
  positions,
} from './lib/mock-data'
import { useLeagueRuntime } from './lib/league-runtime'
import { productSpec } from './lib/product-spec'
import { describeRuntimeMode, hasSupabaseEnv } from './lib/supabase'
import { fetchPolymarketAccountPositions } from './lib/polymarket'
import type { Market, PolymarketAccountPosition, ResolutionItem } from './lib/types'

type AppView = 'dashboard' | 'markets' | 'portfolio' | 'league' | 'admin' | 'connected'

const navItems: { id: AppView; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'D' },
  { id: 'markets', label: 'Markets', icon: 'M' },
  { id: 'portfolio', label: 'Portfolio', icon: 'P' },
  { id: 'league', label: 'League', icon: 'L' },
  { id: 'connected', label: 'Connected', icon: 'C' },
  { id: 'admin', label: 'Admin', icon: 'A' },
]

const upcomingMatches = [
  { home: 'Brazil', away: 'Morocco', group: 'Group F', time: 'Today 3:00 PM ET', yes: 62, no: 40, volume: '$12,430' },
  { home: 'USA', away: 'Paraguay', group: 'Group B', time: 'Today 6:00 PM ET', yes: 58, no: 45, volume: '$8,210' },
  { home: 'Spain', away: 'Japan', group: 'Group E', time: 'Tomorrow 9:00 AM ET', yes: 66, no: 38, volume: '$6,430' },
]

const friendActivity = [
  { user: 'Akash', action: 'bought YES on USA to advance', amount: '$250.00', time: '2m ago', side: 'up' },
  { user: 'Maya', action: 'sold Brazil champion shares', amount: '$300.00', time: '15m ago', side: 'down' },
  { user: 'Ben', action: 'bought NO on Spain win vs Japan', amount: '$150.00', time: '27m ago', side: 'up' },
  { user: 'Priya', action: 'bought YES on Morocco to advance', amount: '$200.00', time: '1h ago', side: 'up' },
]

const leagueRules = [
  '$10,000 fantasy starting balance',
  '$2,000 weekly bonus',
  'YES / NO simulated prediction markets',
  'Markets close at kickoff or event lock',
  'Leaderboard by fantasy portfolio value',
  'No deposits, withdrawals, or cash prizes',
]

const chartPoints = '0,82 52,78 104,70 156,75 208,62 260,66 312,55 364,58 416,48 468,52 520,37 572,42 624,29 676,34 728,23 780,31 832,18'

function money(value: number) {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

function priceLabel(value?: number) {
  return ((value ?? 0) / 100).toFixed(2)
}

function statusClass(status: string) {
  return status.toLowerCase().replace(/\s+/g, '-')
}

function memberDelta(index: number) {
  const deltas = ['+9.31%', '+8.72%', '+6.21%', '+4.17%', '+3.02%', '-1.12%']
  return deltas[index] ?? '+1.90%'
}

function MiniChart() {
  return (
    <svg className="line-chart" viewBox="0 0 832 120" role="img" aria-label="Portfolio trend chart">
      <defs>
        <linearGradient id="portfolioFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(34, 197, 94, 0.42)" />
          <stop offset="100%" stopColor="rgba(34, 197, 94, 0.02)" />
        </linearGradient>
      </defs>
      <path d={`M ${chartPoints} L 832 120 L 0 120 Z`} fill="url(#portfolioFill)" />
      <polyline points={chartPoints} fill="none" stroke="#2ef27c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <g className="chart-grid">
        <line x1="0" x2="832" y1="28" y2="28" />
        <line x1="0" x2="832" y1="64" y2="64" />
        <line x1="0" x2="832" y1="100" y2="100" />
      </g>
    </svg>
  )
}

function MarketPriceChart({ market }: { market?: Market }) {
  return (
    <svg className="market-chart" viewBox="0 0 900 260" role="img" aria-label="YES and NO market price chart">
      <defs>
        <linearGradient id="yesFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(34, 197, 94, 0.34)" />
          <stop offset="100%" stopColor="rgba(34, 197, 94, 0.02)" />
        </linearGradient>
        <linearGradient id="noFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(248, 113, 113, 0.2)" />
          <stop offset="100%" stopColor="rgba(248, 113, 113, 0.02)" />
        </linearGradient>
      </defs>
      <g className="chart-grid">
        <line x1="0" x2="900" y1="50" y2="50" />
        <line x1="0" x2="900" y1="120" y2="120" />
        <line x1="0" x2="900" y1="190" y2="190" />
      </g>
      <path d="M0 160 C90 142 120 108 210 126 C320 150 360 88 465 106 C560 124 600 74 710 62 C800 50 830 88 900 72 L900 260 L0 260 Z" fill="url(#yesFill)" />
      <path d="M0 172 C80 192 140 154 240 166 C330 178 390 134 500 144 C590 154 650 190 760 172 C825 160 860 156 900 146 L900 260 L0 260 Z" fill="url(#noFill)" />
      <path d="M0 160 C90 142 120 108 210 126 C320 150 360 88 465 106 C560 124 600 74 710 62 C800 50 830 88 900 72" fill="none" stroke="#22c55e" strokeWidth="4" />
      <path d="M0 172 C80 192 140 154 240 166 C330 178 390 134 500 144 C590 154 650 190 760 172 C825 160 860 156 900 146" fill="none" stroke="#ef4444" strokeWidth="4" />
      <text x="844" y="64" className="chart-badge yes">{priceLabel(market?.yesPrice)}</text>
      <text x="844" y="138" className="chart-badge no">{priceLabel(market?.noPrice)}</text>
    </svg>
  )
}

function App() {
  const [view, setView] = useState<AppView>('dashboard')
  const [walletAddress, setWalletAddress] = useState('')
  const [accountPositions, setAccountPositions] = useState<PolymarketAccountPosition[]>([])
  const [accountStatus, setAccountStatus] = useState('Paste a public wallet or Polymarket proxy-wallet address to compare real account PnL.')
  const [accountLoading, setAccountLoading] = useState(false)

  const {
    context,
    runtimePersistenceMode,
    liveStatus,
    selectedSetSlugs,
    approvals,
    resolutionQueue,
    tradeIntents,
    selectedMarket,
    discoveryMarkets,
    leagueVisibleMarkets,
    syncState,
    toggleMarketSet,
    toggleMarketApproval,
    updateResolution,
    queueTrade,
    setSelectedMarketId,
  } = useLeagueRuntime()

  const approvedSets = marketSets.filter((set) => selectedSetSlugs.includes(set.slug))
  const accountSummary = useMemo(
    () =>
      accountPositions.reduce(
        (summary, position) => ({
          value: summary.value + position.currentValue,
          pnl: summary.pnl + position.cashPnl,
        }),
        { value: 0, pnl: 0 },
      ),
    [accountPositions],
  )

  async function loadAccountPositions() {
    setAccountLoading(true)
    setAccountStatus('Loading public Polymarket account positions...')
    try {
      const fetched = await fetchPolymarketAccountPositions(walletAddress)
      setAccountPositions(fetched)
      setAccountStatus(fetched.length ? `Loaded ${fetched.length} open positions.` : 'No open positions found for that address.')
    } catch (error) {
      setAccountPositions([])
      setAccountStatus(error instanceof Error ? error.message : 'Could not load Polymarket account positions.')
    } finally {
      setAccountLoading(false)
    }
  }

  function openMarket(market: Market) {
    setSelectedMarketId(market.id)
    setView('markets')
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  }

  function resolve(item: ResolutionItem, result: 'YES' | 'NO') {
    return updateResolution(item.id, {
      status: 'Resolved',
      result,
      note: `Resolved ${result} and queued league payout snapshot.`,
    })
  }

  const portfolioValue = 12430
  const buyingPower = 2100

  return (
    <div className="match-app">
      <aside className="side-nav">
        <div className="brand">
          <img src={logoMark} alt="Polymates logo" />
          <strong>Poly<span>mates</span></strong>
        </div>
        <nav aria-label="Primary app navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? 'active' : ''}
              onClick={() => setView(item.id)}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="season-card">
          <div className="trophy-orb">Cup</div>
          <strong>World Cup Pack</strong>
          <span>Nov 20 - Dec 18</span>
        </div>
      </aside>

      <main className="match-main">
        <header className="app-topbar">
          <div>
            <span className="app-kicker">Goal mode active</span>
            <h1>{view === 'markets' ? selectedMarket?.title : 'Dorm World Cup League'}</h1>
          </div>
          <div className="profile-cluster">
            <span className={`feed-status ${liveStatus}`}>{liveStatus === 'live' ? 'Live Polymarket feed' : 'Fallback feed'}</span>
            <button type="button" className="icon-button" aria-label="Notifications">N</button>
            <div className="avatar">AD</div>
          </div>
        </header>

        {view !== 'markets' ? (
          <div className="dashboard-layout">
            <section className="dashboard-main">
              <div className="metric-strip">
                <article>
                  <span>Portfolio value</span>
                  <strong>{money(portfolioValue)}</strong>
                  <small>+8.72% all-time</small>
                </article>
                <article>
                  <span>Buying power</span>
                  <strong>{money(buyingPower)}</strong>
                  <small>Available to trade</small>
                </article>
                <article>
                  <span>Today</span>
                  <strong>+$840</strong>
                  <small>+6.38% vs yesterday</small>
                </article>
                <article>
                  <span>League rank</span>
                  <strong>#2</strong>
                  <small>Top 10% of league</small>
                </article>
              </div>

              {view === 'dashboard' && (
                <>
                  <section className="league-hero">
                    <div className="cup-badge">Cup</div>
                    <div>
                      <span className="privacy-pill">Private league</span>
                      <h2>Dorm World Cup League</h2>
                      <p>Trade prediction markets. Compete with friends. Climb the leaderboard. Win bragging rights.</p>
                      <div className="league-meta">
                        <span>14 members</span>
                        <span>{money(leagueConfig.weeklyBonus)} weekly bonus</span>
                        <span>{approvedSets.length} active packs</span>
                      </div>
                    </div>
                    <button type="button" className="primary-action">Invite friends</button>
                  </section>

                  <section className="panel-block">
                    <div className="section-head">
                      <h3>Upcoming markets</h3>
                      <button type="button" onClick={() => setView('markets')}>View all markets</button>
                    </div>
                    <div className="match-card-row">
                      {upcomingMatches.map((match, index) => {
                        const market = leagueVisibleMarkets[index] ?? leagueVisibleMarkets[0]
                        return (
                          <button key={`${match.home}-${match.away}`} type="button" className="match-card" onClick={() => market && openMarket(market)}>
                            <span>{match.time}</span>
                            <div className="teams">
                              <strong>{match.home}</strong>
                              <small>vs</small>
                              <strong>{match.away}</strong>
                            </div>
                            <p>{market?.title ?? `Will ${match.home} win?`}</p>
                            <div className="odds-row">
                              <span>YES {priceLabel(market?.yesPrice ?? match.yes)}</span>
                              <span className="no">NO {priceLabel(market?.noPrice ?? match.no)}</span>
                            </div>
                            <footer>
                              <span>{match.volume} vol.</span>
                              <span>{98 + index * 57} trades</span>
                            </footer>
                          </button>
                        )
                      })}
                    </div>
                  </section>

                  <section className="portfolio-chart panel-block">
                    <div className="section-head">
                      <h3>Portfolio trend</h3>
                      <div className="segmented">
                        <span>1D</span>
                        <span className="active">1W</span>
                        <span>1M</span>
                        <span>ALL</span>
                      </div>
                    </div>
                    <MiniChart />
                    <div className="chart-summary">
                      <span>Current value</span>
                      <strong>{money(portfolioValue)}</strong>
                      <small>+8.72%</small>
                    </div>
                  </section>
                </>
              )}

              {view === 'portfolio' && (
                <section className="panel-block">
                  <div className="section-head">
                    <h3>Fantasy portfolio</h3>
                    <span>{productSpec.coreEntities.length} schema entities ready</span>
                  </div>
                  <div className="table-stack">
                    {positions.map((position) => (
                      <article key={`${position.market}-${position.side}`} className="table-row">
                        <div>
                          <strong>{position.market}</strong>
                          <span>{position.side} · {position.shares} shares @ {money(position.avgPrice)}</span>
                        </div>
                        <div>
                          <strong>{position.currentValue}</strong>
                          <span>{position.pnl}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {view === 'league' && (
                <section className="panel-block">
                  <div className="section-head">
                    <h3>League setup</h3>
                    <span>Invite code {context.inviteCode}</span>
                  </div>
                  <div className="league-settings-grid">
                    {marketSets.map((set) => {
                      const active = selectedSetSlugs.includes(set.slug)
                      return (
                        <article key={set.slug} className={active ? 'setting-card active' : 'setting-card'}>
                          <div>
                            <strong>{set.title}</strong>
                            <p>{set.description}</p>
                          </div>
                          <button type="button" onClick={() => toggleMarketSet(set.slug)}>{active ? 'Allowed' : 'Allow'}</button>
                        </article>
                      )
                    })}
                  </div>
                  <div className="section-head secondary-head">
                    <h3>Live market whitelist</h3>
                    <span>{approvals.filter((item) => item.approved).length} approved markets</span>
                  </div>
                  <div className="table-stack">
                    {discoveryMarkets.slice(0, 6).map((market) => {
                      const approval = approvals.find((item) => item.marketId === market.id)
                      const approved = approval?.approved ?? false
                      return (
                        <article key={market.id} className="table-row">
                          <div>
                            <strong>{market.title}</strong>
                            <span>{market.stage} · {market.volume}</span>
                          </div>
                          <button type="button" className={approved ? 'approval-button active' : 'approval-button'} onClick={() => void toggleMarketApproval(market)}>
                            {approved ? 'Approved' : 'Approve'}
                          </button>
                        </article>
                      )
                    })}
                  </div>
                  <div className="rules-grid">
                    {leagueRules.map((rule) => <span key={rule}>{rule}</span>)}
                  </div>
                </section>
              )}

              {view === 'connected' && (
                <section className="panel-block">
                  <div className="section-head">
                    <h3>Connected Polymarket accounts</h3>
                    <span>Read-only public Data API</span>
                  </div>
                  <div className="wallet-form">
                    <input
                      value={walletAddress}
                      onChange={(event) => setWalletAddress(event.target.value)}
                      placeholder="0x wallet or proxy-wallet address"
                      aria-label="Polymarket wallet address"
                    />
                    <button type="button" className="primary-action" onClick={() => void loadAccountPositions()} disabled={accountLoading}>
                      {accountLoading ? 'Loading' : 'Load account'}
                    </button>
                  </div>
                  <p className="status-note">{accountStatus}</p>
                  <div className="metric-strip compact">
                    <article>
                      <span>Open position value</span>
                      <strong>{money(accountSummary.value)}</strong>
                      <small>Public positions</small>
                    </article>
                    <article>
                      <span>Open cash PnL</span>
                      <strong>{money(accountSummary.pnl)}</strong>
                      <small>Unverified account view</small>
                    </article>
                  </div>
                  <div className="table-stack">
                    {accountPositions.slice(0, 8).map((position) => (
                      <article key={`${position.conditionId}-${position.outcome}`} className="table-row">
                        <div>
                          <strong>{position.title}</strong>
                          <span>{position.outcome} · {position.size.toFixed(2)} shares @ {(position.avgPrice * 100).toFixed(1)}c</span>
                        </div>
                        <div>
                          <strong>{money(position.currentValue)}</strong>
                          <span>{money(position.cashPnl)} · {position.percentPnl.toFixed(1)}%</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {view === 'admin' && (
                <section className="panel-block">
                  <div className="section-head">
                    <h3>Admin and settlement</h3>
                    <span>{runtimePersistenceMode} runtime · {syncState.message}</span>
                  </div>
                  <div className="table-stack">
                    {resolutionQueue.map((item) => (
                      <article key={item.id} className="settlement-row">
                        <div>
                          <strong>{item.marketTitle}</strong>
                          <span>{item.league} · {item.note}</span>
                        </div>
                        <div className="settlement-actions">
                          <span className={`status ${statusClass(item.status)}`}>{item.status}</span>
                          <button type="button" onClick={() => void resolve(item, 'YES')}>YES</button>
                          <button type="button" onClick={() => void resolve(item, 'NO')}>NO</button>
                          <button type="button" onClick={() => void updateResolution(item.id, { status: 'Paused', note: 'Paused for admin review.' })}>Pause</button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </section>

            <aside className="right-rail">
              <section className="rail-card">
                <div className="section-head">
                  <h3>League leaderboard</h3>
                  <button type="button" onClick={() => setView('league')}>Full board</button>
                </div>
                <div className="leaderboard-list">
                  {leagueMembers.concat([
                    { name: 'Noah', rank: 5, portfolio: '$8,430', pnl: '-$120', note: 'Needs one hit' },
                    { name: 'Liam', rank: 6, portfolio: '$6,210', pnl: '-$480', note: 'Cold streak' },
                  ]).map((member, index) => (
                    <article key={member.name} className={member.name === 'Akash' ? 'you' : ''}>
                      <span>{index + 1}</span>
                      <div>
                        <strong>{member.name}{member.name === 'Akash' ? ' (You)' : ''}</strong>
                        <small>{member.note}</small>
                      </div>
                      <div>
                        <strong>{member.portfolio}</strong>
                        <small className={memberDelta(index).startsWith('-') ? 'negative' : 'positive'}>{memberDelta(index)}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rail-card">
                <div className="section-head">
                  <h3>Recent activity</h3>
                  <button type="button">View all</button>
                </div>
                <div className="activity-list">
                  {friendActivity.map((item) => (
                    <article key={`${item.user}-${item.time}`}>
                      <span className={item.side}>{item.side === 'up' ? 'UP' : 'DN'}</span>
                      <div>
                        <strong>{item.user}</strong>
                        <p>{item.action}</p>
                        <small>{item.amount}</small>
                      </div>
                      <time>{item.time}</time>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rail-card runtime-card">
                <h3>Runtime</h3>
                <p>{hasSupabaseEnv ? 'Supabase credentials detected.' : 'Supabase credentials are not set locally.'}</p>
                <p>{describeRuntimeMode()}</p>
                <p>{syncState.message}</p>
              </section>
            </aside>
          </div>
        ) : (
          <div className="market-layout">
            <section className="market-workspace">
              <button type="button" className="back-link" onClick={() => setView('dashboard')}>Back to dashboard</button>
              <section className="market-title-card">
                <div className="matchup-badges">
                  <span>USA</span>
                  <small>vs</small>
                  <span>PAR</span>
                </div>
                <div>
                  <span className="privacy-pill">{selectedMarket?.stage ?? 'Market'}</span>
                  <h2>{selectedMarket?.title}</h2>
                  <p>{selectedMarket?.closes} · {selectedMarket?.status}</p>
                </div>
                <button type="button" className="icon-button" aria-label="Watch market">W</button>
              </section>

              <section className="panel-block chart-panel">
                <div className="section-head">
                  <div className="price-legend">
                    <span className="yes-dot">YES {priceLabel(selectedMarket?.yesPrice)}</span>
                    <span className="no-dot">NO {priceLabel(selectedMarket?.noPrice)}</span>
                  </div>
                  <div className="segmented">
                    <span>1H</span>
                    <span className="active">6H</span>
                    <span>1D</span>
                    <span>1W</span>
                    <span>ALL</span>
                  </div>
                </div>
                <MarketPriceChart market={selectedMarket} />
              </section>

              <div className="detail-subgrid">
                <section className="panel-block">
                  <h3>Resolution rules</h3>
                  <p>{selectedMarket?.rules}</p>
                  <p>Fantasy dollars have no cash value. No deposits, withdrawals, or redeemable prizes.</p>
                </section>
                <section className="panel-block">
                  <div className="section-head">
                    <h3>Your position</h3>
                    <button type="button" onClick={() => setView('portfolio')}>Full portfolio</button>
                  </div>
                  <div className="position-grid">
                    <span>120 YES</span>
                    <span>Avg {priceLabel((selectedMarket?.yesPrice ?? 58) - 4)}</span>
                    <span>{money(69.6)} value</span>
                    <span>{money(120)} payout</span>
                  </div>
                </section>
              </div>

              <div className="detail-subgrid three">
                <section className="panel-block">
                  <div className="section-head">
                    <h3>Recent trades</h3>
                    <button type="button">All trades</button>
                  </div>
                  <div className="mini-table">
                    {tradeIntents.map((intent) => (
                      <article key={intent.id}>
                        <span>{intent.side}</span>
                        <span>{priceLabel(intent.estimatedPrice)}</span>
                        <span>{intent.shares}</span>
                      </article>
                    ))}
                  </div>
                </section>
                <section className="panel-block sentiment-card">
                  <h3>Friends sentiment</h3>
                  <strong>62% YES</strong>
                  <p>7 of 11 friends are leaning YES.</p>
                </section>
                <section className="panel-block">
                  <h3>Comments</h3>
                  {activityFeed.slice(0, 3).map((item) => <p key={item.time}><strong>{item.user}</strong> {item.text}</p>)}
                </section>
              </div>
            </section>

            <aside className="trade-rail">
              <section className="trade-ticket">
                <div className="trade-tabs">
                  <span className="active">Buy</span>
                  <span>Sell</span>
                </div>
                <div className="odds-row">
                  <button type="button" className="yes">YES {priceLabel(selectedMarket?.yesPrice)}</button>
                  <button type="button" className="no">NO {priceLabel(selectedMarket?.noPrice)}</button>
                </div>
                <label>
                  Order type
                  <select defaultValue="limit">
                    <option value="limit">Limit order</option>
                    <option value="market">Market-style fantasy fill</option>
                  </select>
                </label>
                <label>
                  Quantity
                  <input value="100" readOnly />
                </label>
                <div className="ticket-summary">
                  <span>Average price</span>
                  <strong>{priceLabel(selectedMarket?.yesPrice)}c</strong>
                  <span>Estimated cost</span>
                  <strong>{money(selectedMarket?.yesPrice ?? 58)}</strong>
                </div>
                <button type="button" className="primary-action full" onClick={() => void queueTrade('YES', 100)}>Buy YES</button>
                <p>By placing this fantasy order you agree that no real-money trade is executed.</p>
              </section>

              <section className="rail-card">
                <div className="section-head">
                  <h3>Friend activity</h3>
                  <button type="button">All</button>
                </div>
                <div className="activity-list">
                  {friendActivity.map((item) => (
                    <article key={`market-${item.user}-${item.time}`}>
                      <span className={item.side}>{item.side === 'up' ? 'UP' : 'DN'}</span>
                      <div>
                        <strong>{item.user}</strong>
                        <p>{item.action}</p>
                      </div>
                      <time>{item.time}</time>
                    </article>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        )}

        <nav className="mobile-tabs" aria-label="Mobile navigation">
          {navItems.slice(0, 5).map((item) => (
            <button key={item.id} type="button" className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </main>
    </div>
  )
}

export default App
