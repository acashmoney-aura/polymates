import { useMemo, useState } from 'react'
import './App.css'
import logoMark from '/polymates-mark.svg'
import { hasSupabaseEnv } from './lib/supabase'

type LeagueMember = {
  name: string
  rank: number
  portfolio: string
  pnl: string
  note: string
}

type Market = {
  id: string
  title: string
  stage: string
  closes: string
  yesPrice: number
  noPrice: number
  volume: string
  rules: string
  status: 'Open' | 'Closing Soon' | 'Resolved'
}

type Position = {
  market: string
  side: 'YES' | 'NO'
  shares: number
  avgPrice: number
  currentValue: string
  pnl: string
}

type Activity = {
  user: string
  text: string
  time: string
}

const leagueMembers: LeagueMember[] = [
  {
    name: 'Akash',
    rank: 1,
    portfolio: '$10,842',
    pnl: '+$842',
    note: 'Macro sharp this week',
  },
  {
    name: 'Maya',
    rank: 2,
    portfolio: '$10,615',
    pnl: '+$615',
    note: 'Champion market sniper',
  },
  {
    name: 'Arnav',
    rank: 3,
    portfolio: '$10,201',
    pnl: '+$201',
    note: 'Grinding match winners',
  },
  {
    name: 'Jason',
    rank: 4,
    portfolio: '$9,744',
    pnl: '-$256',
    note: 'Needs one good bounce-back',
  },
]

const markets: Market[] = [
  {
    id: 'bra-mor',
    title: 'Will Brazil beat Morocco?',
    stage: 'Quarterfinal',
    closes: 'Closes at kickoff · Fri 3:00 PM',
    yesPrice: 62,
    noPrice: 40,
    volume: '$18.4k fantasy volume',
    rules: 'Resolves YES if Brazil wins in regular time. Resolves NO otherwise.',
    status: 'Open',
  },
  {
    id: 'usa-par',
    title: 'Will USA beat Paraguay?',
    stage: 'Group Stage',
    closes: 'Closes at kickoff · Sat 12:00 PM',
    yesPrice: 58,
    noPrice: 44,
    volume: '$12.7k fantasy volume',
    rules: 'Resolves YES if USA wins. Resolves NO if draw or Paraguay win.',
    status: 'Closing Soon',
  },
  {
    id: 'arg-advance',
    title: 'Will Argentina advance?',
    stage: 'Knockout',
    closes: 'Closes at kickoff · Sun 8:00 PM',
    yesPrice: 73,
    noPrice: 29,
    volume: '$21.1k fantasy volume',
    rules: 'Resolves YES if Argentina advances from the round. Resolves NO otherwise.',
    status: 'Open',
  },
]

const positions: Position[] = [
  {
    market: 'Will Brazil beat Morocco?',
    side: 'YES',
    shares: 100,
    avgPrice: 0.62,
    currentValue: '$66',
    pnl: '+$4',
  },
  {
    market: 'Will USA beat Paraguay?',
    side: 'NO',
    shares: 80,
    avgPrice: 0.41,
    currentValue: '$35',
    pnl: '+$2',
  },
  {
    market: 'Will Argentina advance?',
    side: 'YES',
    shares: 60,
    avgPrice: 0.69,
    currentValue: '$44',
    pnl: '+$3',
  },
]

const activityFeed: Activity[] = [
  {
    user: 'Maya',
    text: 'bought $320 YES on Brazil to beat Morocco.',
    time: '9 min ago',
  },
  {
    user: 'Arnav',
    text: 'sold champion shares for +$118 fantasy profit.',
    time: '26 min ago',
  },
  {
    user: 'Jason',
    text: 'jumped into USA vs Paraguay after line movement.',
    time: '41 min ago',
  },
  {
    user: 'Akash',
    text: 'moved to #1 in the league after two good exits.',
    time: '1 hr ago',
  },
]

const leagueModes = [
  {
    title: 'Season League',
    body: '$10,000 starting balance. Full World Cup run. Leaderboard by total portfolio value.',
  },
  {
    title: 'Weekly Sprint',
    body: '$2,500 weekly reset. Faster loops and weekly winners.',
  },
  {
    title: 'Matchday Room',
    body: '$1,000 temporary bankroll for a single match or slate.',
  },
]

function App() {
  const [selectedMarketId, setSelectedMarketId] = useState(markets[0].id)

  const selectedMarket = useMemo(
    () => markets.find((market) => market.id === selectedMarketId) ?? markets[0],
    [selectedMarketId],
  )

  return (
    <main className="app-shell">
      <div className="ambient ambient-one"></div>
      <div className="ambient ambient-two"></div>

      <header className="topbar">
        <div className="brand-lockup">
          <img src={logoMark} alt="Polymates logo" className="brand-mark" />
          <div>
            <p className="eyebrow">POLYMATES</p>
            <span className="brand-subtitle">Private World Cup fantasy prediction leagues</span>
          </div>
        </div>
        <nav className="topbar-nav" aria-label="Primary">
          <a href="#dashboard">Dashboard</a>
          <a href="#markets">Markets</a>
          <a href="#portfolio">Portfolio</a>
          <a href="#admin">Admin</a>
        </nav>
      </header>

      <section className="hero-grid">
        <div className="hero-card intro-card">
          <p className="eyebrow">WORLD CUP FANTASY PREDICTION EXCHANGE</p>
          <h1>Create a private league. Trade fantasy-dollar markets. Beat your friends.</h1>
          <p className="body-copy hero-copy">
            Polymates gives your group a simulated Polymarket-style World Cup game:
            fantasy bankrolls, YES/NO markets, leaderboards, social activity, and admin settlement tools.
          </p>
          <div className="hero-actions">
            <a href="#dashboard" className="primary-cta">
              Explore MVP
            </a>
            <a href="#markets" className="secondary-cta">
              View market flow
            </a>
          </div>
          <div className="safety-callout">
            <strong>Fantasy dollars only.</strong>
            <span>No cash value · No deposits · No withdrawals</span>
            <small>
              Backend status: {hasSupabaseEnv ? 'Supabase env detected' : 'Supabase env not connected yet'}
            </small>
          </div>
        </div>

        <div className="hero-card snapshot-card shimmer-card">
          <div className="snapshot-head">
            <div>
              <p className="section-label">Default MVP league</p>
              <h2>Akash’s World Cup League</h2>
            </div>
            <span className="status-chip open">Season League</span>
          </div>
          <div className="metric-row compact">
            <article className="metric-pill float-card">
              <strong>$10,000</strong>
              <span>Starting balance</span>
              <small>Fantasy dollars only</small>
            </article>
            <article className="metric-pill float-card">
              <strong>$2,000</strong>
              <span>Weekly bonus</span>
              <small>Encourages continued play</small>
            </article>
            <article className="metric-pill float-card">
              <strong>YES / NO</strong>
              <span>Market format</span>
              <small>Simple settlement rules</small>
            </article>
          </div>
        </div>
      </section>

      <section className="why-now-card">
        <div>
          <p className="eyebrow">WHY THIS SHAPE</p>
          <h2>Start with simulated prediction markets, not real-money complexity.</h2>
        </div>
        <p className="body-copy">
          The MVP is a private friend league game: global World Cup markets, league-specific balances,
          portfolio-based leaderboards, and manual/admin-friendly settlement. No order book. No sportsbook baggage.
        </p>
      </section>

      <section className="dashboard-grid" id="dashboard">
        <section className="panel league-summary-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">League dashboard</p>
              <h3>Core game loop at a glance</h3>
            </div>
            <span className="soft-chip">Private invite-only league</span>
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
              <strong>6</strong>
              <small>2 close in under 3h</small>
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

      <section className="workspace-grid" id="markets">
        <aside className="panel watchlist-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">World Cup markets</p>
              <h3>Upcoming prediction contracts</h3>
            </div>
            <button type="button" className="ghost-button">
              + Create market
            </button>
          </div>
          <div className="watchlist-stack">
            {markets.map((market) => {
              const active = market.id === selectedMarket.id
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
              <p className="section-label">Market page</p>
              <h3>{selectedMarket.title}</h3>
            </div>
            <span className="soft-chip">{selectedMarket.stage}</span>
          </div>

          <div className="detail-grid">
            <article className="subpanel market-pricing-panel">
              <p className="section-label">Simulated market pricing</p>
              <div className="price-grid">
                <div>
                  <span>YES price</span>
                  <strong>{selectedMarket.yesPrice}¢</strong>
                </div>
                <div>
                  <span>NO price</span>
                  <strong>{selectedMarket.noPrice}¢</strong>
                </div>
                <div>
                  <span>Volume</span>
                  <strong>{selectedMarket.volume}</strong>
                </div>
              </div>
              <p className="body-copy">{selectedMarket.closes}</p>
              <p className="body-copy">{selectedMarket.rules}</p>
            </article>

            <article className="subpanel trade-panel">
              <p className="section-label">Trade panel</p>
              <div className="trade-preview">
                <strong>Example trade</strong>
                <p>Buy 100 YES shares at {selectedMarket.yesPrice}¢</p>
                <ul className="clean-list compact">
                  <li>Cost: ${(selectedMarket.yesPrice).toFixed(0)}</li>
                  <li>Max payout: $100</li>
                  <li>Potential profit: ${(100 - selectedMarket.yesPrice).toFixed(0)}</li>
                </ul>
              </div>
            </article>
          </div>

          <article className="subpanel resolution-panel">
            <div className="subpanel-head">
              <p className="section-label">Resolution rules</p>
              <span className={`status-chip ${selectedMarket.status.toLowerCase().replace(' ', '-')}`}>
                {selectedMarket.status}
              </span>
            </div>
            <p className="body-copy">
              Markets close at kickoff and settle after the final result. For MVP, admin tools can resolve markets manually.
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
            <span className="soft-chip">Fantasy dollars only</span>
          </div>
          <div className="table-like-grid">
            {positions.map((position) => (
              <article key={position.market + position.side} className="position-row">
                <div>
                  <strong>{position.market}</strong>
                  <span>{position.side} · {position.shares} shares @ ${position.avgPrice.toFixed(2)}</span>
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
                  <strong>#{member.rank} {member.name}</strong>
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
              <h3>Do not skip this in the MVP</h3>
            </div>
          </div>
          <div className="admin-actions-grid">
            <article className="admin-card">
              <strong>Create / pause markets</strong>
              <p>Seed World Cup markets manually and freeze them at kickoff.</p>
            </article>
            <article className="admin-card">
              <strong>Resolve outcomes</strong>
              <p>Settle YES / NO contracts after final result and push payouts.</p>
            </article>
            <article className="admin-card">
              <strong>Inspect trades</strong>
              <p>Review league activity, suspicious flows, and mistaken settlements.</p>
            </article>
            <article className="admin-card">
              <strong>Reset league state</strong>
              <p>Fix edge cases quickly while testing the full game loop.</p>
            </article>
          </div>
        </section>

        <aside className="panel scope-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">Not in v1</p>
              <h3>Protect the scope</h3>
            </div>
          </div>
          <ul className="clean-list compact">
            <li>No real money</li>
            <li>No deposits or withdrawals</li>
            <li>No public markets</li>
            <li>No user-created markets</li>
            <li>No player props</li>
            <li>No live in-game trading</li>
            <li>No parlays yet</li>
          </ul>
        </aside>
      </section>

      <section className="closing-banner">
        <div>
          <p className="eyebrow">INTERNAL PRODUCT LINE</p>
          <h2>Fantasy prediction exchange — not betting app.</h2>
        </div>
        <p className="body-copy">
          Create a private World Cup league, trade fantasy-dollar prediction markets, and compete with friends on portfolio value.
        </p>
      </section>
    </main>
  )
}

export default App
