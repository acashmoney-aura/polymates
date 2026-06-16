import { useMemo, useState } from 'react'
import './App.css'

type Market = {
  id: string
  title: string
  category: string
  yesPrice: number
  noPrice: number
  move: string
  confidence: number
  thesis: string
  status: 'Accumulating' | 'Watching' | 'Debating'
  catalysts: string[]
  friends: { name: string; take: string; conviction: string }[]
}

type FeedItem = {
  user: string
  action: string
  market: string
  timestamp: string
}

const markets: Market[] = [
  {
    id: 'fed-cut',
    title: 'Will the Fed cut by September?',
    category: 'Macro',
    yesPrice: 61,
    noPrice: 40,
    move: '+8.4%',
    confidence: 8,
    thesis:
      'Inflation is cooling faster than labor is weakening. Market still underweights how quickly sentiment flips once the first major cut is clearly telegraphed.',
    status: 'Accumulating',
    catalysts: ['CPI print tomorrow', 'FOMC minutes this week', 'Labor data next Friday'],
    friends: [
      { name: 'Akash', take: 'Scaling into yes on dips', conviction: '8/10' },
      { name: 'Nikhil', take: 'Needs one softer jobs report', conviction: '6/10' },
      { name: 'Maya', take: 'Macro Twitter waking up late', conviction: '7/10' },
    ],
  },
  {
    id: 'election-map',
    title: 'Will Democrats win the popular vote in 2028?',
    category: 'Politics',
    yesPrice: 54,
    noPrice: 47,
    move: '+2.1%',
    confidence: 6,
    thesis:
      'Too early for size, but narrative formation matters. Watch approval trends, candidate field quality, and whether turnout assumptions get priced too quickly.',
    status: 'Watching',
    catalysts: ['Primary field rumors', 'Major polling batch', 'Convention calendar'],
    friends: [
      { name: 'Jules', take: 'Narrative-driven overreaction market', conviction: '5/10' },
      { name: 'Sara', take: 'Worth watching for sentiment swings', conviction: '6/10' },
    ],
  },
  {
    id: 'ai-ipo',
    title: 'Will OpenAI IPO before 2029?',
    category: 'Tech',
    yesPrice: 38,
    noPrice: 63,
    move: '-3.5%',
    confidence: 7,
    thesis:
      'The odds feel a little too eager on governance complexity, capital abundance, and the incentive to stay private while strategic optionality remains huge.',
    status: 'Debating',
    catalysts: ['New funding round', 'Major governance news', 'Competitive pressure from Big Tech'],
    friends: [
      { name: 'Leo', take: 'Private longer than people think', conviction: '8/10' },
      { name: 'Riya', take: 'IPO only if regulation changes incentives', conviction: '7/10' },
    ],
  },
]

const feed: FeedItem[] = [
  {
    user: 'Maya',
    action: 'raised conviction after a fresh read on shelter inflation',
    market: 'Will the Fed cut by September?',
    timestamp: '12 min ago',
  },
  {
    user: 'Leo',
    action: 'flagged governance risk as the key hidden variable in',
    market: 'Will OpenAI IPO before 2029?',
    timestamp: '48 min ago',
  },
  {
    user: 'Akash',
    action: 'saved a market and dropped a one-line thesis for',
    market: 'Will Democrats win the popular vote in 2028?',
    timestamp: '1 hr ago',
  },
]

const lists = [
  { label: 'Live watchlist', value: '12', helper: '4 moving fast today' },
  { label: 'Shared theses', value: '29', helper: 'Across 6 friends' },
  { label: 'Catalysts queued', value: '17', helper: 'This week only' },
]

function App() {
  const [selectedMarketId, setSelectedMarketId] = useState(markets[0].id)

  const selectedMarket = useMemo(
    () => markets.find((market) => market.id === selectedMarketId) ?? markets[0],
    [selectedMarketId],
  )

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">POLYMATES / GOAL MODE MVP</p>
          <h1>Turn hot takes into compounding edge.</h1>
        </div>
        <div className="topbar-badges">
          <span>Watch together</span>
          <span>Track conviction</span>
          <span>Trade narratives</span>
        </div>
      </section>

      <section className="hero-grid">
        <div className="hero-card intro-card">
          <p className="section-label">What Polymates is</p>
          <h2>The collaborative operating system for Polymarket power users.</h2>
          <p className="body-copy">
            Save markets fast, keep your thesis honest, track catalysts, and see
            where your smartest friends actually disagree.
          </p>
          <div className="metric-row">
            {lists.map((item) => (
              <article key={item.label} className="metric-pill">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
                <small>{item.helper}</small>
              </article>
            ))}
          </div>
        </div>

        <div className="hero-card snapshot-card">
          <div className="snapshot-head">
            <div>
              <p className="section-label">Selected market</p>
              <h3>{selectedMarket.title}</h3>
            </div>
            <span className={`status-chip ${selectedMarket.status.toLowerCase()}`}>
              {selectedMarket.status}
            </span>
          </div>
          <div className="price-grid">
            <div>
              <span>YES</span>
              <strong>{selectedMarket.yesPrice}¢</strong>
            </div>
            <div>
              <span>NO</span>
              <strong>{selectedMarket.noPrice}¢</strong>
            </div>
            <div>
              <span>24h move</span>
              <strong className="positive">{selectedMarket.move}</strong>
            </div>
          </div>
          <div className="confidence-block">
            <div className="confidence-copy">
              <span>Working conviction</span>
              <strong>{selectedMarket.confidence}/10</strong>
            </div>
            <div className="confidence-bar">
              <div style={{ width: `${selectedMarket.confidence * 10}%` }}></div>
            </div>
          </div>
          <p className="body-copy">{selectedMarket.thesis}</p>
        </div>
      </section>

      <section className="workspace-grid">
        <aside className="panel watchlist-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">Watchlist</p>
              <h3>Markets worth attention</h3>
            </div>
            <button type="button" className="ghost-button">
              + Save market
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
                    <span>{market.category}</span>
                    <span>{market.move}</span>
                  </div>
                  <strong>{market.title}</strong>
                  <div className="watchlist-footer">
                    <span>Yes {market.yesPrice}¢</span>
                    <span>{market.status}</span>
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
              <h3>{selectedMarket.title}</h3>
            </div>
            <span className="soft-chip">{selectedMarket.category}</span>
          </div>

          <div className="detail-grid">
            <article className="subpanel thesis-panel">
              <p className="section-label">Current thesis</p>
              <p className="body-copy">{selectedMarket.thesis}</p>
              <div className="composer-box">
                <span>Thesis composer</span>
                <p>
                  Add the one sentence that explains why this market is mispriced
                  before your future self rewrites history.
                </p>
              </div>
            </article>

            <article className="subpanel catalyst-panel">
              <p className="section-label">Catalysts to watch</p>
              <ul className="clean-list">
                {selectedMarket.catalysts.map((catalyst) => (
                  <li key={catalyst}>{catalyst}</li>
                ))}
              </ul>
            </article>
          </div>

          <article className="subpanel friends-panel">
            <div className="subpanel-head">
              <p className="section-label">Friend takes</p>
              <span className="soft-chip">{selectedMarket.friends.length} active</span>
            </div>
            <div className="friends-grid">
              {selectedMarket.friends.map((friend) => (
                <div key={friend.name} className="friend-card">
                  <span>{friend.name}</span>
                  <strong>{friend.conviction}</strong>
                  <p>{friend.take}</p>
                </div>
              ))}
            </div>
          </article>
        </section>

        <aside className="panel activity-panel">
          <div className="panel-head">
            <div>
              <p className="section-label">Live activity</p>
              <h3>What your circle is noticing</h3>
            </div>
          </div>
          <div className="activity-stack">
            {feed.map((item) => (
              <article key={`${item.user}-${item.market}`} className="activity-card">
                <div className="activity-top">
                  <strong>{item.user}</strong>
                  <span>{item.timestamp}</span>
                </div>
                <p>
                  {item.action} <span>{item.market}</span>
                </p>
              </article>
            ))}
          </div>
          <div className="signal-box">
            <p className="section-label">Why this wins</p>
            <ul className="clean-list compact">
              <li>Less screenshot chaos</li>
              <li>Better memory around entries and invalidations</li>
              <li>A real social graph around prediction markets</li>
            </ul>
          </div>
        </aside>
      </section>
    </main>
  )
}

export default App
