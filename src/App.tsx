import { useMemo, useState } from 'react'
import './App.css'
import logoMark from '/polymates-mark.svg'

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
  checklist: string[]
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
    noPrice: 39,
    move: '+8.4%',
    confidence: 8,
    thesis:
      'Inflation is cooling faster than labor is weakening. The market still underweights how quickly tone shifts once the first serious cut gets telegraphed.',
    status: 'Accumulating',
    catalysts: ['CPI print tomorrow', 'FOMC minutes this week', 'Labor data next Friday'],
    checklist: ['Track odds drift after CPI', 'Log what invalidates the thesis', 'Compare group conviction before entry'],
    friends: [
      { name: 'Akash', take: 'Scaling into yes on dips', conviction: '8/10' },
      { name: 'Nikhil', take: 'Needs one softer jobs print', conviction: '6/10' },
      { name: 'Maya', take: 'Macro Twitter waking up late', conviction: '7/10' },
    ],
  },
  {
    id: 'election-map',
    title: 'Will Democrats win the popular vote in 2028?',
    category: 'Politics',
    yesPrice: 54,
    noPrice: 46,
    move: '+2.1%',
    confidence: 6,
    thesis:
      'Too early for size, but narrative formation matters. Watch approval trends, candidate quality, and whether turnout assumptions get priced too hard too early.',
    status: 'Watching',
    catalysts: ['Primary field rumors', 'Major polling batch', 'Convention calendar'],
    checklist: ['Save key polling sources', 'Separate signal from discourse noise', 'Track sentiment spikes by event'],
    friends: [
      { name: 'Jules', take: 'Narrative overreaction market', conviction: '5/10' },
      { name: 'Sara', take: 'Worth watching for sentiment swings', conviction: '6/10' },
    ],
  },
  {
    id: 'openai-ipo',
    title: 'Will OpenAI IPO before 2029?',
    category: 'Tech',
    yesPrice: 38,
    noPrice: 62,
    move: '-3.5%',
    confidence: 7,
    thesis:
      'The market feels too eager on governance drama and not skeptical enough about how long capital abundance and strategic flexibility can keep a company private.',
    status: 'Debating',
    catalysts: ['New funding round', 'Major governance news', 'Competitive pressure from Big Tech'],
    checklist: ['Log dilution assumptions', 'Capture governance milestones', 'Compare strategic incentives vs. public pressure'],
    friends: [
      { name: 'Leo', take: 'Private longer than people think', conviction: '8/10' },
      { name: 'Riya', take: 'IPO only if incentives change hard', conviction: '7/10' },
    ],
  },
]

const feed: FeedItem[] = [
  {
    user: 'Maya',
    action: 'raised conviction after a fresh read on shelter inflation in',
    market: 'Will the Fed cut by September?',
    timestamp: '12 min ago',
  },
  {
    user: 'Leo',
    action: 'flagged governance risk as the hidden variable in',
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

const metrics = [
  { label: 'Live watchlist', value: '12', helper: '4 moving fast today' },
  { label: 'Shared theses', value: '29', helper: 'Across 6 sharp friends' },
  { label: 'Catalysts queued', value: '17', helper: 'This week only' },
]

const productPillars = [
  'Fast market capture',
  'Shared thesis memory',
  'Catalyst tracking',
  'Conviction history',
  'Friend activity graph',
]

const featureRail = [
  {
    title: 'Market memory',
    body: 'Every saved market keeps the thesis, conviction, catalysts, and invalidation points in one thread.',
  },
  {
    title: 'Collaborative edge',
    body: 'See what your smartest friends are watching without turning every idea into a hundred scattered messages.',
  },
  {
    title: 'Narrative tracking',
    body: 'Watch how stories move prices, which catalysts mattered, and which takes aged terribly.',
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
            <span className="brand-subtitle">Collaborative intelligence for prediction markets</span>
          </div>
        </div>
        <nav className="topbar-nav" aria-label="Primary">
          <a href="#workspace">Workspace</a>
          <a href="#features">Features</a>
          <a href="#why-now">Why now</a>
        </nav>
      </header>

      <section className="hero-grid">
        <div className="hero-card intro-card">
          <p className="eyebrow">GOAL MODE MVP</p>
          <h1>Turn hot takes into compounding edge.</h1>
          <p className="body-copy hero-copy">
            Polymates is the social operating system for Polymarket power users:
            save markets fast, track conviction honestly, log catalysts, and see
            where your sharpest friends actually disagree.
          </p>
          <div className="hero-actions">
            <a href="#workspace" className="primary-cta">
              Explore the product
            </a>
            <a href="#features" className="secondary-cta">
              See the core loop
            </a>
          </div>
          <div className="metric-row">
            {metrics.map((item) => (
              <article key={item.label} className="metric-pill float-card">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
                <small>{item.helper}</small>
              </article>
            ))}
          </div>
        </div>

        <div className="hero-card snapshot-card shimmer-card">
          <div className="snapshot-head">
            <div>
              <p className="section-label">Selected market</p>
              <h2>{selectedMarket.title}</h2>
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
          <div className="tag-row">
            {productPillars.slice(0, 3).map((tag) => (
              <span key={tag} className="soft-chip">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="why-now-card" id="why-now">
        <div>
          <p className="eyebrow">WHY NOW</p>
          <h2>Prediction markets are mainstream. The workflow is still janky.</h2>
        </div>
        <p className="body-copy">
          Right now the stack is still screenshots, bookmarks, scattered notes,
          and post-hoc conviction. Polymates turns the research loop into an actual product.
        </p>
      </section>

      <section className="workspace-grid" id="workspace">
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
                  Save the sentence that explains why this market is mispriced
                  before your future self tries to rewrite history.
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

          <div className="detail-grid secondary-grid">
            <article className="subpanel checklist-panel">
              <p className="section-label">Trade hygiene</p>
              <ul className="clean-list">
                {selectedMarket.checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article className="subpanel position-panel">
              <p className="section-label">Probability frame</p>
              <div className="probability-bars">
                <div>
                  <span>Yes case</span>
                  <div className="bar-track"><div style={{ width: `${selectedMarket.yesPrice}%` }}></div></div>
                </div>
                <div>
                  <span>No case</span>
                  <div className="bar-track alt"><div style={{ width: `${selectedMarket.noPrice}%` }}></div></div>
                </div>
              </div>
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
          <div className="signal-box pulse-card">
            <p className="section-label">Signal board</p>
            <ul className="clean-list compact">
              <li>2 markets have fresh catalysts inside 24h</li>
              <li>Macro room conviction is rising faster than price</li>
              <li>IPO debate has the biggest disagreement spread</li>
            </ul>
          </div>
        </aside>
      </section>

      <section className="feature-section" id="features">
        <div className="feature-heading">
          <p className="eyebrow">THE PRODUCT LOOP</p>
          <h2>Built for how serious market nerds actually operate.</h2>
        </div>
        <div className="feature-grid">
          {featureRail.map((item, index) => (
            <article key={item.title} className="feature-card">
              <span className="feature-index">0{index + 1}</span>
              <h3>{item.title}</h3>
              <p className="body-copy">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="closing-banner">
        <div>
          <p className="eyebrow">POSITIONING</p>
          <h2>Letterboxd for prediction markets — but built for actual edge.</h2>
        </div>
        <p className="body-copy">
          Less screenshot chaos. More memory, better collaboration, cleaner conviction,
          and a product that turns live markets into compounding research.
        </p>
      </section>
    </main>
  )
}

export default App
