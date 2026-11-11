import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  api, compactUsd, qs, timeAgo, usd,
  type ActivityRow, type LeaderPeriod, type LeaderRow, type LiveEquity,
} from '../api'
import { LineChart } from '../components/QuantCharts'
import { Avatar } from '../components/ui'
import { Icon } from '../icons'
import { navigate, useLocation, useTitle } from '../router'
import { useApp, useStream } from '../store'
import { MedalAvatar, ProfileDrawer } from './Leaderboard'
import { NeedLeague } from './Portfolio'

/*
 * Projector view: a full-screen league leaderboard for showing a live game on a big screen. Ranks animate when
 * they change, every player has a sparkline of their portfolio value, and any column sorts. Clicking a player
 * opens their holdings and trades. Value-over-time comes from /leaderboard/live (sampled every 15s on the
 * server); volatility and drawdown are computed here from that series.
 */

type SortKey = 'pnl' | 'return' | 'value' | 'move' | 'vol' | 'dd' | 'volume' | 'trades' | 'winRate'
interface Stats { change: number | null; vol: number | null; dd: number | null; spark: number[] }
type Row = LeaderRow & { stats: Stats }

const WINDOWS = [15, 60, 240] as const
const windowLabel = (m: number) => (m < 60 ? `${m}m` : `${m / 60}h`)
const PERIODS: [LeaderPeriod, string][] = [['all', 'Game'], ['day', 'Today']]
const RACE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181']

const signed = (v: number) => `${v >= 0 ? '+' : '-'}${Math.abs(v) < 10_000 ? usd(Math.abs(v), 0) : compactUsd(Math.abs(v))}`
const pctText = (p: number) => `${p >= 0 ? '+' : ''}${(p * 100).toFixed(Math.abs(p) < 0.1 ? 2 : 1)}%`
const plainPct = (p: number) => `${(p * 100).toFixed(p < 0.1 ? 2 : 1)}%`
const tone = (v: number | null | undefined) => (!v ? '' : v > 0 ? 'pos' : 'neg')

const COLUMNS: { key: SortKey; label: string; title: string; get: (r: Row) => number | null | undefined }[] = [
  { key: 'pnl', label: 'P&L', title: 'Profit or loss, mark to market', get: (r) => r.pnl },
  { key: 'return', label: 'Return', title: 'P&L as a share of starting balance', get: (r) => r.pnlPct },
  { key: 'value', label: 'Value', title: 'Cash plus positions at current prices', get: (r) => r.value },
  { key: 'move', label: 'Move', title: 'Change in portfolio value over the chart window', get: (r) => r.stats.change },
  { key: 'vol', label: 'Vol / hr', title: 'Volatility: standard deviation of value changes, scaled to one hour', get: (r) => r.stats.vol },
  { key: 'dd', label: 'Drawdown', title: 'Largest drop from a peak over the chart window', get: (r) => r.stats.dd },
  { key: 'volume', label: 'Volume', title: 'Dollar value traded', get: (r) => r.volume },
  { key: 'trades', label: 'Trades', title: 'Number of fills', get: (r) => r.trades },
  { key: 'winRate', label: 'Win %', title: 'Share of resolved positions that paid off', get: (r) => r.winRate },
]

function cell(key: SortKey, r: Row) {
  switch (key) {
    case 'pnl': return <span className={tone(r.pnl)}>{signed(r.pnl)}</span>
    case 'return': return <span className={tone(r.pnlPct)}>{pctText(r.pnlPct)}</span>
    case 'value': return usd(r.value, 0)
    case 'move': return r.stats.change === null ? '—' : <span className={tone(r.stats.change)}>{pctText(r.stats.change)}</span>
    case 'vol': return r.stats.vol === null ? '—' : plainPct(r.stats.vol)
    case 'dd': return r.stats.dd === null ? '—' : r.stats.dd < 1e-6 ? '0%' : <span className="neg">-{plainPct(r.stats.dd)}</span>
    case 'volume': return r.volume < 10_000 ? usd(r.volume, 0) : compactUsd(r.volume)
    case 'trades': return (r.trades ?? 0).toLocaleString('en-US')
    case 'winRate': return r.winRate === null || r.winRate === undefined ? '—' : `${Math.round(r.winRate * 100)}%`
  }
}

/** Volatility (per hour), max drawdown and change from a value series sampled every `intervalSec`. */
function seriesStats(values: (number | null)[] | undefined, intervalSec: number): Stats {
  const v = (values ?? []).filter((x): x is number => x !== null && Number.isFinite(x) && x > 0)
  if (v.length < 2) return { change: null, vol: null, dd: null, spark: v }
  const rets: number[] = []
  for (let i = 1; i < v.length; i++) rets.push(v[i] / v[i - 1] - 1)
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1))
  let peak = v[0], dd = 0
  for (const x of v) {
    peak = Math.max(peak, x)
    dd = Math.max(dd, (peak - x) / peak)
  }
  return { change: v[v.length - 1] / v[0] - 1, vol: rets.length >= 3 ? sd * Math.sqrt(3600 / intervalSec) : null, dd, spark: v }
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="pj-spark" aria-hidden="true" />
  const w = 120, h = 32
  const lo = Math.min(...values), hi = Math.max(...values)
  const span = hi - lo || 1
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`).join(' ')
  const up = values[values.length - 1] >= values[0]
  return (
    <svg className="pj-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={up ? 'var(--yes-accent)' : 'var(--no-text)'} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

function useParams() {
  const { query } = useLocation()
  const sort = (COLUMNS.some((c) => c.key === query.get('sort')) ? query.get('sort') : 'pnl') as SortKey
  const asc = query.get('dir') === 'asc'
  const win = Number(query.get('w')) || 60
  const period = (query.get('period') === 'day' ? 'day' : 'all') as LeaderPeriod
  const set = (patch: Partial<{ sort: SortKey; asc: boolean; win: number; period: LeaderPeriod }>) => {
    const n = { sort, asc, win, period, ...patch }
    navigate(`/projector${qs({ sort: n.sort === 'pnl' ? null : n.sort, dir: n.asc ? 'asc' : null, w: n.win === 60 ? null : n.win, period: n.period === 'all' ? null : n.period })}`, { replace: true })
  }
  return { sort, asc, win, period, set }
}

export function Projector() {
  const { user, leagueId, league } = useApp()
  const { sort, asc, win, period, set } = useParams()
  const [rows, setRows] = useState<LeaderRow[] | null>(null)
  const [live, setLive] = useState<LiveEquity | null>(null)
  const [feed, setFeed] = useState<ActivityRow[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [moves, setMoves] = useState<Map<string, number>>(new Map())
  const [idle, setIdle] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  const prevOrder = useRef<{ key: string; ids: string[] } | null>(null)
  useTitle('Projector')

  const loadBoard = useCallback(() => {
    if (!leagueId) return
    api<LeaderRow[]>(`/api/leagues/${leagueId}/leaderboard${qs({ period })}`).then(setRows).catch(() => {})
    api<ActivityRow[]>(`/api/leagues/${leagueId}/activity`).then((a) => setFeed(a.slice(0, 8))).catch(() => {})
  }, [leagueId, period])
  const loadLive = useCallback(() => {
    if (!leagueId) return
    api<LiveEquity>(`/api/leagues/${leagueId}/leaderboard/live${qs({ minutes: win })}`).then(setLive).catch(() => {})
  }, [leagueId, win])
  useEffect(() => {
    loadBoard()
    const t = setInterval(loadBoard, 10_000)
    return () => clearInterval(t)
  }, [loadBoard])
  useEffect(() => {
    loadLive()
    const t = setInterval(loadLive, 15_000)
    return () => clearInterval(t)
  }, [loadLive])
  useStream((e) => e.type === 'trade' || e.type === 'resolve' || e.type === 'activity', loadBoard, 3000)
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // hide the controls and cursor when nobody's touching the mouse (it's on a projector)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 4000) }
    wake()
    window.addEventListener('mousemove', wake)
    window.addEventListener('keydown', wake)
    return () => { clearTimeout(t); window.removeEventListener('mousemove', wake); window.removeEventListener('keydown', wake) }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return
      if (e.key === 'f') void toggleFullscreen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sorted: Row[] = useMemo(() => {
    const byUser = new Map(live?.series.map((s) => [s.userId, s.values]) ?? [])
    const withStats = (rows ?? []).map((r) => ({ ...r, stats: seriesStats(byUser.get(r.userId), live?.intervalSec ?? 15) }))
    const col = COLUMNS.find((c) => c.key === sort)!
    return withStats.sort((a, b) => {
      const x = col.get(a), y = col.get(b)
      // players with no value yet sit at the bottom whichever way the column sorts
      if (x === null || x === undefined) return y === null || y === undefined ? b.pnl - a.pnl : 1
      if (y === null || y === undefined) return -1
      return (asc ? x - y : y - x) || b.pnl - a.pnl || a.displayName.localeCompare(b.displayName)
    })
  }, [rows, live, sort, asc])

  // rank arrows: compare to the previous order under the same sort, and let them fade after a while
  const orderKey = `${sort}:${asc}:${period}:${win}`
  const ids = sorted.map((r) => r.userId).join(',')
  useEffect(() => {
    const now = sorted.map((r) => r.userId)
    const prev = prevOrder.current
    prevOrder.current = { key: orderKey, ids: now }
    if (!prev || prev.key !== orderKey) return void setMoves(new Map())
    const m = new Map<string, number>()
    now.forEach((id, i) => {
      const j = prev.ids.indexOf(id)
      if (j >= 0 && j !== i) m.set(id, j - i)
    })
    if (!m.size) return
    setMoves(m)
    const t = setTimeout(() => setMoves(new Map()), 12_000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, orderKey])

  if (!user || !leagueId) return <NeedLeague what="projector view" />

  const top = sorted.slice(0, 5)
  const colorOf = new Map([...top].map((r) => r.userId).sort().map((id, i) => [id, RACE_COLORS[i % RACE_COLORS.length]]))
  const byUser = new Map(live?.series.map((s) => [s.userId, s]) ?? [])
  const race = top.map((r) => ({ name: r.displayName, color: colorOf.get(r.userId)!, values: byUser.get(r.userId)?.values ?? [] }))
  const haveChart = (live?.t.length ?? 0) >= 2 && race.some((s) => s.values.filter((v) => v !== null).length >= 2)
  const totalTrades = sorted.reduce((a, r) => a + (r.trades ?? 0), 0)
  const totalVolume = sorted.reduce((a, r) => a + r.volume, 0)
  const sortCol = COLUMNS.find((c) => c.key === sort)!
  const minuteFmt = (s: number) => new Date(s * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  // portalled to <body>: the route wrapper animates with a transform, which would trap position: fixed
  return createPortal(
    <div className={`pj ${idle ? 'idle' : ''}`}>
      <header className="pj-top">
        <div className="pj-title">
          <span className="pj-live"><i /> Live</span>
          <h1 className="ellipsis">{league?.name ?? 'League'}</h1>
        </div>
        <dl className="pj-kpis">
          <div><dt>Players</dt><dd>{sorted.length}</dd></div>
          <div><dt>Trades</dt><dd>{totalTrades.toLocaleString('en-US')}</dd></div>
          <div><dt>Volume</dt><dd>{totalVolume < 100_000 ? usd(totalVolume, 0) : compactUsd(totalVolume)}</dd></div>
          <div><dt>Leader</dt><dd className="ellipsis">{sorted[0]?.displayName ?? '—'}</dd></div>
        </dl>
        <time className="pj-clock">{new Date(clock).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</time>
      </header>

      <div className="pj-controls" aria-label="View options">
        <div className="lbx-seg" role="group" aria-label="Ranking period">
          {PERIODS.map(([p, label]) => (
            <button key={p} className={period === p ? 'active' : ''} aria-pressed={period === p} onClick={() => set({ period: p })}>{label}</button>
          ))}
        </div>
        <div className="lbx-seg" role="group" aria-label="Chart window">
          {WINDOWS.map((w) => (
            <button key={w} className={win === w ? 'active' : ''} aria-pressed={win === w} onClick={() => set({ win: w })}>{windowLabel(w)}</button>
          ))}
        </div>
        <span className="pj-hint muted">Click a column to sort · click a player for their book · F for full screen</span>
        <button className="btn" onClick={() => void toggleFullscreen()}>Full screen</button>
        <button className="btn" onClick={() => navigate('/leaderboard')}><Icon name="x" size={16} /> Exit</button>
      </div>

      <div className="pj-body">
        <section className="pj-board" aria-label={`Leaderboard sorted by ${sortCol.label}`}>
          <div className="pj-row pj-head" role="row">
            <span className="pj-rank">#</span>
            <span className="pj-name">Player</span>
            <span className="pj-sparkcol">Value · {windowLabel(win)}</span>
            {COLUMNS.map((c) => (
              <button key={c.key} className={`pj-num pj-sort ${sort === c.key ? 'active' : ''} pj-c-${c.key}`} title={c.title}
                aria-sort={sort === c.key ? (asc ? 'ascending' : 'descending') : 'none'}
                onClick={() => set(sort === c.key ? { asc: !asc } : { sort: c.key, asc: false })}>
                {c.label}{sort === c.key && <span aria-hidden="true">{asc ? ' ↑' : ' ↓'}</span>}
              </button>
            ))}
          </div>
          {!rows ? <p className="pj-empty muted">Loading the league…</p> : !sorted.length ? <p className="pj-empty muted">No players yet. Share the invite link to get people in.</p> : (
            <ol className="pj-list" style={{ '--n': sorted.length } as React.CSSProperties}>
              {sorted.map((r, i) => {
                const mv = moves.get(r.userId)
                return (
                  <li key={r.userId} className={`pj-row pj-item ${i < 3 ? `pj-top${i + 1}` : ''}`} style={{ '--i': i } as React.CSSProperties}>
                    <button className="pj-hit" onClick={() => setPicked(r.userId)} aria-label={`${r.displayName}, rank ${i + 1}. Show holdings and trades`} />
                    <span className="pj-rank">
                      {i + 1}
                      {mv !== undefined && <small className={mv > 0 ? 'pos' : 'neg'} aria-label={mv > 0 ? `up ${mv}` : `down ${-mv}`}>{mv > 0 ? '▲' : '▼'}{Math.abs(mv)}</small>}
                    </span>
                    <span className="pj-name">
                      <MedalAvatar row={{ ...r, rank: i + 1 }} size={40} />
                      <span className="pj-who">
                        <b className="ellipsis">{r.displayName}</b>
                        <small className="muted ellipsis">@{r.username}{r.bots ? ` · ${r.bots} bot${r.bots > 1 ? 's' : ''}` : ''} · {r.positions} open</small>
                      </span>
                    </span>
                    <span className="pj-sparkcol"><Spark values={r.stats.spark} /></span>
                    {COLUMNS.map((c) => <span key={c.key} className={`pj-num ${sort === c.key ? 'active' : ''} pj-c-${c.key}`}>{cell(c.key, r)}</span>)}
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        <aside className="pj-side">
          <section className="pj-card">
            <div className="pj-card-head">
              <h2>Value over time</h2>
              <span className="muted">Top 5 by {sortCol.label} · last {windowLabel(win)}</span>
            </div>
            {haveChart ? (
              <LineChart t={live!.t} series={race} height={window.innerHeight < 820 ? 190 : 300} format={(v) => (v < 100_000 ? usd(v, 0) : compactUsd(v))} formatTime={minuteFmt} />
            ) : (
              <p className="pj-collecting muted">Recording everyone's value every {live?.intervalSec ?? 15}s. The chart fills in after the first few samples.</p>
            )}
            <ul className="pj-legend">
              {top.map((r) => (
                <li key={r.userId}>
                  <button onClick={() => setPicked(r.userId)}>
                    <i style={{ background: colorOf.get(r.userId) }} />
                    <span className="ellipsis">{r.displayName}</span>
                    <b>{usd(r.value, 0)}</b>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="pj-card pj-feed">
            <div className="pj-card-head"><h2>Latest trades</h2></div>
            {!feed.length ? <p className="muted">Nothing yet. Trades show up here as they happen.</p> : (
              <ul>
                {feed.map((a) => (
                  <li key={a.id}>
                    <Avatar user={a.user} size={28} />
                    <span className="pj-feed-text">{a.text}</span>
                    <time className="muted">{timeAgo(a.ts)}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {picked && (
        <ProfileDrawer leagueId={leagueId} userId={picked} period={period} onClose={() => setPicked(null)}
          live={live && byUser.get(picked) ? { t: live.t, values: byUser.get(picked)!.values } : undefined} />
      )}
    </div>,
    document.body,
  )
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch { /* not allowed (e.g. inside an iframe) */ }
}
