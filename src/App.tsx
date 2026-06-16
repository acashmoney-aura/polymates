import './App.css'
import logoMark from '/polymates-mark.svg'
import {
  activityFeed,
  leagueConfig,
  leagueMembers,
  leagueModes,
  marketSets,
  positions,
} from './lib/mock-data'
import { useLeagueRuntime } from './lib/league-runtime'
import { productSpec } from './lib/product-spec'
import { describeRuntimeMode, hasSupabaseEnv } from './lib/supabase'

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

function statusClass(status: string) {
  return status.toLowerCase().replace(/\s+/g, '-')
}

function App() {
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

  const approvedMarketCount = approvals.filter((item) => item.approved).length
  const approvedSets = marketSets.filter((set) => selectedSetSlugs.includes(set.slug))

  return (
    <main className="app-shell">
      <div className="ambient ambient-one"></div>
      <div className="ambient ambient-two"></div>

      <section className="goal-mode-banner">
        <div>
          <p className="eyebrow">GOAL MODE · EXECUTION</p>
          <strong>Shipping the private-league MVP, not just a pretty mock.</strong>
        </div>
        <p>
          Active scope: live Polymarket discovery, league whitelisting, invite flow, settlement controls, backend-ready runtime state, and league context hydration.
        </p>
      </section>

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
          <a href="#imports">Imports</a>
          <a href="#markets">Markets</a>
          <a href="#admin">Admin</a>
        </nav>
      </header>

      <section className="hero-grid">
        <div className="hero-card intro-card">
          <p className="eyebrow">FANTASY PREDICTION LEAGUES</p>
          <h1>Create a private league. Choose the market packs. Import live markets. Trade fantasy-dollar contracts.</h1>
          <p className="body-copy hero-copy">
            Polymates gives your group a simulated prediction exchange with league-specific balances,
            configurable market sets, social activity, admin settlement, and portfolio-based competition.
          </p>
          <div className="hero-actions">
            <a href="#dashboard" className="primary-cta">
              Explore MVP
            </a>
            <a href="#imports" className="secondary-cta">
              Whitelist live markets
            </a>
          </div>
          <div className="safety-callout">
            <strong>{productSpec.defaultRules.currencyName} only.</strong>
            <span>No cash value · No deposits · No withdrawals</span>
            <small>
              Backend status: {hasSupabaseEnv ? 'Supabase env detected' : 'Supabase env scaffolded, credentials still needed'}
            </small>
            <small>Runtime mode: {describeRuntimeMode()}</small>
            <small>
              Polymarket feed: {liveStatus === 'live' ? 'live Gamma API connection active' : liveStatus === 'loading' ? 'connecting…' : 'fallback mock feed active'}
            </small>
            <small>
              Sync: {syncState.message}
            </small>
          </div>
        </div>

        <div className="hero-card snapshot-card shimmer-card">
          <div className="snapshot-head">
            <div>
              <p className="section-label">Default league shape</p>
              <h2>Private league + live discovery + admin controls</h2>
            </div>
            <span className="status-chip open">{runtimePersistenceMode === 'supabase' ? 'Connected' : 'MVP'}</span>
          </div>
          <div className="metric-row compact">
            <article className="metric-pill float-card">
              <strong>${leagueConfig.startingBalance.toLocaleString()}</strong>
              <span>Starting balance</span>
              <small>Fantasy bankroll</small>
            </article>
            <article className="metric-pill float-card">
              <strong>{approvedMarketCount}</strong>
              <span>League-approved markets</span>
              <small>Backed by approval records</small>
            </article>
            <article className="metric-pill float-card">
              <strong>{approvedSets.length}</strong>
              <span>Approved market packs</span>
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
          invite-only competition, and admin-friendly settlement. That gives you the game loop without the compliance headache.
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
              <small>Out of {leagueConfig.memberCount} friends</small>
            </article>
            <article className="summary-card">
              <span>Markets today</span>
              <strong>{leagueVisibleMarkets.length}</strong>
              <small>{liveStatus === 'live' ? 'Approved from live Polymarket feed' : 'Fallback demo markets'}</small>
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
          {marketSets.map((set) => {
            const active = selectedSetSlugs.includes(set.slug)
            return (
              <article key={set.slug} className={`mode-card selectable-card ${active ? 'selected' : ''}`}>
                <div className="selectable-head">
                  <strong>{set.title}</strong>
                  <button type="button" className={`mini-button ${active ? 'active' : ''}`} onClick={() => toggleMarketSet(set.slug)}>
                    {active ? 'Allowed' : 'Allow'}
                  </button>
                </div>
                <p>{set.description}</p>
                <small>{set.eventCount} events · {set.leagueCount} sample leagues</small>
              </article>
            )
          })}
        </div>
      </section>

      <section className="league-builder-grid">
        <section className="panel create-league-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">League creation + invite flow</p>
              <h3>{leagueConfig.name}</h3>
            </div>
            <span className="soft-chip">Invite code: {leagueConfig.inviteCode}</span>
          </div>
          <div className="step-grid">
            {onboardingSteps.map((step, index) => (
              <article key={step} className="step-card">
                <span className="step-index">0{index + 1}</span>
                <p>{step}</p>
              </article>
            ))}
          </div>
          <div className="invite-grid">
            <article className="info-card">
              <span>Invite link</span>
              <strong>polymates.app/join/{context.inviteCode}</strong>
              <small>Share in group chat and onboard friends instantly.</small>
            </article>
            <article className="info-card">
              <span>League rules</span>
              <strong>${leagueConfig.startingBalance.toLocaleString()} start · ${leagueConfig.weeklyBonus.toLocaleString()} weekly</strong>
              <small>{leagueConfig.memberCount} current members · viewing as {context.viewerName}</small>
            </article>
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

      <section className="imports-grid" id="imports">
        <section className="panel import-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">Real Polymarket connection</p>
              <h3>Import or whitelist live markets for your league</h3>
            </div>
            <span className="soft-chip">{liveStatus === 'live' ? 'Live feed' : liveStatus === 'loading' ? 'Connecting' : 'Fallback data'}</span>
          </div>
          <div className="import-stack">
            {discoveryMarkets.slice(0, 6).map((market) => {
              const approval = approvals.find((item) => item.marketId === market.id)
              const approved = approval?.approved ?? false
              return (
                <article key={market.id} className={`import-row ${approved ? 'selected' : ''}`}>
                  <div>
                    <strong>{market.title}</strong>
                    <p>{market.stage} · {market.volume}</p>
                    <small>{market.closes}</small>
                  </div>
                  <div className="import-actions">
                    <button type="button" className="mini-button" onClick={() => setSelectedMarketId(market.id)}>
                      Inspect
                    </button>
                    <button type="button" className={`mini-button ${approved ? 'active' : ''}`} onClick={() => void toggleMarketApproval(market)}>
                      {approved ? 'Approved' : 'Approve'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <aside className="panel approved-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">League whitelist</p>
              <h3>What players can actually trade</h3>
            </div>
          </div>
          <div className="approved-stack">
            {approvedSets.map((set) => (
              <span key={set.slug} className="invite-pill">{set.title}</span>
            ))}
          </div>
          <div className="queue-stack compact-top">
            {approvals.filter((item) => item.approved).slice(0, 4).map((item) => {
              const market = discoveryMarkets.find((candidate) => candidate.id === item.marketId)
              if (!market) return null
              return (
                <article key={item.marketId} className="queue-card">
                  <strong>{market.yesPrice}¢ YES</strong>
                  <span>{market.title}</span>
                  <small>{item.source} import · {item.approvedAt} · {context.leagueName}</small>
                </article>
              )
            })}
          </div>
        </aside>
      </section>

      <section className="workspace-grid" id="markets">
        <aside className="panel watchlist-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">League market feed</p>
              <h3>{liveStatus === 'live' ? 'Approved live-connected contracts' : 'Approved contracts'}</h3>
            </div>
            <button type="button" className="ghost-button">
              + Create market
            </button>
          </div>
          <div className="watchlist-stack">
            {leagueVisibleMarkets.map((market) => {
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
              <p className="section-label">Trade ticket</p>
              <div className="trade-preview">
                <strong>Queue a fantasy trade</strong>
                <p>Orders now map to a backend-ready trade intent shape, with local fallback until Supabase keys land.</p>
                <div className="ticket-actions compact-top">
                  <button type="button" className="mini-button active" onClick={() => void queueTrade('YES', 100)}>
                    Queue 100 YES
                  </button>
                  <button type="button" className="mini-button" onClick={() => void queueTrade('NO', 100)}>
                    Queue 100 NO
                  </button>
                </div>
              </div>
            </article>
          </div>

          <article className="subpanel resolution-panel">
            <div className="subpanel-head">
              <p className="section-label">League eligibility + resolution rules</p>
              <span className={`status-chip ${statusClass(selectedMarket?.status ?? 'Open')}`}>
                {selectedMarket?.status}
              </span>
            </div>
            <p className="body-copy">
              Only whitelisted markets are visible inside a league. Markets lock at start time and settle after the final result or defined event outcome.
            </p>
          </article>

          <article className="subpanel intent-panel">
            <div className="subpanel-head">
              <p className="section-label">Trade intent queue</p>
              <span className="soft-chip">{runtimePersistenceMode} runtime · {context.leagueName}</span>
            </div>
            <div className="intent-stack">
              {tradeIntents.map((intent) => (
                <article key={intent.id} className="intent-row">
                  <div>
                    <strong>{intent.marketTitle}</strong>
                    <span>{intent.side} · {intent.shares} shares · {intent.createdAtLabel}</span>
                  </div>
                  <div>
                    <strong>${intent.estimatedCost.toFixed(2)}</strong>
                    <span>{intent.status} @ {intent.estimatedPrice}¢</span>
                  </div>
                </article>
              ))}
            </div>
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
              <h3>Resolve, pause, and repair the league runtime</h3>
            </div>
          </div>
          <div className="resolution-stack">
            {resolutionQueue.map((item) => (
              <article key={item.id} className="resolution-row">
                <div>
                  <div className="selectable-head">
                    <strong>{item.marketTitle}</strong>
                    <span className={`status-chip ${statusClass(item.status)}`}>{item.status}</span>
                  </div>
                  <p>{item.league}</p>
                  <small>{item.note}</small>
                </div>
                <div className="resolution-actions">
                  <button type="button" className="mini-button" onClick={() => void updateResolution(item.id, { status: 'Resolved', result: 'YES', note: 'Resolved YES and pushed league payout snapshot.' })}>
                    Resolve YES
                  </button>
                  <button type="button" className="mini-button" onClick={() => void updateResolution(item.id, { status: 'Resolved', result: 'NO', note: 'Resolved NO and pushed league payout snapshot.' })}>
                    Resolve NO
                  </button>
                  <button type="button" className="mini-button" onClick={() => void updateResolution(item.id, { status: 'Paused', result: item.result === 'Pending' ? 'Pending' : item.result, note: 'Paused for admin review before reopening or resettling.' })}>
                    Pause
                  </button>
                </div>
              </article>
            ))}
          </div>
          <div className="admin-actions-grid compact-top">
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
              <p>Review trade intents, suspicious flows, and mistaken settlements.</p>
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
          queue fantasy trade intents, and compete with friends on portfolio value.
        </p>
      </section>
    </main>
  )
}

export default App
