import { useEffect, useMemo, useState } from 'react'
import { api, cents, compactUsd, pct, signedUsd } from '../api'
import { LineChart } from '../components/QuantCharts'
import { Histogram, retColor, ReturnsGrid, Sparkline, VolCone, type ConeRow } from '../components/ProCharts'
import { Empty, Img, Spinner } from '../components/ui'
import { Icon } from '../icons'
import { fmtNum, fmtPct } from '../quant'
import { Link, useLocation } from '../router'
import { useApp } from '../store'
import type { BacktestResult, Picked } from './Lab'
import { MarketPicker, Tile } from './Lab'

const pp = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}pp` : '—')

/* ---------------- volatility ---------------- */

interface VolRow {
  marketId: string; title: string; question: string; eventSlug: string | null; eventTitle: string; image: string; category: string; price: number
  volume24h: number; vol1d: number | null; vol7d: number | null; regime: number | null; range7d: number | null; change7d: number | null; spark: number[]
}
interface Cone { marketId: string; title: string; question: string; eventSlug: string | null; price: number; cone: (ConeRow & { hours: number; n: number })[] }


export function Volatility() {
  const { query } = useLocation()
  const [rows, setRows] = useState<VolRow[] | null>(null)
  const [sort, setSort] = useState<'vol1d' | 'vol7d' | 'regime'>('vol1d')
  const [exSports, setExSports] = useState(false)
  const [sel, setSel] = useState<string | null>(query.get('m'))
  const [cone, setCone] = useState<Cone | null>(null)
  const [coneBusy, setConeBusy] = useState(false)
  const [picked, setPicked] = useState<Picked[]>([])

  useEffect(() => {
    const load = () => api<{ markets: VolRow[] }>('/api/quant/volatility?limit=40').then((d) => setRows(d.markets)).catch(() => setRows([]))
    void load()
    const t = setInterval(load, 120_000)
    return () => clearInterval(t)
  }, [])
  const active = sel ?? rows?.find((r) => !['Sports', 'Esports'].includes(r.category))?.marketId ?? rows?.[0]?.marketId ?? null
  useEffect(() => {
    if (!active) return
    setConeBusy(true)
    api<Cone>(`/api/markets/${active}/volcone`).then(setCone).catch(() => setCone(null)).finally(() => setConeBusy(false))
  }, [active])
  useEffect(() => {
    if (picked[0]) { setSel(picked[0].id); setPicked([]) }
  }, [picked])

  const sorted = useMemo(() => (rows ?? []).filter((r) => !exSports || !['Sports', 'Esports'].includes(r.category)).sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0)), [rows, sort, exSports])
  const maxVol = Math.max(1e-6, ...sorted.map((r) => r.vol1d ?? 0))
  const d1 = cone?.cone.find((c) => c.window === '1d')
  const verdict = d1?.percentile === null || d1?.percentile === undefined ? null
    : d1.percentile > 0.8 ? { tone: 'no-color', text: `Daily vol is running hot: ${Math.round(d1.percentile * 100)}th percentile of the last week. Expect wider swings; fade only with size you can hold through noise.` }
      : d1.percentile < 0.2 ? { tone: 'yes-accent', text: `Daily vol is compressed: ${Math.round(d1.percentile * 100)}th percentile. Quiet markets tend to break out around news; a cheap time to build a position.` }
        : { tone: '', text: `Daily vol is normal for this market (${Math.round(d1.percentile * 100)}th percentile of the last week).` }

  return (
    <div className="lab-vol">
      <div className="card vol-cone-card">
        <div className="vol-cone-head">
          <div className="grow" style={{ minWidth: 0 }}>
            <h4>Realized-vol cone</h4>
            {cone ? (
              <Link to={cone.eventSlug ? `/event/${cone.eventSlug}?m=${cone.marketId}` : '/'} className="vol-title ellipsis">{cone.question} <span className="muted mono">{pct(cone.price)}</span></Link>
            ) : <span className="muted">Pick a market</span>}
          </div>
          <div className="vol-pick"><MarketPicker picked={picked} setPicked={setPicked} max={1} /></div>
        </div>
        {coneBusy && !cone ? <Spinner /> : cone && (
          <div className={coneBusy ? 'dim' : 'fade-up'} key={cone.marketId}>
            <VolCone rows={cone.cone} format={pp} />
            <div className="cone-legend mono small">
              <span><i className="lg-band" /> p10–p90</span><span><i className="lg-band dark" /> p25–p75</span><span><i className="lg-median" /> median</span><span><i className="lg-cur" /> now</span>
            </div>
            <div className="cone-table mono">
              <div className="cn-row head"><span>window</span><span>now</span><span>pct</span><span>p25</span><span>median</span><span>p75</span><span>max</span></div>
              {cone.cone.map((c) => (
                <div className="cn-row" key={c.window}>
                  <span>{c.window}</span>
                  <b>{pp(c.current ?? NaN)}</b>
                  <span className={c.percentile === null ? '' : c.percentile > 0.8 ? 'no-color' : c.percentile < 0.2 ? 'yes-accent' : ''}>{c.percentile === null ? '—' : `${Math.round(c.percentile * 100)}`}</span>
                  <span>{pp(c.p25 ?? NaN)}</span><span>{pp(c.median ?? NaN)}</span><span>{pp(c.p75 ?? NaN)}</span><span>{pp(c.max ?? NaN)}</span>
                </div>
              ))}
            </div>
            {verdict && <p className={`small ${verdict.tone}`}>{verdict.text}</p>}
            <p className="muted small">Realized vol of the YES price in probability points per √day: √(Σ Δp² / window days), measured over every rolling window in the sample.</p>
          </div>
        )}
      </div>

      <div className="card vol-rank">
        <div className="vol-rank-head">
          <h4>Most volatile active markets</h4>
          <span className="grow" />
          <div className="seg seg-sm"><button className={!exSports ? 'active' : ''} onClick={() => setExSports(false)}>all</button><button className={exSports ? 'active' : ''} onClick={() => setExSports(true)}>ex-sports</button></div>
          <div className="seg seg-sm">
            {([['vol1d', 'σ 24h'], ['vol7d', 'σ 7d'], ['regime', 'regime']] as const).map(([k, l]) => <button key={k} className={sort === k ? 'active' : ''} onClick={() => setSort(k)}>{l}</button>)}
          </div>
        </div>
        {!rows ? <Spinner /> : !rows.length ? <Empty title="No data yet">The catalog is still loading. Try again in a minute.</Empty> : (
          <div className="vr-table">
            <div className="vr-row head mono"><span>market</span><span>px</span><span>σ 24h</span><span className="hide-sm">σ 7d</span><span className="hide-sm">regime</span><span>7d</span></div>
            {sorted.map((r, i) => (
              <button key={r.marketId} className={`vr-row ${active === r.marketId ? 'active' : ''}`} onClick={() => setSel(r.marketId)} style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }}>
                <span className="vr-market"><Img src={r.image} size={28} /><span className="pt-text"><span className="ellipsis">{r.eventTitle && r.eventTitle !== r.title ? <><b>{r.title}</b> <span className="muted">{r.eventTitle}</span></> : r.title}</span><small className="muted">{compactUsd(r.volume24h)} 24h</small></span></span>
                <span className="mono">{cents(r.price)}</span>
                <span className="vr-vol mono"><i style={{ width: `${((r.vol1d ?? 0) / maxVol) * 100}%` }} />{pp(r.vol1d ?? NaN)}</span>
                <span className="mono hide-sm">{pp(r.vol7d ?? NaN)}</span>
                <span className={`mono hide-sm ${(r.regime ?? 1) > 1.5 ? 'no-color' : (r.regime ?? 1) < 0.67 ? 'yes-accent' : ''}`} title="24h vol ÷ 7d vol: above 1 means vol is rising">{r.regime === null ? '—' : `${r.regime.toFixed(2)}×`}</span>
                <span><Sparkline values={r.spark} width={84} height={26} /></span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------- backtest analytics ---------------- */

type Eq = BacktestResult['equity'][number]

/** Bucket the equity curve into a period grid: hours×days, days×weeks or months×years. */
function periodReturns(eq: Eq[]) {
  if (eq.length < 3) return null
  const span = eq[eq.length - 1].t - eq[0].t
  const D = (t: number) => new Date(t * 1000)
  const mode = span <= 3 * 86400 ? 'hour' : span <= 150 * 86400 ? 'day' : 'month'
  const cols = mode === 'hour' ? ['0', '3', '6', '9', '12', '15', '18', '21'] : mode === 'day' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
  const key = (t: number) => {
    const d = D(t)
    if (mode === 'hour') return { row: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), col: Math.floor(d.getHours() / 3) }
    if (mode === 'day') {
      const dow = (d.getDay() + 6) % 7
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow)
      return { row: monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), col: dow }
    }
    return { row: String(d.getFullYear()), col: d.getMonth() }
  }
  const rows: string[] = []
  const cells: (number | null)[][] = []
  let prevEnd = eq[0].equity
  let cur: { row: string; col: number } | null = null
  let last = eq[0].equity
  const close = () => {
    if (!cur) return
    let ri = rows.indexOf(cur.row)
    if (ri < 0) { rows.push(cur.row); cells.push(cols.map(() => null)); ri = rows.length - 1 }
    cells[ri][cur.col] = prevEnd > 0 ? last / prevEnd - 1 : 0
    prevEnd = last
  }
  for (const e of eq) {
    const k = key(e.t)
    if (!cur || k.row !== cur.row || k.col !== cur.col) { close(); cur = k }
    last = e.equity
  }
  close()
  const totals = cells.map((r) => (r.some((v) => v !== null) ? r.reduce<number>((a, v) => a * (1 + (v ?? 0)), 1) - 1 : null))
  return { mode, rows, cols, cells, totals }
}

function underwater(eq: Eq[]) {
  let longest = 0, run = 0, under = 0, start = eq[0]?.t ?? 0, longestFrom = 0
  for (const e of eq) {
    if (e.drawdown < -1e-9) {
      if (run === 0) start = e.t
      run = e.t - start
      under++
      if (run > longest) { longest = run; longestFrom = start }
    } else run = 0
  }
  return { longest, longestFrom, share: eq.length ? under / eq.length : 0, current: eq[eq.length - 1]?.drawdown ?? 0 }
}

const dur = (s: number) => (s >= 86400 ? `${(s / 86400).toFixed(1)}d` : `${(s / 3600).toFixed(1)}h`)

export function UnderwaterStats({ res }: { res: BacktestResult }) {
  const u = useMemo(() => underwater(res.equity), [res])
  return (
    <div className="tiles small-tiles">
      <Tile label="Max drawdown" value={res.stats.maxDrawdown} format={(n) => fmtPct(n, 1)} />
      <Tile label="Current DD" value={u.current} format={(n) => fmtPct(n, 1)} />
      <Tile label="Longest DD" value={u.longest} format={dur} hint={u.longest ? `from ${new Date(u.longestFrom * 1000).toLocaleDateString()}` : undefined} />
      <Tile label="Time underwater" value={u.share} format={(n) => fmtPct(n, 0)} />
    </div>
  )
}

export function BacktestAnalytics({ res }: { res: BacktestResult }) {
  const grid = useMemo(() => periodReturns(res.equity), [res])
  const rolling = useMemo(() => {
    const eq = res.equity.map((e) => e.equity)
    const rets = eq.map((v, i) => (i && eq[i - 1] > 0 ? v / eq[i - 1] - 1 : 0))
    const win = Math.max(24, Math.round(eq.length / 5))
    const ppy = (365 * 86400) / Math.max(1, res.config.barSeconds)
    const out: (number | null)[] = []
    let s = 0, s2 = 0
    for (let i = 0; i < rets.length; i++) {
      s += rets[i]; s2 += rets[i] ** 2
      if (i >= win) { s -= rets[i - win]; s2 -= rets[i - win] ** 2 }
      if (i < win) { out.push(null); continue }
      const m = s / win
      const sd = Math.sqrt(Math.max(0, s2 / win - m * m))
      out.push(sd > 1e-9 ? Math.max(-10, Math.min(10, (m / sd) * Math.sqrt(ppy))) : null)
    }
    return { out, win }
  }, [res])
  const pnls = res.fills.map((f) => f.pnl).filter((p): p is number => p !== null)
  const wins = pnls.filter((p) => p > 0), losses = pnls.filter((p) => p <= 0)
  const pf = losses.length ? wins.reduce((a, b) => a + b, 0) / Math.abs(losses.reduce((a, b) => a + b, 0) || 1e-9) : null
  const fmtR = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}`
  return (
    <div className="bt-analytics fade-up">
      <div className="card bt-a wide">
        <div className="bt-a-head">
          <h4>{grid?.mode === 'hour' ? 'Returns by 3h block' : grid?.mode === 'day' ? 'Daily returns by week' : 'Monthly returns'}</h4>
          <span className="muted small">% per period · Σ compounds the row</span>
        </div>
        {grid ? <ReturnsGrid rows={grid.rows} cols={grid.cols} cells={grid.cells} totals={grid.totals} format={fmtR} /> : <p className="muted small">Not enough bars.</p>}
      </div>
      <div className="card bt-a">
        <div className="bt-a-head"><h4>Rolling Sharpe</h4><span className="muted small">{rolling.win}-bar window, annualized</span></div>
        <LineChart t={res.equity.map((e) => e.t)} height={170} zero format={(v) => v.toFixed(1)}
          series={[{ name: 'Sharpe', color: '#9b51e0', values: rolling.out, area: true }]} />
      </div>
      <div className="card bt-a">
        <div className="bt-a-head"><h4>Trade P&amp;L distribution</h4><span className="muted small">{pnls.length} closed · PF {pf === null ? '—' : fmtNum(pf, 2)}</span></div>
        <Histogram values={pnls} format={(v) => signedUsd(v).replace('.00', '')} height={170} />
      </div>
    </div>
  )
}

/* ---------------- parameter sweep ---------------- */

interface SweepCell { x: number; y: number | null; ok: boolean; error: string | null; sharpe: number; totalReturn: number; maxDrawdown: number; trades: number }
interface SweepRes { params: { name: string; values: number[] }[]; cells: SweepCell[]; best: SweepCell | null; truncated: boolean; ms: number }

const around = (v: number) => {
  const raw = v === 0 ? [0, 1, 2, 3, 4] : [0.5, 0.75, 1, 1.5, 2].map((f) => v * f)
  // integer constants (lookbacks, sizes) stay integers
  const r = raw.map((x) => (Number.isInteger(v) ? Math.max(1, Math.round(x)) : Math.abs(v) >= 1 ? Math.round(x * 10) / 10 : Math.round(x * 1000) / 1000))
  return [...new Set(r)].join(', ')
}
const parseVals = (s: string) => [...new Set(s.split(/[,\s]+/).map(Number).filter(Number.isFinite))].slice(0, 12)

export function Sweep({ code, setCode, body }: { code: string; setCode: (c: string) => void; body: Record<string, unknown> }) {
  const { user, openAuth, toast } = useApp()
  const [params, setParams] = useState<{ name: string; value: number }[]>([])
  const [px, setPx] = useState(''), [py, setPy] = useState('')
  const [vx, setVx] = useState(''), [vy, setVy] = useState('')
  const [metric, setMetric] = useState<'sharpe' | 'totalReturn' | 'maxDrawdown'>('sharpe')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<SweepRes | null>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ name: string; value: number }[]>('/api/backtest/params', { method: 'POST', body: { code } }).then(setParams).catch(() => {})
    }, 400)
    return () => clearTimeout(t)
  }, [code])
  useEffect(() => {
    if (!params.length) return
    if (!params.some((p) => p.name === px)) { setPx(params[0].name); setVx(around(params[0].value)) }
    if (py && !params.some((p) => p.name === py)) setPy('')
  }, [params, px, py])
  const choose = (which: 'x' | 'y', name: string) => {
    const p = params.find((q) => q.name === name)
    if (which === 'x') { setPx(name); if (p) setVx(around(p.value)) } else { setPy(name); setVy(p ? around(p.value) : '') }
  }
  const xs = parseVals(vx), ys = py ? parseVals(vy) : []
  const cellsN = xs.length * Math.max(1, ys.length)
  const run = async () => {
    if (!user) return openAuth('signup')
    setBusy(true)
    try {
      const ps = [{ name: px, values: xs }, ...(py ? [{ name: py, values: ys }] : [])]
      setRes(await api<SweepRes>('/api/backtest/sweep', { method: 'POST', body: { ...body, code, params: ps } }))
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const apply = (c: SweepCell) => {
    if (!res) return
    let next = code
    const sub = (name: string, v: number) => { next = next.replace(new RegExp(`(\\b${name.replace(/[$]/g, '\\$')}\\s*=\\s*)(-?\\d+(?:\\.\\d+)?)`), `$1${v}`) }
    sub(res.params[0].name, c.x)
    if (res.params[1] && c.y !== null) sub(res.params[1].name, c.y)
    setCode(next)
    toast(`Applied ${res.params[0].name}=${c.x}${res.params[1] ? `, ${res.params[1].name}=${c.y}` : ''}. Run the backtest to see it.`)
  }
  const val = (c: SweepCell) => (metric === 'sharpe' ? c.sharpe : metric === 'totalReturn' ? c.totalReturn : c.maxDrawdown)
  const fmt = (v: number) => (metric === 'sharpe' ? v.toFixed(2) : fmtPct(v, 1))
  // Sharpe and return diverge from 0; drawdown (always ≤ 0) diverges from the middle of the grid
  const okVals = res ? res.cells.filter((c) => c.ok).map(val) : []
  const center = metric === 'maxDrawdown' && okVals.length ? (Math.min(...okVals) + Math.max(...okVals)) / 2 : 0
  const scale = Math.max(1e-6, ...okVals.map((v) => Math.abs(v - center)))
  const ry = res ? (res.params[1]?.values ?? [null]) : []

  return (
    <div className="card sweep">
      <div className="bt-a-head">
        <h4><Icon name="zap" size={14} /> Parameter sweep</h4>
        <span className="muted small">grid-search 1–2 constants · max 30 runs</span>
      </div>
      {!params.length ? <p className="muted small">Declare tunable constants at the top of your strategy, e.g. <code>const FAST = 6, SLOW = 24</code>.</p> : (
        <>
          <div className="sweep-form">
            <label className="field"><span>X param</span>
              <select value={px} onChange={(e) => choose('x', e.target.value)}>{params.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.value})</option>)}</select></label>
            <label className="field grow"><span>X values</span><input value={vx} onChange={(e) => setVx(e.target.value)} className="mono" /></label>
            <label className="field"><span>Y param</span>
              <select value={py} onChange={(e) => choose('y', e.target.value)}><option value="">none</option>{params.filter((p) => p.name !== px).map((p) => <option key={p.name} value={p.name}>{p.name} ({p.value})</option>)}</select></label>
            {py && <label className="field grow"><span>Y values</span><input value={vy} onChange={(e) => setVy(e.target.value)} className="mono" /></label>}
          </div>
          <div className="sweep-actions">
            <button className={`btn btn-sm ${busy ? 'loading' : ''} btn-primary`} disabled={busy || !xs.length || cellsN > 30 || (!!py && !ys.length)} onClick={run}>
              {busy ? <><span className="spin-sm" /> Sweeping {cellsN} runs…</> : <><Icon name="play" size={14} /> Sweep {cellsN} runs</>}
            </button>
            {cellsN > 30 && <span className="no-color small">Too many combinations ({cellsN} &gt; 30)</span>}
            <span className="grow" />
            {res && <div className="seg seg-sm">{([['sharpe', 'Sharpe'], ['totalReturn', 'Return'], ['maxDrawdown', 'Max DD']] as const).map(([k, l]) => <button key={k} className={metric === k ? 'active' : ''} onClick={() => setMetric(k)}>{l}</button>)}</div>}
          </div>
        </>
      )}
      {res && (
        <div className="fade-up">
          <div className="sweep-grid" style={{ gridTemplateColumns: `minmax(44px, auto) repeat(${res.params[0].values.length}, minmax(44px, 1fr))` }}>
            <span className="rg-col mono">{res.params[1]?.name ?? ''}{res.params[1] ? ' ↓' : ''} {res.params[0].name} →</span>
            {res.params[0].values.map((x) => <span key={x} className="rg-col mono">{x}</span>)}
            {ry.map((y) => (
              <div key={String(y)} style={{ display: 'contents' }}>
                <span className="rg-row mono">{y ?? ''}</span>
                {res.params[0].values.map((x, j) => {
                  const c = res.cells.find((k) => k.x === x && k.y === y)
                  const isBest = !!c && !!res.best && c.x === res.best.x && c.y === res.best.y
                  const v = c && c.ok ? val(c) : null
                  return (
                    <button key={x} className={`sw-cell mono ${isBest ? 'best' : ''}`} disabled={!c?.ok}
                      style={{ background: v === null ? 'var(--surface-3)' : retColor(v - center, scale), animationDelay: `${j * 20}ms` }}
                      title={c ? (c.ok ? `${res.params[0].name}=${x}${y !== null ? ` ${res.params[1].name}=${y}` : ''}\nSharpe ${c.sharpe.toFixed(2)} · return ${fmtPct(c.totalReturn, 1)} · DD ${fmtPct(c.maxDrawdown, 1)} · ${c.trades} trades\nClick to apply` : c.error ?? 'failed') : 'not run'}
                      onClick={() => c && apply(c)}>
                      {v === null ? '×' : fmt(v)}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          <p className="muted small">
            {res.best ? <>Best Sharpe <b className="mono">{res.best.sharpe.toFixed(2)}</b> at {res.params[0].name}={res.best.x}{res.params[1] ? `, ${res.params[1].name}=${res.best.y}` : ''}. </> : 'No run succeeded. '}
            {res.cells.length} runs in {(res.ms / 1000).toFixed(1)}s{res.truncated ? ' (time budget hit, grid is partial)' : ''}. Click a cell to apply it. A sharp peak surrounded by losers is usually overfit; look for a plateau.
          </p>
        </div>
      )}
    </div>
  )
}
