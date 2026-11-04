import { useEffect, useMemo, useRef, useState } from 'react'
import { api, compactUsd, pct, qs, shortDate, signedUsd, type LeaderRow, type PMEvent } from '../api'
import { PriceChart, SERIES_COLORS, useHistory } from '../components/Chart'
import { CATEGORIES } from '../components/Header'
import { LiveTicker } from '../components/Motion'
import { Avatar, CardSkeleton, Empty, Img, MarketCard, ModeBadge, useEvents } from '../components/ui'
import { Icon, type IconName } from '../icons'
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
  useStream((e) => e.type === 'trade' || e.type === 'resolve', () => void load(), 5000)
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

const SORTS: { id: string; label: string; icon?: IconName; hint: string }[] = [
  { id: 'trending', label: 'Trending', icon: 'trending', hint: 'Polymarket’s 24h volume rank' },
  { id: 'volume24h', label: '24h volume', icon: 'activity', hint: 'Most traded in the last 24 hours' },
  { id: 'movers', label: 'Biggest movers', icon: 'flame', hint: 'Largest 24h price change' },
  { id: 'volatile', label: 'Most volatile', icon: 'zap', hint: 'Widest high-low range in the last hour (live)' },
  { id: 'movers1h', label: 'Moving now', hint: 'Largest price change in the last hour (live)' },
  { id: 'competitive', label: 'Toss-ups', hint: 'Liquid markets closest to 50%' },
  { id: 'liquidity', label: 'Liquidity', hint: 'Deepest order books' },
  { id: 'volume', label: 'All-time volume', hint: 'Most traded ever' },
  { id: 'spread', label: 'Tightest spread', hint: 'Cheapest to trade in and out of' },
  { id: 'new', label: 'Newest', hint: 'Recently listed' },
  { id: 'ending', label: 'Ending soon', hint: 'Closest end date first' },
]

const FILTERS: { key: string; label: string; options: [string, string][] }[] = [
  { key: 'ends', label: 'Ends', options: [['', 'Any time'], ['1d', 'Within 24h'], ['1w', 'This week'], ['1m', 'This month']] },
  { key: 'band', label: 'Odds', options: [['', 'Any odds'], ['tossup', 'Toss-ups 35–65%'], ['longshot', 'Long shots <15%'], ['favorite', 'Favorites >85%']] },
  { key: 'kind', label: 'Type', options: [['', 'All types'], ['binary', 'Yes / No'], ['multi', 'Multi-outcome']] },
  { key: 'minVol', label: '24h volume', options: [['', 'Any volume'], ['10000', '$10K+'], ['100000', '$100K+'], ['1000000', '$1M+']] },
  { key: 'minLiq', label: 'Liquidity', options: [['', 'Any liquidity'], ['10000', '$10K+'], ['100000', '$100K+'], ['1000000', '$1M+']] },
]

/** What a sort is about, shown on each card so the ranking is legible. */
function metricFor(sort: string, e: PMEvent): string | null {
  const open = e.markets.filter((m) => m.active)
  const live = open.filter((m) => m.price > 0.02 && m.price < 0.98 && m.volume24h > 25_000)
  const top = (f: (m: PMEvent['markets'][number]) => number, pool = live) => pool.reduce<{ m: (typeof pool)[number] | null; v: number }>((b, m) => (f(m) > b.v ? { m, v: f(m) } : b), { m: null, v: -1 })
  if (sort === 'movers') {
    const { m } = top((m) => Math.abs(m.change24h ?? 0))
    if (!m?.change24h) return null
    return `${m.change24h >= 0 ? '↗' : '↘'} ${Math.abs(Math.round(m.change24h * 100))}pt 24h${open.length > 1 ? ` · ${m.title}` : ''}`
  }
  if (sort === 'movers1h' || sort === 'volatile') {
    const key = sort === 'volatile' ? 'range1h' : 'move1h'
    const { m } = top((m) => Math.abs(m[key] ?? 0))
    const v = m?.[key] ?? 0
    if (!m || !v) return null
    const pts = Math.abs(v * 100).toFixed(1)
    return sort === 'volatile' ? `⚡ ${pts}pt range 1h${open.length > 1 ? ` · ${m.title}` : ''}` : `${v >= 0 ? '↗' : '↘'} ${pts}pt 1h${open.length > 1 ? ` · ${m.title}` : ''}`
  }
  if (sort === 'volume24h') return `${compactUsd(e.volume24h)} 24h`
  if (sort === 'liquidity') return `${compactUsd(e.liquidity)} liquidity`
  if (sort === 'spread') {
    const { m } = top((m) => (m.bestAsk !== null && m.bestBid !== null ? 1 - (m.bestAsk - m.bestBid) : -1), open)
    return m && m.bestAsk !== null && m.bestBid !== null ? `${Math.round((m.bestAsk - m.bestBid) * 1000) / 10}¢ spread` : null
  }
  if (sort === 'ending' && e.endDate) return `Ends ${shortDate(e.endDate)}`
  if (sort === 'new' && e.createdAt) return `Listed ${shortDate(e.createdAt)}`
  return null
}

/** Paged event list that appends as you scroll. Resets whenever the query changes. */
function useInfiniteEvents(params: Record<string, string | number | undefined | null>, deps: unknown[]) {
  const key = qs(params)
  const [state, setState] = useState<{ key: string; events: PMEvent[]; total: number; loading: boolean; error: string | null }>(
    { key: '', events: [], total: 0, loading: true, error: null })
  const loadingRef = useRef(false)
  const load = (offset: number, k: string) => {
    loadingRef.current = true
    setState((st) => ({ ...st, loading: true }))
    api<{ total: number; events: PMEvent[] }>(`/api/events${qs({ ...params, limit: PAGE, offset, compact: 1 })}`)
      .then((d) => setState((st) => {
        if (offset && st.key !== k) return st
        const seen = new Set(offset ? st.events.map((e) => e.id) : [])
        return { key: k, total: d.total, loading: false, error: null, events: [...(offset ? st.events : []), ...d.events.filter((e) => !seen.has(e.id))] }
      }))
      .catch((e: Error) => setState((st) => ({ ...st, loading: false, error: e.message })))
      .finally(() => { loadingRef.current = false })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(0, key) }, [key, ...deps])
  const more = () => {
    if (loadingRef.current || state.key !== key || state.events.length >= state.total) return
    load(state.events.length, key)
  }
  const fresh = state.key === key
  return { events: fresh ? state.events : [], total: state.total, ready: fresh, loading: state.loading, error: state.error, more, done: fresh && state.events.length >= state.total }
}

function Sentinel({ onVisible, active }: { onVisible: () => void; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onVisible)
  cb.current = onVisible
  useEffect(() => {
    if (!active || !ref.current) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && cb.current(), { rootMargin: '1200px 0px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [active])
  return <div ref={ref} className="scroll-sentinel" aria-hidden />
}

export function Home() {
  const { query } = useLocation()
  const { leagueId, league } = useApp()
  const tag = query.get('tag') ?? 'trending'
  const q = query.get('q') ?? ''
  const sort = query.get('sort') ?? ''
  const filters = Object.fromEntries(FILTERS.map((f) => [f.key, query.get(f.key) ?? '']))
  const [sub, setSub] = useState<string | null>(null)
  const [search, setSearch] = useState(q)
  const [showFilters, setShowFilters] = useState(() => FILTERS.some((f) => query.get(f.key)))
  const cat = CATEGORIES.find((c) => c.slug === tag)
  useTitle(q ? `Search: ${q}` : cat && tag !== 'trending' ? cat.label : '')
  useEffect(() => { setSub(null) }, [tag])
  useEffect(() => { setSearch(q) }, [q])

  const setParams = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(query)
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k)
    const s = p.toString()
    navigate(`/${s ? `?${s}` : ''}`, { replace: true })
  }
  // debounce typing into the URL
  useEffect(() => {
    if (search === q) return
    const t = setTimeout(() => setParams({ q: search.trim() || null }), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const effectiveTag = sub ?? (tag === 'trending' ? undefined : tag)
  const list = useInfiniteEvents(
    { league: leagueId, tag: effectiveTag, q, sort: sort || undefined, ...filters },
    [league?.marketScope, league?.enabledEvents.length, league?.disabledMarkets.length],
  )
  const featured = useEvents(qs({ league: leagueId, limit: 8 }))
  const breaking = useEvents(qs({ league: leagueId, tag: 'breaking', limit: 3 }))
  const showHero = tag === 'trending' && !q && !sort && !FILTERS.some((f) => filters[f.key])
  const events = list.events
  const subChips = tag === 'trending' ? CATEGORIES.filter((c) => !['|', 'trending', 'breaking', 'new'].includes(c.slug)).slice(0, 10) : []
  const activeFilters = FILTERS.filter((f) => filters[f.key]).length
  const sortInfo = SORTS.find((x) => x.id === sort)

  return (
    <div className="wrap page home">
      {showHero && <LiveTicker />}
      {showHero && (
        <section className="hero">
          <div className="aurora" aria-hidden><i /><i /><i /></div>
          <Featured events={featured.data?.events ?? []} />
          <Sidebar breaking={breaking.data?.events ?? []} />
        </section>
      )}
      <div className="section-head markets-head">
        <h2>{q ? `Results for “${q}”` : tag === 'trending' ? 'All markets' : cat?.label ?? 'Markets'}</h2>
        {list.ready && <span className="count">{list.total.toLocaleString()} events</span>}
        <span className="live-pill" title="Prices stream live from Polymarket"><i />Live</span>
        <span className="grow" />
        <label className="inline-search">
          <Icon name="search" size={16} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search markets or outcomes" aria-label="Search markets" />
          {search && <button onClick={() => setSearch('')} aria-label="Clear search"><Icon name="x" size={14} /></button>}
        </label>
        <button className={`pill filter-toggle ${showFilters || activeFilters ? 'on' : ''}`} onClick={() => setShowFilters(!showFilters)}>
          <Icon name="settings" size={16} /> Filters{activeFilters ? <b>{activeFilters}</b> : null}
        </button>
      </div>
      <div className="sort-row" role="tablist" aria-label="Sort markets">
        {SORTS.map((x) => (
          <button key={x.id} role="tab" aria-selected={(sort || 'trending') === x.id} title={x.hint}
            className={(sort || 'trending') === x.id ? 'active' : ''} onClick={() => setParams({ sort: x.id === 'trending' ? null : x.id })}>
            {x.icon && <Icon name={x.icon} size={15} />}{x.label}
          </button>
        ))}
      </div>
      {showFilters && (
        <div className="filter-panel">
          {FILTERS.map((f) => (
            <label key={f.key} className="filter-field">
              <span>{f.label}</span>
              <select value={filters[f.key]} onChange={(e) => setParams({ [f.key]: e.target.value || null })}>
                {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          ))}
          {activeFilters > 0 && <button className="link-btn" onClick={() => setParams(Object.fromEntries(FILTERS.map((f) => [f.key, null])))}>Clear filters</button>}
        </div>
      )}
      {subChips.length > 0 && (
        <div className="chips-row">
          <button className={!sub ? 'active' : ''} onClick={() => setSub(null)}>All</button>
          {subChips.map((c) => <button key={c.slug} className={sub === c.slug ? 'active' : ''} onClick={() => setSub(c.slug)}>{c.label}</button>)}
        </div>
      )}
      {sortInfo && sort && <p className="sort-hint">{sortInfo.hint}</p>}
      {list.error && <Empty title="Couldn't load markets">{list.error}. Is the API reachable?</Empty>}
      {tag === 'league' && list.ready && !events.length && (
        <Empty title="No league markets yet">Markets show up here once someone in your league places an order. Find something on Trending and make the first bid.</Empty>
      )}
      {league?.marketScope === 'curated' && list.ready && !events.length && tag !== 'league' && (
        <Empty title="Nothing enabled here">This league only allows hand-picked markets. <Link to="/league">Manage markets</Link></Empty>
      )}
      {list.ready && !events.length && tag !== 'league' && league?.marketScope !== 'curated' && !list.error && (
        <Empty title="No markets match">Try a broader filter or a different search.</Empty>
      )}
      <div className="grid">
        {events.map((e, i) => <MarketCard key={e.id} event={e} index={i} metric={sort ? metricFor(sort, e) : null} />)}
        {(!list.ready || (list.loading && !list.done)) && Array.from({ length: list.ready ? 4 : 12 }, (_, i) => <CardSkeleton key={`s${i}`} />)}
      </div>
      <Sentinel active={list.ready && !list.done} onVisible={list.more} />
      {list.done && events.length > PAGE && <p className="end-of-list">That’s all {list.total.toLocaleString()} markets</p>}
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
