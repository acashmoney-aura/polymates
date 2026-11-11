import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  api, cents, compactUsd, qs, shares, signedUsd, timeAgo, usd,
  type BiggestWin, type LeaderChart, type LeaderPeriod, type LeaderRow, type LeaderSort, type MemberProfile,
} from '../api'
import { LineChart } from '../components/QuantCharts'
import { Avatar, Empty, Img, Sheet, Spinner } from '../components/ui'
import { Icon } from '../icons'
import { Link, navigate, useLocation, useTitle } from '../router'
import { useApp, useStream } from '../store'
import { NeedLeague } from './Portfolio'

const PERIODS: [LeaderPeriod, string][] = [['day', 'Today'], ['week', 'Weekly'], ['month', 'Monthly'], ['all', 'All']]
const PERIOD_PHRASE: Record<LeaderPeriod, string> = { day: 'today', week: 'this week', month: 'this month', all: 'all time' }
const SORTS: [LeaderSort, string][] = [['pnl', 'Profit/Loss'], ['return', 'Return'], ['volume', 'Volume']]
const SOURCE_LABEL: Record<string, string> = { all: 'Overall', predictions: 'Predictions', perps: 'Perps' }
const MEDALS = ['#f5c542', '#c0c7d1', '#d08a4c']
/** categorical slots for the race chart (validated for the dark surface) */
const RACE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181']

const signedCompact = (v: number) => `${v >= 0 ? '+' : '-'}${Math.abs(v) < 1000 ? usd(Math.abs(v), 0) : compactUsd(Math.abs(v))}`
const signedWhole = (v: number) => `${v >= 0 ? '+' : '-'}${usd(Math.abs(v), 0)}`
const pctText = (p: number) => `${p >= 0 ? '+' : ''}${(p * 100).toFixed(Math.abs(p) < 0.1 ? 2 : 1)}%`
const marketLabel = (x: { title: string; eventTitle?: string | null }) => (x.eventTitle && x.eventTitle !== x.title ? `${x.eventTitle} · ${x.title}` : x.title)
const tone = (v: number) => (v > 0 ? 'yes-accent' : v < 0 ? 'no-color' : 'muted')

type Category = { slug: string; label: string }

function useLeaderParams() {
  const { query } = useLocation()
  const period = (PERIODS.some(([p]) => p === query.get('period')) ? query.get('period') : 'month') as LeaderPeriod
  const sort = (SORTS.some(([s]) => s === query.get('sort')) ? query.get('sort') : 'pnl') as LeaderSort
  const category = query.get('cat') ?? ''
  const source = query.get('source') ?? ''
  const profile = query.get('u') ?? ''
  const set = (patch: Record<string, string | null>) => {
    const next = { period, sort, cat: category, source, u: profile, ...patch }
    navigate(`/leaderboard${qs({
      period: next.period === 'month' ? null : next.period,
      sort: next.sort === 'pnl' ? null : next.sort,
      cat: next.cat, source: next.source, u: next.u,
    })}`, { replace: true })
  }
  return { period, sort, category, source, profile, set }
}

export function Leaderboard() {
  const { user, leagueId, league } = useApp()
  const { period, sort, category, source, profile, set } = useLeaderParams()
  const [rows, setRows] = useState<LeaderRow[] | null>(null)
  const [wins, setWins] = useState<BiggestWin[] | null>(null)
  const [chart, setChart] = useState<LeaderChart | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [winsOpen, setWinsOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  useTitle('Leaderboard')

  const load = useCallback(() => {
    if (!leagueId) return
    const base = `/api/leagues/${leagueId}`
    api<LeaderRow[]>(`${base}/leaderboard${qs({ period, sort, category, source })}`).then(setRows).catch(() => {})
    api<BiggestWin[]>(`${base}/biggest-wins${qs({ period, category, limit: 12 })}`).then(setWins).catch(() => {})
    api<LeaderChart>(`${base}/leaderboard/chart${qs({ period, category })}`).then(setChart).catch(() => {})
  }, [leagueId, period, sort, category, source])
  useEffect(load, [load])
  useEffect(() => { api<Category[]>('/api/categories').then(setCategories).catch(() => {}) }, [])
  useStream((e) => e.type === 'trade' || e.type === 'resolve', load, 5000)

  const sources = useMemo(() => {
    const keys = new Set<string>()
    for (const r of rows ?? []) for (const k of Object.keys(r.breakdown ?? {})) keys.add(k)
    const list = [...keys]
    return list.length > 1 ? ['all', ...list] : list.length ? list : ['predictions']
  }, [rows])

  if (!user || !leagueId) return <NeedLeague what="leaderboard" />

  const q = search.trim().toLowerCase()
  const shown = (rows ?? []).filter((r) => !q || r.displayName.toLowerCase().includes(q) || r.username.toLowerCase().includes(q))
  const activeSource = source || sources[0]
  const showPodium = !q && sort === 'pnl' && (rows?.length ?? 0) >= 2

  return (
    <div className="wrap page lbx">
      <div className="lbx-main">
        <div className="lbx-title">
          <h1>Leaderboard</h1>
          <button className="lbx-info" aria-label="How the leaderboard works" aria-expanded={infoOpen} onClick={() => setInfoOpen((v) => !v)}>
            <Icon name="info" size={18} />
          </button>
          {infoOpen && (
            <div className="lbx-tip" role="note">
              <b>{league?.name}</b> ranked by mark-to-market profit over the period: trades, resolutions and price moves all count.
              Everyone started with {usd(league?.startingBalance ?? 0, 0)}. Orders from a member's bots, scripts and agents count as theirs.
            </div>
          )}
          <Link to="/projector" className="btn lbx-projector"><Icon name="trophy" size={16} /> Projector view</Link>
        </div>

        <div className="lbx-tabs" role="tablist">
          {sources.map((s) => (
            <button key={s} role="tab" aria-selected={activeSource === s} className={activeSource === s ? 'active' : ''}
              onClick={() => set({ source: s === sources[0] ? null : s })}>
              {SOURCE_LABEL[s] ?? s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <div className="lbx-filters">
          <div className="lbx-seg" role="group" aria-label="Period">
            {PERIODS.map(([p, label]) => (
              <button key={p} className={period === p ? 'active' : ''} aria-pressed={period === p} onClick={() => set({ period: p })}>{label}</button>
            ))}
          </div>
          <label className="lbx-select">
            <select value={category} onChange={(e) => set({ cat: e.target.value || null })} aria-label="Category">
              <option value="">All Categories</option>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </select>
            <Icon name="chevronDown" size={16} />
          </label>
        </div>

        {(showPodium || (chart && chart.series.length > 0)) && (
          <div className={`lbx-hero ${showPodium ? '' : 'solo'}`}>
            {showPodium && rows && <Podium rows={rows} onPick={(id) => set({ u: id })} />}
            {chart && chart.series.length > 0 && <RaceChart chart={chart} period={period} onPick={(id) => set({ u: id })} />}
          </div>
        )}

        <div className="lbx-head">
          <label className="lbx-search">
            <Icon name="search" size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" aria-label="Search by name" />
          </label>
          <div className="lbx-sorts">
            {SORTS.map(([s, label]) => (
              <button key={s} className={`lbx-sort-${s} ${sort === s ? 'active' : ''}`} aria-pressed={sort === s} onClick={() => set({ sort: s })}>{label}</button>
            ))}
          </div>
          <label className="lbx-select lbx-sort-select">
            <select value={sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort by">
              {SORTS.map(([s, label]) => <option key={s} value={s}>{label}</option>)}
            </select>
            <Icon name="chevronDown" size={16} />
          </label>
        </div>

        {!rows ? <div className="lbx-loading"><Spinner /></div> : !shown.length ? (
          <Empty title={q ? `No one matches “${search}”` : 'No members yet'} />
        ) : (
          <ol className="lbx-list">
            {shown.map((r, i) => (
              <li key={r.userId} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                <button className={`lbx-row ${r.userId === user.id ? 'me' : ''}`} onClick={() => set({ u: r.userId })}>
                  <span className="lbx-rank">{r.rank}</span>
                  <MedalAvatar row={r} size={40} />
                  <span className="lbx-name">
                    <b>{r.displayName}{r.userId === user.id && <em> You</em>}</b>
                    <small>
                      {r.trades ?? 0} trades
                      {(r.wins ?? 0) + (r.losses ?? 0) > 0 && <> · {r.wins}–{r.losses} resolved</>}
                      {r.streak && r.streak.count >= 2 && <> · <span className={r.streak.kind === 'win' ? 'yes-accent' : 'no-color'}>{r.streak.kind === 'win' ? 'W' : 'L'}{r.streak.count}</span></>}
                      {r.bots > 0 && <> · <Icon name="bot" size={12} /> {r.bots}</>}
                    </small>
                  </span>
                  <span className={`lbx-pnl ${tone(r.pnl)} ${sort === 'pnl' ? 'on' : ''}`}>{signedWhole(r.pnl)}</span>
                  <span className={`lbx-ret ${tone(r.pnlPct)} ${sort === 'return' ? 'on' : ''}`}>{pctText(r.pnlPct)}</span>
                  <span className={`lbx-vol ${sort === 'volume' ? 'on' : ''}`}>{usd(r.volume, 0)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <aside className="lbx-aside">
        <div className="lbx-wins">
          <h3>Biggest wins {PERIOD_PHRASE[period]}</h3>
          <WinsList wins={wins} onPick={(id) => set({ u: id })} />
        </div>
      </aside>

      <button className="lbx-wins-fab" onClick={() => setWinsOpen(true)}><Icon name="trophy" size={18} /> Biggest wins</button>
      {winsOpen && createPortal(
        <Sheet onClose={() => setWinsOpen(false)}>
          <div className="lbx-wins in-sheet">
            <h3>Biggest wins {PERIOD_PHRASE[period]}</h3>
            <WinsList wins={wins} onPick={(id) => { setWinsOpen(false); set({ u: id }) }} />
          </div>
        </Sheet>,
        document.body,
      )}

      {profile && createPortal(<ProfileDrawer leagueId={leagueId} userId={profile} period={period} onClose={() => set({ u: null })} />, document.body)}
    </div>
  )
}

export function MedalAvatar({ row, size }: { row: Pick<LeaderRow, 'rank' | 'displayName' | 'avatarHue' | 'avatarUrl'>; size: number }) {
  const user = { displayName: row.displayName, avatarHue: row.avatarHue, avatarUrl: row.avatarUrl ?? undefined }
  return (
    <span className="lbx-av" style={{ width: size, height: size }}>
      <Avatar user={user} size={size} />
      {row.rank <= 3 && (
        <svg className="lbx-medal" viewBox="0 0 20 22" width={Math.max(18, size * 0.5)} height={Math.max(20, size * 0.55)} aria-label={`Rank ${row.rank}`}>
          <path d="M5 13 3 21l4-2 3 3 1-7z M15 13l2 8-4-2-3 3-1-7z" fill={MEDALS[row.rank - 1]} opacity="0.75" />
          <circle cx="10" cy="9" r="7.5" fill={MEDALS[row.rank - 1]} stroke="var(--bg)" strokeWidth="1.5" />
          <text x="10" y="12.3" textAnchor="middle" fontSize="9" fontWeight="700" fill="#0c0e13">{row.rank}</text>
        </svg>
      )}
    </span>
  )
}

function Podium({ rows, onPick }: { rows: LeaderRow[]; onPick: (userId: string) => void }) {
  return (
    <div className="podium lbx-podium">
      {[1, 0, 2].filter((i) => rows[i]).map((i, k) => {
        const r = rows[i]
        return (
          <button key={r.userId} className={`podium-col p${i + 1}`} style={{ animationDelay: `${k * 120}ms` }} onClick={() => onPick(r.userId)}>
            <Avatar user={{ displayName: r.displayName, avatarHue: r.avatarHue, avatarUrl: r.avatarUrl ?? undefined }} size={i === 0 ? 56 : 46} />
            <b className="ellipsis">{r.displayName}</b>
            <span className={tone(r.pnl)}>{signedCompact(r.pnl)}</span>
            <div className="podium-block" style={{ background: `linear-gradient(180deg, ${MEDALS[i]}55, transparent)`, borderColor: `${MEDALS[i]}88` }}>{i + 1}</div>
          </button>
        )
      })}
    </div>
  )
}

function RaceChart({ chart, period, onPick }: { chart: LeaderChart; period: LeaderPeriod; onPick: (userId: string) => void }) {
  // colour follows the member, not their rank: slots are assigned by user id
  const color = new Map([...chart.series].map((s) => s.userId).sort().map((id, i) => [id, RACE_COLORS[i % RACE_COLORS.length]]))
  const series = chart.series.map((s) => ({ name: s.displayName, color: color.get(s.userId)!, values: s.values }))
  return (
    <div className="lbx-race">
      <div className="lbx-race-head">
        <h4>Top {chart.series.length} race</h4>
        <span className="muted">P&L {PERIOD_PHRASE[period]}</span>
      </div>
      <LineChart t={chart.t} series={series} height={170} zero format={signedCompact} />
      <ul className="lbx-legend">
        {chart.series.map((s) => (
          <li key={s.userId}>
            <button onClick={() => onPick(s.userId)}>
              <i style={{ background: color.get(s.userId) }} />
              <span className="ellipsis">{s.displayName}</span>
              <b>{signedCompact(s.values[s.values.length - 1] ?? 0)}</b>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function WinsList({ wins, onPick }: { wins: BiggestWin[] | null; onPick: (userId: string) => void }) {
  if (!wins) return <Spinner />
  if (!wins.length) return <p className="muted small lbx-wins-empty">No winning positions closed in this period yet. Wins show up when a market resolves or someone sells for a profit.</p>
  return (
    <ol className="lbx-wins-list">
      {wins.map((w) => (
        <li key={`${w.userId}-${w.marketId}-${w.closedAt}`}>
          <button onClick={() => onPick(w.userId)}>
            <span className="lbx-rank">{w.rank}</span>
            <Avatar user={{ displayName: w.displayName, avatarHue: w.avatarHue, avatarUrl: w.avatarUrl ?? undefined }} size={36} />
            <span className="lbx-win-text">
              <span className="lbx-win-top"><b>{w.displayName}</b><span className="ellipsis">{marketLabel(w)}</span></span>
              <span className="lbx-win-money">{usd(w.cost, 0)} <span aria-label="to">→</span> <b>{usd(w.payout, 0)}</b> <small className="muted">{w.outcomeLabel}{w.settled ? ' · resolved' : ''}</small></span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

export function ProfileDrawer({ leagueId, userId, period, onClose, live }: {
  leagueId: string; userId: string; period: LeaderPeriod; onClose: () => void
  /** portfolio value sampled every few seconds (projector view); shown instead of the hourly P&L chart */
  live?: { t: number[]; values: (number | null)[] }
}) {
  const [p, setP] = useState<MemberProfile | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'positions' | 'trades' | 'closed'>('positions')
  useEffect(() => {
    let live = true
    api<MemberProfile>(`/api/leagues/${leagueId}/members/${userId}/profile${qs({ period })}`)
      .then((x) => live && setP(x)).catch((e) => live && setErr((e as Error).message))
    return () => { live = false }
  }, [leagueId, userId, period])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  const s = p?.chart.series[0]
  return (
    <div className="lbx-drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="lbx-drawer" role="dialog" aria-modal="true" aria-label={p ? `${p.displayName}'s profile` : 'Profile'}>
        <button className="icon-btn lbx-drawer-close" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        {err ? <Empty title="Couldn't load this member">{err}</Empty> : !p ? <div className="lbx-loading"><Spinner /></div> : (
          <>
            <div className="lbx-prof-head">
              <MedalAvatar row={p} size={64} />
              <div>
                <h2>{p.displayName}</h2>
                <span className="muted">@{p.username} · #{p.rank} {PERIOD_PHRASE[period]} · joined {timeAgo(p.joinedAt)}{p.role && p.role !== 'member' ? ` · ${p.role}` : ''}</span>
              </div>
            </div>
            <div className="lbx-prof-pnl">
              <span className="muted">Profit/Loss {PERIOD_PHRASE[period]}</span>
              <b className={tone(p.pnl)}>{signedUsd(p.pnl)}</b>
              <span className={tone(p.pnlPct)}>{pctText(p.pnlPct)}</span>
            </div>
            {live && live.values.filter((v) => v !== null).length > 1 ? (
              <LineChart t={live.t} series={[{ name: 'Value', color: p.pnl >= 0 ? '#00ae4b' : '#df0b10', values: live.values, area: true }]} height={140}
                format={(v) => usd(v, 0)} formatTime={(x) => new Date(x * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} />
            ) : s && s.values.length > 1 && (
              <LineChart t={p.chart.t} series={[{ name: 'P&L', color: p.pnl >= 0 ? '#00ae4b' : '#df0b10', values: s.values, area: true }]} height={140} zero format={signedCompact} />
            )}
            <div className="lbx-stats">
              <div><b>{usd(p.value, 0)}</b><span>Portfolio</span></div>
              <div><b>{usd(p.volume, 0)}</b><span>Volume</span></div>
              <div><b>{p.tradeCount}</b><span>Trades</span></div>
              <div><b>{p.winRate === null || p.winRate === undefined ? '—' : `${Math.round(p.winRate * 100)}%`}</b><span>Win rate{p.wins || p.losses ? ` (${p.wins}-${p.losses})` : ''}</span></div>
              <div><b className={p.streak ? (p.streak.kind === 'win' ? 'yes-accent' : 'no-color') : ''}>{p.streak ? `${p.streak.kind === 'win' ? 'W' : 'L'}${p.streak.count}` : '—'}</b><span>Streak</span></div>
              <div><b className={p.allTimePnl >= 0 ? 'yes-accent' : 'no-color'}>{signedCompact(p.allTimePnl)}</b><span>All time</span></div>
            </div>
            {p.bestTrade && (
              <div className="lbx-best">
                <Img src={p.bestTrade.image} size={36} radius={8} />
                <span className="grow">
                  <small className="muted">Best trade {PERIOD_PHRASE[period]}</small>
                  <span className="ellipsis">{marketLabel(p.bestTrade)}</span>
                </span>
                <span className="lbx-win-money">{usd(p.bestTrade.cost, 0)} → <b>{usd(p.bestTrade.payout, 0)}</b></span>
              </div>
            )}
            <div className="text-tabs lbx-prof-tabs">
              <button className={tab === 'positions' ? 'active' : ''} onClick={() => setTab('positions')}>Positions ({p.positions.length})</button>
              <button className={tab === 'trades' ? 'active' : ''} onClick={() => setTab('trades')}>Trades</button>
              <button className={tab === 'closed' ? 'active' : ''} onClick={() => setTab('closed')}>Closed</button>
            </div>
            {tab === 'positions' && (!p.positions.length ? <p className="muted small">No open positions.</p> : (
              <ul className="lbx-items">
                {p.positions.map((x) => (
                  <li key={x.marketId + x.outcome}>
                    <Link to={x.eventSlug ? `/event/${x.eventSlug}?m=${x.marketId}` : '/'} onClick={onClose}>
                      <Img src={x.image} size={36} radius={8} />
                      <span className="lbx-item-text">
                        <span className="ellipsis">{marketLabel(x)}</span>
                        <small><span className={`pill-outcome ${x.outcome}`}>{x.outcomeLabel}</span> {shares(x.size)} @ {cents(x.avgPrice)} · now {cents(x.curPrice)}</small>
                      </span>
                      <span className="lbx-item-val"><b>{usd(x.value)}</b><small className={tone(x.pnl)}>{signedUsd(x.pnl)}</small></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ))}
            {tab === 'trades' && (!p.trades.length ? <p className="muted small">No trades yet.</p> : (
              <ul className="lbx-items">
                {p.trades.map((t, i) => (
                  <li key={i}>
                    <Link to={t.eventSlug ? `/event/${t.eventSlug}?m=${t.marketId}` : '/'} onClick={onClose}>
                      <Img src={t.image} size={36} radius={8} />
                      <span className="lbx-item-text">
                        <span className="ellipsis">{t.title}</span>
                        <small><span className={`pill-side ${t.side}`}>{t.side}</span> <span className={`pill-outcome ${t.outcome}`}>{t.outcomeLabel}</span> {shares(t.size)} @ {cents(t.price)} · {timeAgo(t.ts)}</small>
                      </span>
                      <span className="lbx-item-val"><b>{usd(t.value)}</b></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ))}
            {tab === 'closed' && (!p.closed.length ? <p className="muted small">Nothing closed yet.</p> : (
              <ul className="lbx-items">
                {p.closed.map((c, i) => (
                  <li key={i}>
                    <Link to={c.eventSlug ? `/event/${c.eventSlug}?m=${c.marketId}` : '/'} onClick={onClose}>
                      <Img src={c.image} size={36} radius={8} />
                      <span className="lbx-item-text">
                        <span className="ellipsis">{marketLabel(c)}</span>
                        <small><span className={`pill-outcome ${c.outcome}`}>{c.outcomeLabel}</span> {c.settled ? 'resolved' : 'sold'} {timeAgo(c.closedAt)}</small>
                      </span>
                      <span className="lbx-item-val"><b>{usd(c.cost, 0)} → {usd(c.payout, 0)}</b><small className={tone(c.pnl)}>{signedUsd(c.pnl)}</small></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ))}
          </>
        )}
      </aside>
    </div>
  )
}
