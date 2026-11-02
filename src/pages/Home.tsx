import { useEffect, useMemo, useState } from 'react'
import { api, compactUsd, pct, qs, shortDate, signedUsd, type LeaderRow, type PMEvent } from '../api'
import { PriceChart, SERIES_COLORS, useHistory } from '../components/Chart'
import { CATEGORIES } from '../components/Header'
import { LiveTicker } from '../components/Motion'
import { Avatar, CardSkeleton, Empty, Img, MarketCard, ModeBadge, useEvents } from '../components/ui'
import { Icon } from '../icons'
import { Link, navigate, useLocation, useTitle } from '../router'
import { useApp, useStream } from '../store'

const PAGE = 24

function Featured({ events }: { events: PMEvent[] }) {
  const [i, setI] = useState(0)
  const ev = events[i]
  const markets = useMemo(() => {
    if (!ev) return []
    const open = ev.markets.filter((m) => m.active)
    if (open.length <= 1) return open.slice(0, 1)
    // same rule as cards: one-winner events by chance, other groups (game lines, dates) in Polymarket order
    const live = open.filter((m) => m.price > 0.005 && m.price < 0.995)
    const pool = live.length >= 2 ? live : open
    return (ev.negRisk ? [...pool].sort((a, b) => b.price - a.price) : pool).slice(0, 4)
  }, [ev])
  const hist = useHistory(markets.map((m) => m.id), '1W')
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % Math.max(1, events.length)), 12_000)
    return () => clearInterval(t)
  }, [events.length])
  if (!ev) return <div className="featured card skeleton" />
  const multi = ev.markets.length > 1
  return (
    <div className="featured-wrap">
      <Link to={`/event/${ev.slug}`} className="featured card">
        <div className="feat-head">
          <Img src={ev.icon} size={40} radius={8} />
          <div className="feat-crumbs">{ev.tags.slice(0, 3).map((t) => t.label).join(' · ')}</div>
        </div>
        <h2 className="feat-title">{ev.title}</h2>
        <div className="feat-body">
          <div className="feat-list">
            {markets.map((m, k) => (
              <div className="feat-row" key={m.id}>
                {multi && <i className="dot" style={{ background: SERIES_COLORS[k] }} />}
                <span className="ellipsis">{multi ? m.title : 'Chance'}</span>
                <b>{pct(m.price)}</b>
              </div>
            ))}
          </div>
          <div className="feat-chart">
            <PriceChart height={240} endLabels={multi}
              series={markets.map((m, k) => ({ id: m.id, name: multi ? m.title : m.outcomes[0], color: SERIES_COLORS[k], points: hist[m.id] ?? [] }))} />
          </div>
        </div>
        <div className="feat-foot">
          <span>{compactUsd(ev.volume)} Vol</span>
          <span className="grow" />
          {ev.endDate && <span>Ends {shortDate(ev.endDate)}</span>}
        </div>
      </Link>
      <div className="feat-pager">
        <div className="dots">
          {events.map((e, k) => <button key={e.id} className={k === i ? 'active' : ''} onClick={() => setI(k)} aria-label={`Show ${e.title}`} />)}
        </div>
        <span className="grow" />
        <button className="pill" onClick={() => setI((i - 1 + events.length) % events.length)}><Icon name="chevronLeft" size={16} /> Prev</button>
        <button className="pill" onClick={() => setI((i + 1) % events.length)}>Next <Icon name="chevronRight" size={16} /></button>
      </div>
    </div>
  )
}

function Sidebar({ breaking }: { breaking: PMEvent[] }) {
  const { user, leagueId, league, openAuth } = useApp()
  const [board, setBoard] = useState<LeaderRow[] | null>(null)
  const load = () => leagueId ? api<LeaderRow[]>(`/api/leagues/${leagueId}/leaderboard`).then(setBoard).catch(() => {}) : setBoard(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [leagueId])
  useStream((e) => e.type === 'trade' || e.type === 'resolve', () => void load())
  return (
    <aside className="home-side">
      <Link to="/?tag=breaking" className="side-title">Breaking news <Icon name="chevronRight" size={16} /></Link>
      <ol className="breaking">
        {breaking.slice(0, 3).map((e, k) => {
          const m = [...e.markets].sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))[0]
          const ch = m?.change24h ?? 0
          return (
            <li key={e.id}>
              <Link to={`/event/${e.slug}`}>
                <span className="rank">{k + 1}</span>
                <span className="b-title">{e.markets.length > 1 && m ? `${e.title}: ${m.title}` : e.title}</span>
                <span className="b-num"><b>{m ? pct(m.price) : ''}</b><small className={ch >= 0 ? 'yes-accent' : 'no-color'}>{ch >= 0 ? '↗' : '↘'} {Math.abs(Math.round(ch * 100))}%</small></span>
              </Link>
            </li>
          )
        })}
      </ol>
      <div className="side-sep" />
      {user && league ? (
        <>
          <Link to="/leaderboard" className="side-title">{league.name} <ModeBadge mode={league.mode} /> <Icon name="chevronRight" size={16} /></Link>
          <ol className="mini-board">
            {(board ?? []).slice(0, 5).map((r) => (
              <li key={r.userId}>
                <span className="rank">{r.rank}</span>
                <Avatar user={r} size={24} />
                <span className="grow ellipsis">{r.displayName}</span>
                <b className={r.pnl >= 0 ? 'yes-accent' : 'no-color'}>{signedUsd(r.pnl)}</b>
              </li>
            ))}
          </ol>
          <Link to="/league" className="pill pill-wide">Invite friends · {league.inviteCode}</Link>
        </>
      ) : (
        <div className="side-pitch">
          <h3>Play Polymarket with your friends</h3>
          <p><b>Mirror</b> leagues fill against the real Polymarket book. <b>Exchange</b> leagues run their own order book for 20–30 friends. Everything resolves exactly like Polymarket.</p>
          <p>Hook up your coding agent over <b>MCP</b> or upload bots that run on our servers.</p>
          <button className="pill pill-wide" onClick={() => (user ? navigate('/league?new=1') : openAuth('signup'))}>{user ? 'Create a league' : 'Get started'}</button>
        </div>
      )}
    </aside>
  )
}

export function Home() {
  const { query } = useLocation()
  const { leagueId, league } = useApp()
  const tag = query.get('tag') ?? 'trending'
  const q = query.get('q') ?? ''
  const [pages, setPages] = useState(1)
  const [sub, setSub] = useState<string | null>(null)
  const cat = CATEGORIES.find((c) => c.slug === tag)
  useTitle(q ? `Search: ${q}` : cat && tag !== 'trending' ? cat.label : '')
  useEffect(() => { setPages(1); setSub(null) }, [tag, q])
  const effectiveTag = sub ?? (tag === 'trending' ? undefined : tag)
  const { data, error } = useEvents(qs({ league: leagueId, tag: effectiveTag, q, limit: PAGE * pages }), [league?.marketScope, league?.enabledEvents.length, league?.disabledMarkets.length])
  const breaking = useEvents(qs({ league: leagueId, tag: 'breaking', limit: 3 }))
  const showHero = tag === 'trending' && !q
  const events = data?.events ?? []
  const subChips = showHero ? CATEGORIES.filter((c) => !['|', 'trending', 'breaking', 'new'].includes(c.slug)).slice(0, 10) : []

  return (
    <div className="wrap page home">
      {showHero && <LiveTicker />}
      {showHero && (
        <section className="hero">
          <div className="aurora" aria-hidden><i /><i /><i /></div>
          <Featured events={events.slice(0, 8)} />
          <Sidebar breaking={breaking.data?.events ?? []} />
        </section>
      )}
      <div className="section-head">
        <h2>{q ? `Results for “${q}”` : showHero ? 'All markets' : cat?.label ?? 'Markets'}</h2>
        {data && <span className="count">{data.total.toLocaleString()} events</span>}
        <span className="grow" />
        <Link to="/search" className="icon-btn" aria-label="Search"><Icon name="search" /></Link>
      </div>
      {subChips.length > 0 && (
        <div className="chips-row">
          <button className={!sub ? 'active' : ''} onClick={() => setSub(null)}>All</button>
          {subChips.map((c) => <button key={c.slug} className={sub === c.slug ? 'active' : ''} onClick={() => setSub(c.slug)}>{c.label}</button>)}
        </div>
      )}
      {error && <Empty title="Couldn't load markets">{error}. Is the API reachable?</Empty>}
      {tag === 'league' && data && !events.length && (
        <Empty title="No league markets yet">Markets show up here once someone in your league places an order. Find something on Trending and make the first bid.</Empty>
      )}
      {league?.marketScope === 'curated' && data && !events.length && tag !== 'league' && (
        <Empty title="Nothing enabled here">This league only allows hand-picked markets. <Link to="/league">Manage markets</Link></Empty>
      )}
      <div className="grid">
        {!data && Array.from({ length: 12 }, (_, i) => <CardSkeleton key={i} />)}
        {events.map((e, i) => <MarketCard key={e.id} event={e} index={i} />)}
      </div>
      {data && data.total > events.length && (
        <div className="center"><button className="pill" onClick={() => setPages(pages + 1)}>Show more markets</button></div>
      )}
    </div>
  )
}

export function SearchPage() {
  const [q, setQ] = useState('')
  const { leagueId } = useApp()
  const { data } = useEvents(qs({ league: leagueId, q, limit: 30 }))
  useTitle('Search')
  return (
    <div className="wrap page">
      <form className="search search-page" onSubmit={(e) => { e.preventDefault(); navigate(`/?q=${encodeURIComponent(q)}`) }}>
        <Icon name="search" size={18} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search polymarkets..." />
      </form>
      <div className="chips-row wrap-chips">
        {CATEGORIES.filter((c) => c.slug !== '|').map((c) => <Link key={c.slug} to={c.slug === 'trending' ? '/' : `/?tag=${c.slug}`}>{c.label}</Link>)}
      </div>
      <div className="search-list">
        {(data?.events ?? []).map((e) => (
          <Link key={e.id} to={`/event/${e.slug}`} className="search-row">
            <Img src={e.icon} size={40} />
            <span className="grow">{e.title}</span>
            <b>{e.markets.length === 1 ? pct(e.markets[0].price) : ''}</b>
          </Link>
        ))}
      </div>
    </div>
  )
}
