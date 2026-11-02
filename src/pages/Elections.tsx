import { useEffect, useMemo, useState } from 'react'
import { api, compactUsd, pct, qs } from '../api'
import { UsMap, WorldMap } from '../components/ElectionMaps'
import { CardSkeleton, Empty, Img, MarketCard, Spinner, useEvents } from '../components/ui'
import { Icon } from '../icons'
import { Link, navigate, useLocation, useTitle } from '../router'
import { useApp } from '../store'

/* ---------------- data ---------------- */

type Party = 'D' | 'R' | 'O'
type Office = 'senate' | 'house' | 'governor'
type Rating = 'safe-d' | 'likely-d' | 'lean-d' | 'tossup' | 'lean-r' | 'likely-r' | 'safe-r'
type Pair = { D: number; R: number }

interface Race {
  office: Office; state: string; district: string | null; label: string; stateName: string; slug: string; title: string
  image: string; volume: number; dem: number; rep: number; leader: { name: string; party: Party; p: number }
  change24h: number | null; candidates: { marketId: string; name: string; party: Party; p: number }[]
  rating: Rating; incumbent: Party | null
}
interface Control { slug: string; title: string; volume: number; dem: number | null; rep: number | null }
interface ElectionCard {
  slug: string; title: string; image: string; endDate: string | null; volume: number; country: string | null; midterm: boolean
  outcomes: { label: string; p: number }[]; more: number
}
interface ElectionsData {
  syncedAt: number
  control: { senate: Control | null; house: Control | null; balance: { slug: string; outcomes: { label: string; p: number }[] } | null }
  buildMap: { slug: string; title: string; states: string[]; outcomes: { marketId: string; label: string; p: number }[] } | null
  senate: {
    races: Race[]; ratings: Record<Rating, number>
    seats: { total: number; toWin: number; current: Pair; notUp: Pair; unmarketed: Pair; projected: Pair & { tossup: number } }
  }
  house: { races: Race[]; ratings: Record<Rating, number>; seats: { total: number; toWin: number; unmarketed: number; implied: (Pair & { slug: string }) | null } }
  governor: { races: Race[]; ratings: Record<Rating, number>; favored: Pair }
  categories: { slug: string; label: string; count: number }[]
  countries: { name: string; map: string; count: number; volume: number }[]
  events: ElectionCard[]
}

let cache: { at: number; data: ElectionsData } | null = null

function useElections() {
  const [data, setData] = useState<ElectionsData | null>(cache?.data ?? null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (cache && Date.now() - cache.at < 60_000) return
    let live = true
    api<ElectionsData>('/api/elections')
      .then((d) => {
        cache = { at: Date.now(), data: d }
        if (live) setData(d)
      })
      .catch((e) => live && setError(e.message))
    return () => { live = false }
  }, [])
  return { data, error }
}

/* ---------------- shared bits ---------------- */

const RATINGS: { key: Rating; label: string; tier: string }[] = [
  { key: 'safe-d', label: 'Safe D', tier: 'Safe Dem' },
  { key: 'likely-d', label: 'Likely D', tier: 'Likely Dem' },
  { key: 'lean-d', label: 'Lean D', tier: 'Lean Dem' },
  { key: 'tossup', label: 'Toss up', tier: 'Toss up' },
  { key: 'lean-r', label: 'Lean R', tier: 'Lean Rep' },
  { key: 'likely-r', label: 'Likely R', tier: 'Likely Rep' },
  { key: 'safe-r', label: 'Safe R', tier: 'Safe Rep' },
]
const ratingColor = (r: Rating) => `var(--el-${r})`
const tierOf = (r: Rating) => RATINGS.find((x) => x.key === r)!.tier
const OFFICES: { key: Office; label: string }[] = [
  { key: 'senate', label: 'Senate' }, { key: 'house', label: 'House' }, { key: 'governor', label: 'Governor' },
]

/** "74% D": the favored party's chance (Polymarket's race-row format). */
function favored(r: Race) {
  if (r.leader.party === 'O' && r.leader.p > Math.max(r.dem, r.rep)) return { p: r.leader.p, side: 'I', cls: 'oth' }
  return r.dem >= r.rep ? { p: r.dem, side: 'D', cls: 'dem' } : { p: r.rep, side: 'R', cls: 'rep' }
}

const etDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : ''

function useQueryNav() {
  const { path, query } = useLocation()
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(query)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    const s = next.toString()
    navigate(`${path}${s ? `?${s}` : ''}`, { replace: true })
  }
  return { query, set }
}

function ElectionCardView({ e }: { e: ElectionCard }) {
  return (
    <Link to={`/event/${e.slug}`} className="card el-card">
      <div className="el-card-head">
        <Img src={e.image} size={40} />
        <div className="grow">
          <h3>{e.title}</h3>
          {e.endDate && <span className="muted small">{etDate(e.endDate)}</span>}
        </div>
      </div>
      <div className="el-card-rows">
        {e.outcomes.map((o) => (
          <div key={o.label} className="el-card-row"><span className="ellipsis">{o.label || 'Yes'}</span><b>{pct(o.p)}</b></div>
        ))}
      </div>
      <div className="el-card-foot muted small">
        {compactUsd(e.volume)} Vol.{e.more > 0 && <> · {e.more} more</>}
      </div>
    </Link>
  )
}

/* ---------------- /elections: global ---------------- */

function nextMonths(n: number) {
  const d = new Date()
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() + i, 1)
    return { key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, label: m.toLocaleDateString('en-US', { month: 'short' }) }
  })
}
const monthKey = (s: string | null) => {
  if (!s) return ''
  const d = new Date(new Date(s).toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function ElectionsPage() {
  useTitle('Election Odds')
  const { data, error } = useElections()
  const { query, set } = useQueryNav()
  const month = query.get('month')
  const country = query.get('country')
  const [limit, setLimit] = useState(30)
  const months = useMemo(() => nextMonths(12), [])

  const inMonth = useMemo(() => (data?.events ?? []).filter((e) => !month || monthKey(e.endDate) === month), [data, month])
  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const e of inMonth) if (e.country) c.set(e.country, (c.get(e.country) ?? 0) + 1)
    return c
  }, [inMonth])
  const countries = (data?.countries ?? []).filter((c) => !month || counts.has(c.name))
  const byMap = new Map(countries.map((c) => [c.map, c]))
  const shown = inMonth.filter((e) => !country || e.country === country)
  const maxCount = Math.max(1, ...countries.map((c) => (month ? counts.get(c.name) ?? 0 : c.count)))
  const countOf = (c: { name: string; count: number }) => (month ? counts.get(c.name) ?? 0 : c.count)

  return (
    <div className="wrap page elections">
      <div className="el-titlebar">
        <h1>Election Odds</h1>
        <div className="chips-row el-months">
          <button className={!month ? 'active' : ''} onClick={() => set({ month: null })}>All</button>
          {months.map((m) => (
            <button key={m.key} className={month === m.key ? 'active' : ''} onClick={() => set({ month: month === m.key ? null : m.key })}>{m.label}</button>
          ))}
        </div>
        <span className="grow" />
        <Link to="/elections/midterms" className="pill el-midterms-btn"><span className="el-flag" aria-hidden />US Midterms</Link>
      </div>

      <div className="el-world card">
        {data ? (
          <WorldMap
            selected={countries.find((c) => c.name === country)?.map ?? null}
            fill={(name) => {
              const c = byMap.get(name)
              if (!c) return null
              const t = 0.5 + 0.5 * Math.sqrt(countOf(c) / maxCount)
              return `color-mix(in srgb, #4a75ff ${Math.round(t * 100)}%, #262a34)`
            }}
            tooltip={(name) => {
              const c = byMap.get(name)
              return c ? <><b>{c.name}</b><span>{countOf(c)} market{countOf(c) === 1 ? '' : 's'}</span></> : null
            }}
            onPick={(name) => {
              const c = byMap.get(name)
              if (c) set({ country: country === c.name ? null : c.name })
            }}
          />
        ) : <div className="el-map-loading"><Spinner /></div>}
      </div>

      {error && <Empty title="Couldn't load elections">{error}</Empty>}

      <div className="el-body">
        <aside className="el-side">
          <button className={`el-side-item ${!country ? 'active' : ''}`} onClick={() => set({ country: null })}>
            <span className="grow">Global Elections</span><span className="muted">{inMonth.length}</span>
          </button>
          {countries.map((c) => (
            <button key={c.name} className={`el-side-item ${country === c.name ? 'active' : ''}`} onClick={() => set({ country: country === c.name ? null : c.name })}>
              <span className="grow">{c.name}</span><span className="muted">{countOf(c)}</span>
            </button>
          ))}
        </aside>
        <div className="el-main">
          {country === 'United States' && (
            <Link to="/elections/midterms" className="el-banner card">
              <b>2026 US Midterms</b><span className="muted">Senate, House and governor races on a state map</span><Icon name="chevronRight" size={16} />
            </Link>
          )}
          <div className="el-grid">
            {!data && Array.from({ length: 9 }, (_, i) => <CardSkeleton key={i} />)}
            {shown.slice(0, limit).map((e) => <ElectionCardView key={e.slug} e={e} />)}
          </div>
          {data && !shown.length && <Empty title="No elections here">Nothing in the catalog matches this month and country.</Empty>}
          {shown.length > limit && <div className="center"><button className="pill" onClick={() => setLimit(limit + 30)}>Show more</button></div>}
        </div>
      </div>
    </div>
  )
}

/* ---------------- /elections/midterms ---------------- */

export function MidtermsPage() {
  useTitle('2026 Midterms')
  const { data, error } = useElections()
  const { query, set } = useQueryNav()
  const cat = query.get('cat')
  const build = query.get('build') === '1'
  const office = (OFFICES.find((o) => o.key === query.get('office'))?.key ?? 'senate') as Office

  const nav = (
    <aside className="mt-side">
      <button className={`mt-side-item ${!cat && !build ? 'active' : ''}`} onClick={() => set({ cat: null, build: null })}>
        <Icon name="globe" size={16} /> Overview
      </button>
      <button className={`mt-side-item ${build ? 'active' : ''}`} onClick={() => set({ cat: null, build: '1', office: null })}>
        <Icon name="swap" size={16} /> Build your map
      </button>
      <span className="mt-side-sep" />
      {(data?.categories ?? []).map((c) => (
        <button key={c.slug} className={`mt-side-item ${cat === c.slug ? 'active' : ''}`} onClick={() => set({ cat: c.slug, build: null })}>
          <span className="grow">{c.label}</span><span className="muted">{c.count.toLocaleString()}</span>
        </button>
      ))}
    </aside>
  )

  return (
    <div className="wrap page midterms">
      <div className="mt-layout">
        {nav}
        <div className="mt-main">
          {error && <Empty title="Couldn't load the midterms">{error}</Empty>}
          {!data && !error && <div className="el-map-loading"><Spinner /></div>}
          {data && (cat ? <CategoryGrid slug={cat} label={data.categories.find((c) => c.slug === cat)?.label ?? 'Markets'} />
            : build ? <BuildMap data={data} />
              : <MidtermOverview data={data} office={office} />)}
        </div>
      </div>
    </div>
  )
}

function CategoryGrid({ slug, label }: { slug: string; label: string }) {
  const { leagueId } = useApp()
  const [pages, setPages] = useState(1)
  const { data, error } = useEvents(qs({ league: leagueId, tag: slug, limit: 24 * pages, sort: 'volume' }))
  return (
    <>
      <div className="section-head"><h2>{label}</h2>{data && <span className="count">{data.total.toLocaleString()} events</span>}</div>
      {error && <Empty title="Couldn't load markets">{error}</Empty>}
      <div className="grid mt-grid">
        {!data && Array.from({ length: 9 }, (_, i) => <CardSkeleton key={i} />)}
        {data?.events.map((e, i) => <MarketCard key={e.id} event={e} index={i} />)}
      </div>
      {data && data.total > data.events.length && (
        <div className="center"><button className="pill" onClick={() => setPages(pages + 1)}>Show more markets</button></div>
      )}
    </>
  )
}

/* ----- seat bar ----- */

function SeatBar({ segments, total, toWin, left, right }: {
  segments: { key: string; n: number; color: string; title: string }[]
  total: number
  toWin?: number
  left: { n: number; sub?: string }
  right: { n: number; sub?: string }
}) {
  return (
    <div className="seatbar">
      <div className="seatbar-top">
        <span className="dem-n"><b>{left.n}</b> DEM</span>
        {toWin && <span className="muted small">{toWin} to win</span>}
        <span className="rep-n">REP <b>{right.n}</b></span>
      </div>
      <div className="seatbar-track">
        {segments.filter((s) => s.n > 0).map((s) => (
          <i key={s.key} style={{ flexGrow: s.n, background: s.color }} title={`${s.title}: ${s.n}`} />
        ))}
        {toWin && <span className="seatbar-mark" style={{ left: `${((toWin - 0.5) / total) * 100}%` }} />}
      </div>
      {(left.sub || right.sub) && <div className="seatbar-sub muted small"><span>{left.sub}</span><span>{right.sub}</span></div>}
    </div>
  )
}

function officeSeats(data: ElectionsData, office: Office) {
  if (office === 'senate') {
    const s = data.senate.seats
    const seg = data.senate.ratings
    return (
      <SeatBar total={100} toWin={s.toWin}
        left={{ n: s.projected.D, sub: `${s.current.D} current` }} right={{ n: s.projected.R, sub: `${s.current.R} current` }}
        segments={[
          { key: 'hold-d', n: s.notUp.D + s.unmarketed.D, color: 'var(--el-hold-d)', title: 'Democratic seats not up' },
          ...RATINGS.map((r) => ({ key: r.key, n: seg[r.key], color: ratingColor(r.key), title: r.label })),
          { key: 'hold-r', n: s.notUp.R + s.unmarketed.R, color: 'var(--el-hold-r)', title: 'Republican seats not up' },
        ]} />
    )
  }
  const races = office === 'house' ? data.house.races : data.governor.races
  const r = office === 'house' ? data.house.ratings : data.governor.ratings
  const dem = r['safe-d'] + r['likely-d'] + r['lean-d']
  const rep = r['safe-r'] + r['likely-r'] + r['lean-r']
  const segs: { key: string; n: number; color: string; title: string }[] = RATINGS.map((x) => ({ key: x.key, n: r[x.key], color: ratingColor(x.key), title: x.label }))
  if (office === 'house') {
    const implied = data.house.seats.implied
    segs.splice(4, 0, { key: 'none', n: data.house.seats.unmarketed, color: 'var(--el-none)', title: 'No market' })
    return (
      <SeatBar total={435} toWin={218} left={{ n: dem, sub: implied ? `Seat markets imply ~${implied.D}` : undefined }}
        right={{ n: rep, sub: `${data.house.seats.unmarketed} seats without a market` }} segments={segs} />
    )
  }
  return <SeatBar total={races.length} left={{ n: dem, sub: `${races.length} races on the ballot` }} right={{ n: rep }} segments={segs} />
}

/* ----- overview ----- */

function stateFills(races: Race[], office: Office, tier: Rating | null) {
  const out = new Map<string, { color: string; races: Race[] }>()
  if (office !== 'house') {
    for (const r of races) out.set(r.state, { color: !tier || tier === r.rating ? ratingColor(r.rating) : 'var(--el-dim)', races: [r] })
    return out
  }
  const by = new Map<string, Race[]>()
  for (const r of races) by.set(r.state, [...(by.get(r.state) ?? []), r])
  for (const [state, rs] of by) {
    const d = rs.filter((r) => r.dem > r.rep && r.rating !== 'tossup').length
    const rp = rs.filter((r) => r.rep > r.dem && r.rating !== 'tossup').length
    const share = d / rs.length - rp / rs.length
    const rating: Rating = share >= 0.5 ? 'safe-d' : share >= 0.2 ? 'likely-d' : share > 0 ? 'lean-d'
      : share <= -0.5 ? 'safe-r' : share <= -0.2 ? 'likely-r' : share < 0 ? 'lean-r' : 'tossup'
    const match = !tier || rs.some((r) => r.rating === tier)
    out.set(state, { color: match ? ratingColor(rating) : 'var(--el-dim)', races: rs })
  }
  return out
}

function MidtermOverview({ data, office }: { data: ElectionsData; office: Office }) {
  const { query, set } = useQueryNav()
  const tier = (query.get('tier') as Rating | null) ?? null
  const stateFilter = query.get('state')
  const races = data[office].races
  const ctl = office === 'senate' ? data.control.senate : office === 'house' ? data.control.house : null
  const fills = useMemo(() => stateFills(races, office, tier), [races, office, tier])
  const states = [...new Set(races.map((r) => r.state))].sort()
  const ratings = data[office].ratings

  const tabPct = (o: Office) => {
    if (o === 'governor') {
      const f = data.governor.favored
      return f.D || f.R ? `${f.D}–${f.R}` : null
    }
    const c = o === 'senate' ? data.control.senate : data.control.house
    return c?.dem != null ? pct(c.dem) : null
  }

  const headline = (() => {
    if (ctl && ctl.dem !== null && ctl.rep !== null) {
      const dem = ctl.dem >= ctl.rep
      return <><span className={dem ? 'dem' : 'rep'}>{dem ? 'Democrats' : 'Republicans'}</span> have a <span className={dem ? 'dem' : 'rep'}>{pct(dem ? ctl.dem : ctl.rep)} chance</span> of controlling the {office === 'senate' ? 'Senate' : 'House'}</>
    }
    const f = data.governor.favored
    const dem = f.D >= f.R
    return <><span className={dem ? 'dem' : 'rep'}>{dem ? 'Democrats' : 'Republicans'}</span> are favored in <span className={dem ? 'dem' : 'rep'}>{dem ? f.D : f.R} of {races.length}</span> governor races</>
  })()

  const sideRaces = office === 'senate'
    ? races.slice(0, 16)
    : [...races].sort((a, b) => Math.abs(a.dem - a.rep) - Math.abs(b.dem - b.rep) || b.volume - a.volume).slice(0, 16)
  const listRaces = stateFilter ? races.filter((r) => r.state === stateFilter) : sideRaces

  return (
    <>
      <div className="mt-tabs" role="tablist">
        {OFFICES.filter((o) => data[o.key].races.length > 0).map((o) => (
          <button key={o.key} role="tab" aria-selected={office === o.key} className={office === o.key ? 'active' : ''}
            onClick={() => set({ office: o.key === 'senate' ? null : o.key, state: null, tier: null })}>
            {o.label} {tabPct(o.key) && <span>{tabPct(o.key)}</span>}
          </button>
        ))}
      </div>

      <section className="mt-hero card">
        <h1>{headline}</h1>
        {ctl && (
          <div className="mt-hero-pills">
            {ctl.dem !== null && <Link to={`/event/${ctl.slug}`} className="hp dem">DEM <b>{pct(ctl.dem)}</b></Link>}
            {ctl.rep !== null && <Link to={`/event/${ctl.slug}`} className="hp rep">REP <b>{pct(ctl.rep)}</b></Link>}
          </div>
        )}
      </section>

      {officeSeats(data, office)}

      <div className="mt-mapgrid">
        <div className="mt-mapcol">
          <div className="mt-filters">
            <select value={stateFilter ?? ''} onChange={(e) => set({ state: e.target.value || null })} aria-label="Filter by state">
              <option value="">All states</option>
              {states.map((s) => <option key={s} value={s}>{races.find((r) => r.state === s)?.stateName ?? s}</option>)}
            </select>
            <div className="chips-row mt-chips">
              {RATINGS.filter((r) => ratings[r.key] > 0).map((r) => (
                <button key={r.key} className={tier === r.key ? 'active' : ''} onClick={() => set({ tier: tier === r.key ? null : r.key })}>
                  <i className="dot" style={{ background: ratingColor(r.key) }} />{r.label} <span className="muted">{ratings[r.key]}</span>
                </button>
              ))}
            </div>
          </div>
          <UsMap
            selected={stateFilter}
            fill={(s) => fills.get(s)?.color ?? null}
            tooltip={(s) => <RaceTip races={fills.get(s)?.races ?? []} office={office} state={s} />}
            onPick={(s) => {
              const f = fills.get(s)
              if (!f) return
              if (office !== 'house' && f.races.length === 1) navigate(`/event/${f.races[0].slug}`)
              else set({ state: stateFilter === s ? null : s })
            }}
          />
        </div>
        <div className="mt-sidecol">
          {office === 'senate' && (
            <button className="mt-build card" onClick={() => set({ build: '1', office: null, state: null, tier: null })}>
              <b>Build your map</b>
              <span>Pick the {data.buildMap?.states.length || 7} closest Senate races.</span>
              <Icon name="chevronRight" size={18} />
            </button>
          )}
          {stateFilter && <button className="mt-clear" onClick={() => set({ state: null })}><Icon name="x" size={14} /> {races.find((r) => r.state === stateFilter)?.stateName ?? stateFilter}</button>}
          <ul className="mt-racelist">
            {listRaces.map((r) => <RaceRow key={r.slug} r={r} />)}
          </ul>
        </div>
      </div>

      <RaceSearch data={data} />

      <Storyline data={data} />
      <RacesTable races={races} office={office} />
    </>
  )
}

function RaceTip({ races, office, state }: { races: Race[]; office: Office; state: string }) {
  if (!races.length) return <><b>{state}</b><span>No {office} race market</span></>
  if (office === 'house') {
    const d = races.filter((r) => r.dem > r.rep).length
    return <><b>{races[0].stateName}</b><span>{races.length} district market{races.length === 1 ? '' : 's'} · {d} lean D · {races.length - d} lean R</span></>
  }
  const r = races[0]
  const f = favored(r)
  return <><b>{r.label}</b><span>{r.leader.name} · <em className={f.cls}>{pct(f.p)} {f.side}</em></span><span>{tierOf(r.rating)}</span></>
}

function RaceRow({ r }: { r: Race }) {
  const f = favored(r)
  return (
    <li>
      <Link to={`/event/${r.slug}`} className="mt-race">
        <i className="dot" style={{ background: ratingColor(r.rating) }} />
        <span className="grow ellipsis">{r.label}</span>
        <b className={f.cls}>{pct(f.p)} {f.side}</b>
        <span className="mt-race-bar"><i className="dem" style={{ flexGrow: r.dem }} /><i className="rep" style={{ flexGrow: r.rep }} /></span>
      </Link>
    </li>
  )
}

function RaceSearch({ data }: { data: ElectionsData }) {
  const [q, setQ] = useState('')
  const all = useMemo(() => [...data.senate.races, ...data.governor.races, ...data.house.races], [data])
  const needle = q.trim().toLowerCase()
  const hits = needle
    ? all.filter((r) => `${r.label} ${r.stateName} ${r.state} ${r.candidates.map((c) => c.name).join(' ')}`.toLowerCase().includes(needle)).slice(0, 8)
    : []
  const pill = (c: Control | null, label: string) => c && c.dem !== null && (
    <Link to={`/event/${c.slug}`} className="rs-pill">{label} <b>{pct(c.dem)} DEM</b></Link>
  )
  return (
    <div className="race-search">
      {hits.length > 0 && (
        <ul className="rs-hits card">
          {hits.map((r) => <RaceRow key={r.slug} r={r} />)}
        </ul>
      )}
      <div className="rs-bar">
        <Icon name="search" size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a race" aria-label="Find a race" />
        {pill(data.control.house, 'House')}
        {pill(data.control.senate, 'Senate')}
      </div>
    </div>
  )
}

function Storyline({ data }: { data: ElectionsData }) {
  const cards = data.events.filter((e) => e.midterm).slice(0, 4)
  if (!cards.length) return null
  return (
    <section className="mt-section">
      <h2>National storyline <span className="muted">top overall markets</span></h2>
      <div className="el-grid el-grid-4">{cards.map((e) => <ElectionCardView key={e.slug} e={e} />)}</div>
    </section>
  )
}

function RacesTable({ races, office }: { races: Race[]; office: Office }) {
  const [party, setParty] = useState('')
  const [tier, setTier] = useState('')
  const [state, setState] = useState('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(25)
  const states = [...new Set(races.map((r) => r.state))].sort()
  const needle = q.trim().toLowerCase()
  const rows = races.filter((r) =>
    (!party || favored(r).side === party) && (!tier || r.rating === tier) && (!state || r.state === state) &&
    (!needle || `${r.label} ${r.stateName} ${r.leader.name}`.toLowerCase().includes(needle)))
  const label = OFFICES.find((o) => o.key === office)!.label
  return (
    <section className="mt-section">
      <h2>{label} races <span className="muted">{races.length} markets</span></h2>
      <div className="mt-table-filters">
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label="State"><option value="">All states</option>{states.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={party} onChange={(e) => setParty(e.target.value)} aria-label="Party"><option value="">All parties</option><option value="D">Democrat</option><option value="R">Republican</option></select>
        <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Tier"><option value="">All tiers</option>{RATINGS.map((r) => <option key={r.key} value={r.key}>{r.tier}</option>)}</select>
        <label className="mt-table-search"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" /></label>
      </div>
      <div className="mt-table-wrap">
        <table className="mt-table">
          <thead><tr><th>Race</th><th className="hide-sm">State</th><th>Chance</th><th>Candidate</th><th className="hide-sm">Tier</th><th className="num">Vol</th><th className="num hide-sm">24h</th></tr></thead>
          <tbody>
            {rows.slice(0, limit).map((r) => {
              const f = favored(r)
              return (
                <tr key={r.slug} onClick={() => navigate(`/event/${r.slug}`)}>
                  <td><Link to={`/event/${r.slug}`}><b>{office === 'house' ? r.label : `${r.state} ${label}`}</b></Link></td>
                  <td className="hide-sm muted">{r.stateName}</td>
                  <td className={f.cls}>{pct(f.p)} {f.side === 'D' ? 'DEM' : f.side === 'R' ? 'REP' : 'IND'}</td>
                  <td className="ellipsis">{r.leader.name}</td>
                  <td className="hide-sm"><i className="dot" style={{ background: ratingColor(r.rating) }} /> {tierOf(r.rating)}</td>
                  <td className="num">{compactUsd(r.volume)}</td>
                  <td className={`num hide-sm ${(r.change24h ?? 0) >= 0 ? 'up' : 'down'}`}>{r.change24h === null ? '—' : `${r.change24h >= 0 ? '+' : ''}${(r.change24h * 100).toFixed(1)}%`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="muted center">No races match.</p>}
      {rows.length > limit && <div className="center"><button className="pill" onClick={() => setLimit(limit + 25)}>{rows.length - limit} more</button></div>}
    </section>
  )
}

/* ----- build your map ----- */

const BUILD_KEY = 'pm_build_map_v1'
type Picks = Record<string, 'D' | 'R'>
const loadPicks = (): Picks => {
  try { return JSON.parse(localStorage.getItem(BUILD_KEY) ?? '{}') ?? {} } catch { return {} }
}

function BuildMap({ data }: { data: ElectionsData }) {
  const [picks, setPicksState] = useState<Picks>(loadPicks)
  const setPicks = (p: Picks) => {
    setPicksState(p)
    try { localStorage.setItem(BUILD_KEY, JSON.stringify(p)) } catch { /* private mode */ }
  }
  const races = data.senate.races
  const swing = useMemo(() => {
    const fromMarket = (data.buildMap?.states ?? []).map((s) => races.find((r) => r.state === s)).filter((r): r is Race => Boolean(r))
    if (fromMarket.length) return fromMarket
    return [...races].sort((a, b) => Math.abs(a.dem - a.rep) - Math.abs(b.dem - b.rep)).slice(0, 7)
  }, [data.buildMap, races])
  const swingSet = new Set(swing.map((r) => r.state))
  const s = data.senate.seats

  let dem = s.notUp.D + s.unmarketed.D
  let rep = s.notUp.R + s.unmarketed.R
  for (const r of races) {
    if (swingSet.has(r.state)) continue
    if (r.dem >= r.rep) dem++
    else rep++
  }
  let open = 0
  for (const r of swing) {
    const p = picks[r.state]
    if (p === 'D') dem++
    else if (p === 'R') rep++
    else open++
  }
  const done = open === 0
  const verdict = dem >= 51 ? { cls: 'dem', text: 'Democrats win the Senate' }
    : rep >= 51 ? { cls: 'rep', text: 'Republicans keep the Senate' }
      : dem === 50 && rep === 50 ? { cls: 'rep', text: '50–50: the Vice President breaks ties for Republicans' }
        : null

  // Polymarket's combo market: one outcome per set of swing states Republicans win
  const combo = (() => {
    if (!done || !data.buildMap) return null
    const rStates = swing.filter((r) => picks[r.state] === 'R').map((r) => r.state).sort()
    const label = rStates.length === 0 ? 'None' : rStates.length === swing.length ? `All ${swing.length}` : rStates.join(', ')
    return data.buildMap.outcomes.find((o) => o.label === label) ?? null
  })()

  const cycle = (state: string) => {
    const cur = picks[state]
    const next = { ...picks }
    if (!cur) next[state] = 'D'
    else if (cur === 'D') next[state] = 'R'
    else delete next[state]
    setPicks(next)
  }

  return (
    <>
      <section className="mt-hero card">
        <h1>Build your <span className="dem">Senate</span> map</h1>
        <p className="muted">Pick a winner in the {swing.length} closest races. Every other seat goes to its market favorite. Saved on this device.</p>
      </section>
      <SeatBar total={100} toWin={51} left={{ n: dem, sub: 'Your map' }} right={{ n: rep, sub: open ? `${open} undecided` : 'Your map' }}
        segments={[
          { key: 'd', n: dem, color: 'var(--el-safe-d)', title: 'Democrats' },
          { key: 'open', n: open, color: 'var(--el-tossup)', title: 'Undecided' },
          { key: 'r', n: rep, color: 'var(--el-safe-r)', title: 'Republicans' },
        ]} />
      {verdict && <div className={`mt-verdict ${verdict.cls}`}>{verdict.text}{!done && ' (so far)'}</div>}

      <div className="mt-mapgrid">
        <div className="mt-mapcol">
          <UsMap
            fill={(st) => {
              const r = races.find((x) => x.state === st)
              if (!r) return null
              if (swingSet.has(st)) return picks[st] === 'D' ? 'var(--el-safe-d)' : picks[st] === 'R' ? 'var(--el-safe-r)' : 'var(--el-tossup)'
              return r.dem >= r.rep ? 'var(--el-faded-d)' : 'var(--el-faded-r)'
            }}
            tooltip={(st) => {
              const r = races.find((x) => x.state === st)
              if (!r) return <><b>{st}</b><span>No Senate race</span></>
              return <><b>{r.label}</b><span>{swingSet.has(st) ? 'Click to pick a winner' : `${favored(r).side} favored`}</span></>
            }}
            onPick={(st) => {
              if (swingSet.has(st)) cycle(st)
              else {
                const r = races.find((x) => x.state === st)
                if (r) navigate(`/event/${r.slug}`)
              }
            }}
          />
        </div>
        <div className="mt-sidecol">
          <ul className="bm-list">
            {swing.map((r) => {
              const d = r.candidates.find((c) => c.party === 'D') ?? null
              const rp = r.candidates.find((c) => c.party === 'R') ?? null
              return (
                <li key={r.state} className="bm-race card">
                  <Link to={`/event/${r.slug}`} className="bm-title">{r.label} <span className="muted small">{pct(r.dem)} D · {pct(r.rep)} R</span></Link>
                  <div className="bm-picks">
                    <button className={`bm-pick dem ${picks[r.state] === 'D' ? 'on' : ''}`} onClick={() => setPicks({ ...picks, [r.state]: 'D' })}>{d?.name ?? 'Democrat'}</button>
                    <button className={`bm-pick rep ${picks[r.state] === 'R' ? 'on' : ''}`} onClick={() => setPicks({ ...picks, [r.state]: 'R' })}>{rp?.name ?? 'Republican'}</button>
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="bm-actions">
            <button className="pill" onClick={() => setPicks(Object.fromEntries(swing.map((r) => [r.state, r.dem >= r.rep ? 'D' : 'R'])))}>Fill with favorites</button>
            <button className="pill" onClick={() => setPicks({})}>Reset</button>
          </div>
          {combo && data.buildMap && (
            <Link to={`/event/${data.buildMap.slug}?m=${combo.marketId}`} className="bm-combo card">
              <span className="muted small">Polymarket odds for this exact map</span>
              <b>{pct(combo.p)}</b>
              <span className="small">Republicans win: {combo.label} · Trade it <Icon name="chevronRight" size={14} /></span>
            </Link>
          )}
        </div>
      </div>
    </>
  )
}
