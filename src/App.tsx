import { useEffect, useMemo, useState } from 'react'
import './App.css'
import logoMark from '/polymates-mark.svg'
import { estimateBinaryTrade } from './lib/amm'
import {
  activityFeed,
  leagueMembers,
  leagueModes,
  markets as fallbackMarkets,
  marketSets,
  positions,
} from './lib/mock-data'
import { fetchPolymarketMarkets } from './lib/polymarket'
import { productSpec } from './lib/product-spec'
import { hasSupabaseEnv } from './lib/supabase'
import type { Market } from './lib/types'

const onboardingSteps = [
  'Sign in and claim a username',
  'Create or join a private league',
  'Pick the market sets your league allows',
  'Receive your fantasy bankroll',
  'Start trading YES / NO contracts',
]

const notifications = [
  'Brazil vs Morocco closes in 42 minutes',
  'Maya just passed Jason on the leaderboard',
  '2 markets resolved and league snapshots updated',
]

const adminQueue = [
  { label: 'Markets pending resolution', value: '3', note: 'Final scores available, waiting for admin confirm' },
  { label: 'Paused markets', value: '1', note: 'Event start time changed' },
  { label: 'League resets available', value: '2', note: 'Weekly Sprint rolls over tonight' },
]

function App() {
  const [liveMarkets, setLiveMarkets] = useState<Market[]>([])
  const [liveStatus, setLiveStatus] = useState<'loading' | 'live' | 'fallback'>('loading')
  const [selectedMarketId, setSelectedMarketId] = useState(fallbackMarkets[0].id)

  useEffect(() => {
    let cancelled = false

    async function loadLiveMarkets() {
      try {
        const fetched = await fetchPolymarketMarkets()
        if (cancelled) return
        if (fetched.length > 0) {
          setLiveMarkets(fetched)
          setSelectedMarketId((current) => current || fetched[0].id)
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

  const activeMarkets = liveMarkets.length > 0 ? liveMarkets : fallbackMarkets

  useEffect(() => {
    if (!activeMarkets.some((market) => market.id === selectedMarketId)) {
      setSelectedMarketId(activeMarkets[0]?.id ?? '')
    }
  }, [activeMarkets, selectedMarketId])

  const selectedMarket = useMemo(
    () => activeMarkets.find((market) => market.id === selectedMarketId) ?? activeMarkets[0],
    [activeMarkets, selectedMarketId],
  )

  const tradePreview = useMemo(() => {
    if (!selectedMarket) return null
    return estimateBinaryTrade({
      currentYesPrice: selectedMarket.yesPrice,
      shares: 100,
      side: 'YES',
    })
  }, [selectedMarket])

  return (
    <main className="app-shell">
      <div className="ambient ambient-one"></div>
      <div className="ambient ambient-two"></div>

      <header className="topbar">
        <div className="brand-lockup">
          <img src={logoMark} alt="Polymates logo" className="brand-mark" />
          <div>
            <p className="eyebrow">POLYMATES</p>
            <span className="brand-subtitle">Private fantasy prediction leagues for any approved market set</span>
          </div>
        </div>
        <nav className="topbar-nav" aria-label="Primary">
          <a href="#dashboard">Dashboard</a>
          <a href="#market-sets">Market sets</a>
          <a href="#markets">Markets</a>
          <a href="#admin">Admin</a>
        </nav>
      </header>

      <section className="hero-grid">
        <div className="hero-card intro-card">
          <p className="eyebrow">FANTASY PREDICTION LEAGUES</p>
          <h1>Create a private league. Choose the market packs. Trade fantasy-dollar contracts.</h1>
          <p className="body-copy hero-copy">
            Polymates gives your group a simulated prediction exchange with league-specific balances,
            configurable market sets, social activity, admin settlement, and portfolio-based competition.
          </p>
          <div className="hero-actions">
            <a href="#dashboard" className="primary-cta">
              Explore MVP
            </a>
            <a href="#markets" className="secondary-cta">
              View live-connected feed
            </a>
          </div>
          <div className="safety-callout">
            <strong>{productSpec.defaultRules.currencyName} only.</strong>
            <span>No cash value · No deposits · No withdrawals</span>
            <small>
              Backend status: {hasSupabaseEnv ? 'Supabase env detected' : 'Supabase env scaffolded, credentials still needed'}
            </small>
            <small>
              Polymarket feed: {liveStatus === 'live' ? 'live Gamma API connection active' : liveStatus === 'loading' ? 'connecting…' : 'fallback mock feed active'}
            </small>
          </div>
        </div>

        <div className="hero-card snapshot-card shimmer-card">
          <div className="snapshot-head">
            <div>
              <p className="section-label">Default league shape</p>
              <h2>Private league + global market packs</h2>
            </div>
            <span className="status-chip open">MVP</span>
          </div>
          <div className="metric-row compact">
            <article className="metric-pill float-card">
              <strong>${productSpec.defaultRules.startingBalance.toLocaleString()}</strong>
              <span>Starting balance</span>
              <small>Fantasy bankroll</small>
            </article>
            <article className="metric-pill float-card">
              <strong>${productSpec.defaultRules.weeklyBonus.toLocaleString()}</strong>
              <span>Weekly bonus</span>
              <small>Optional reset mechanic</small>
            </article>
            <article className="metric-pill float-card">
              <strong>{marketSets.length}</strong>
              <span>Starter market packs</span>
              <small>World Cup is just one pack</small>
            </article>
          </div>
        </div>
      </section>

      <section className="why-now-card">
        <div>
          <p className="eyebrow">WHY THIS PRODUCT</p>
          <h2>Make the Polymarket feel social and safe before touching real-money complexity.</h2>
        </div>
        <p className="body-copy">
          Start with league-approved market sets, simulated AMM pricing, a real Polymarket discovery layer,
          and admin-friendly settlement. That gives you the game loop and social energy without the compliance nightmare.
        </p>
      </section>

      <section className="dashboard-grid" id="dashboard">
        <section className="panel league-summary-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">League dashboard</p>
              <h3>Core game loop at a glance</h3>
            </div>
            <span className="soft-chip">Invite-only private league</span>
          </div>
          <div className="summary-grid">
            <article className="summary-card">
              <span>Portfolio value</span>
              <strong>$10,842</strong>
              <small>+$842 all-time</small>
            </article>
            <article className="summary-card">
              <span>Buying power</span>
              <strong>$9,731</strong>
              <small>Available fantasy cash</small>
            </article>
            <article className="summary-card">
              <span>League rank</span>
              <strong>#1</strong>
              <small>Out of 8 friends</small>
            </article>
            <article className="summary-card">
              <span>Markets today</span>
              <strong>{activeMarkets.length}</strong>
              <small>{liveStatus === 'live' ? 'Pulled from live Polymarket feed' : 'Fallback demo markets'}</small>
            </article>
          </div>
        </section>

        <aside className="panel mode-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">Game modes</p>
              <h3>MVP rollout path</h3>
            </div>
          </div>
          <div className="mode-stack">
            {leagueModes.map((mode) => (
              <article key={mode.title} className="mode-card">
                <strong>{mode.title}</strong>
                <p>{mode.body}</p>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="panel market-set-panel" id="market-sets">
        <div className="panel-head">
          <div>
            <p className="section-label">League-approved market sets</p>
            <h3>The app is not World Cup-only</h3>
          </div>
          <span className="soft-chip">Global market packs, league-specific competition</span>
        </div>
        <div className="market-set-grid">
          {marketSets.map((set) => (
            <article key={set.slug} className="mode-card">
              <strong>{set.title}</strong>
              <p>{set.description}</p>
              <small>{set.eventCount} events · {set.leagueCount} sample leagues</small>
            </article>
          ))}
        </div>
      </section>

      <section className="flow-grid">
        <section className="panel create-league-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">League creation flow</p>
              <h3>What a first-time user actually does</h3>
            </div>
            <span className="soft-chip">Invite code: START123</span>
          </div>
          <div className="step-grid">
            {onboardingSteps.map((step, index) => (
              <article key={step} className="step-card">
                <span className="step-index">0{index + 1}</span>
                <p>{step}</p>
              </article>
            ))}
          </div>
        </section>

        <aside className="panel notification-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">In-app notifications</p>
              <h3>Enough to keep leagues alive</h3>
            </div>
          </div>
          <div className="notification-stack">
            {notifications.map((notification) => (
              <article key={notification} className="notification-card">
                <strong>Alert</strong>
                <p>{notification}</p>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="workspace-grid" id="markets">
        <aside className="panel watchlist-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">Market feed</p>
              <h3>{liveStatus === 'live' ? 'Live Polymarket-connected contracts' : 'Upcoming contracts'}</h3>
            </div>
            <button type="button" className="ghost-button">
              + Create market
            </button>
          </div>
          <div className="watchlist-stack">
            {activeMarkets.map((market) => {
              const active = market.id === selectedMarket?.id
              return (
                <button
                  type="button"
                  key={market.id}
                  className={`watchlist-card ${active ? 'active' : ''}`}
                  onClick={() => setSelectedMarketId(market.id)}
                >
                  <div className="watchlist-meta">
                    <span>{market.stage}</span>
                    <span>{market.status}</span>
                  </div>
                  <strong>{market.title}</strong>
                  <div className="watchlist-footer">
                    <span>YES {market.yesPrice}¢</span>
                    <span>NO {market.noPrice}¢</span>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="panel detail-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">Market workspace</p>
              <h3>{selectedMarket?.title}</h3>
            </div>
            <span className="soft-chip">{selectedMarket?.stage}</span>
          </div>

          <div className="detail-grid">
            <article className="subpanel market-pricing-panel">
              <p className="section-label">{liveStatus === 'live' ? 'Live Polymarket pricing' : 'Simulated market pricing'}</p>
              <div className="price-grid">
                <div>
                  <span>YES price</span>
                  <strong>{selectedMarket?.yesPrice}¢</strong>
                </div>
                <div>
                  <span>NO price</span>
                  <strong>{selectedMarket?.noPrice}¢</strong>
                </div>
                <div>
                  <span>Volume</span>
                  <strong>{selectedMarket?.volume}</strong>
                </div>
              </div>
              <p className="body-copy">{selectedMarket?.closes}</p>
              <p className="body-copy">{selectedMarket?.rules}</p>
            </article>

            <article className="subpanel trade-panel">
              <p className="section-label">AMM preview</p>
              <div className="trade-preview">
                <strong>Buy 100 YES shares</strong>
                <p>Estimated with a simple MVP AMM, not an order book.</p>
                {tradePreview && (
                  <ul className="clean-list compact">
                    <li>Entry price: {tradePreview.entryPrice}¢</li>
                    <li>Post-trade estimate: {tradePreview.exitPriceEstimate}¢</li>
                    <li>Estimated cost: ${tradePreview.cost}</li>
                    <li>Max payout: ${tradePreview.maxPayout}</li>
                    <li>Potential profit: ${tradePreview.maxProfit}</li>
                  </ul>
                )}
              </div>
            </article>
          </div>

          <article className="subpanel resolution-panel">
            <div className="subpanel-head">
              <p className="section-label">Resolution rules</p>
              <span className={`status-chip ${selectedMarket?.status.toLowerCase().replace(' ', '-')}`}>
                {selectedMarket?.status}
              </span>
            </div>
            <p className="body-copy">
              Markets lock at start time and settle after the final result or defined event outcome.
              MVP admin tools can resolve manually before feed automation is added.
            </p>
          </article>
        </section>

        <aside className="panel activity-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">Friend activity</p>
              <h3>What keeps the league alive</h3>
            </div>
          </div>
          <div className="activity-stack">
            {activityFeed.map((item) => (
              <article key={`${item.user}-${item.time}`} className="activity-card">
                <div className="activity-top">
                  <strong>{item.user}</strong>
                  <span>{item.time}</span>
                </div>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="portfolio-grid" id="portfolio">
        <section className="panel portfolio-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">Portfolio</p>
              <h3>Open positions</h3>
            </div>
            <span className="soft-chip">{productSpec.coreEntities.length} core entities in schema</span>
          </div>
          <div className="table-like-grid">
            {positions.map((position) => (
              <article key={position.market + position.side} className="position-row">
                <div>
                  <strong>{position.market}</strong>
                  <span>
                    {position.side} · {position.shares} shares @ ${position.avgPrice.toFixed(2)}
                  </span>
                </div>
                <div>
                  <strong>{position.currentValue}</strong>
                  <span>{position.pnl}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="panel leaderboard-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">Leaderboard</p>
              <h3>League standings</h3>
            </div>
          </div>
          <div className="leaderboard-stack">
            {leagueMembers.map((member) => (
              <article key={member.name} className="leaderboard-row">
                <div>
                  <strong>
                    #{member.rank} {member.name}
                  </strong>
                  <span>{member.note}</span>
                </div>
                <div>
                  <strong>{member.portfolio}</strong>
                  <span>{member.pnl}</span>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="admin-grid" id="admin">
        <section className="panel admin-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">Admin + settlement tools</p>
              <h3>Still mandatory in the MVP</h3>
            </div>
          </div>
          <div className="admin-actions-grid">
            <article className="admin-card">
              <strong>Create / pause markets</strong>
              <p>Seed markets from approved market packs and lock them at the correct time.</p>
            </article>
            <article className="admin-card">
              <strong>Resolve outcomes</strong>
              <p>Settle YES / NO contracts and push payouts across every participating league.</p>
            </article>
            <article className="admin-card">
              <strong>Inspect trades</strong>
              <p>Review league activity, suspicious flows, and mistaken settlements.</p>
            </article>
            <article className="admin-card">
              <strong>Reset / repair league state</strong>
              <p>Fix bad seeds, wrong results, or testing artifacts without nuking the whole app.</p>
            </article>
          </div>
        </section>

        <aside className="panel scope-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">Admin queue</p>
              <h3>Operational MVP surface</h3>
            </div>
          </div>
          <div className="queue-stack">
            {adminQueue.map((item) => (
              <article key={item.label} className="queue-card">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
                <small>{item.note}</small>
              </article>
            ))}
          </div>
          <ul className="clean-list compact compact-top">
            <li>No real money</li>
            <li>No deposits or withdrawals</li>
            <li>No public markets</li>
            <li>No user-created markets</li>
            <li>No live in-game trading</li>
            <li>No parlays yet</li>
            <li>No complex order book</li>
          </ul>
        </aside>
      </section>

      <section className="closing-banner">
        <div>
          <p className="eyebrow">INTERNAL PRODUCT LINE</p>
          <h2>Fantasy prediction league engine — not sportsbook clone.</h2>
        </div>
        <p className="body-copy">
          Create a private league, approve the market sets you want, mirror or whitelist real Polymarket discovery,
          trade fantasy-dollar contracts, and compete with friends on portfolio value.
        </p>
      </section>
    </main>
  )
}

export default App
