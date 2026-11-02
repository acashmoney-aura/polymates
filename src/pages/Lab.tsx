import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, cents, compactUsd, pct, qs, shortDate, signedUsd, usd, type Market, type PMEvent, type ScriptRow } from '../api'
import { AnimatedNumber } from '../components/Motion'
import { Heatmap, LineChart, Scatter } from '../components/QuantCharts'
import { Empty, Img, Spinner } from '../components/ui'
import { Icon } from '../icons'
import { align, corr, diffs, fmtNum, fmtPct, regress, rollingCorr, type Pt } from '../quant'
import { Link, navigate, useLocation, useTitle } from '../router'
import { useApp } from '../store'

const PALETTE = ['#0093fd', '#ff5952', '#ff7f0e', '#fdc503', '#9b51e0', '#2dca65', '#ff6fb5', '#5ce1e6']

type Picked = { id: string; title: string; question: string; image: string; price: number }

/** 'Event · Outcome' → 'Outcome' for compact labels */
const short = (title: string) => (title.includes(' · ') ? title.split(' · ').slice(1).join(' · ') : title)

/* ---------------- market picker ---------------- */

function MarketPicker({ picked, setPicked, max = 8 }: { picked: Picked[]; setPicked: (p: Picked[]) => void; max?: number }) {
  const { leagueId, portfolio } = useApp()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<(Market & { eventTitle: string })[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!q.trim()) return setResults([])
    const t = setTimeout(() => {
      api<{ events: PMEvent[] }>(`/api/events${qs({ q, limit: 12, league: leagueId })}`)
        .then((d) => setResults(d.events.flatMap((e) => e.markets.filter((m) => m.active).map((m) => ({ ...m, eventTitle: e.title, image: m.image || e.icon }))).slice(0, 20)))
        .catch(() => {})
    }, 200)
    return () => clearTimeout(t)
  }, [q, leagueId])
  const add = (m: Picked) => {
    if (picked.some((p) => p.id === m.id) || picked.length >= max) return
    setPicked([...picked, m])
  }
  const fromPositions = () => {
    const seen = new Set(picked.map((p) => p.id))
    const add2 = (portfolio?.positions ?? []).filter((p) => !seen.has(p.marketId) && !p.resolved).map((p) => ({
      id: p.marketId, title: p.title, question: p.question, image: p.image, price: p.outcome === 'yes' ? p.curPrice : 1 - p.curPrice,
    }))
    setPicked([...picked, ...add2].slice(0, max))
  }
  return (
    <div className="picker">
      <div className="picker-chips">
        {picked.map((p, i) => (
          <span key={p.id} className="chip-market" style={{ '--c': PALETTE[i % PALETTE.length] } as React.CSSProperties}>
            <i /> <span className="ellipsis" title={p.title}>{short(p.title)}</span>
            <button onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.title}`}><Icon name="x" size={14} /></button>
          </span>
        ))}
        {picked.length < max && (
          <div className="picker-search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder={picked.length ? 'Add another market…' : 'Search markets to add…'} />
            {open && results.length > 0 && (
              <div className="menu picker-menu">
                {results.map((m) => (
                  <button key={m.id} className="menu-item" onMouseDown={() => { add({ id: m.id, title: m.title === m.question ? m.eventTitle : `${m.eventTitle} · ${m.title}`, question: m.question, image: m.image, price: m.price }); setQ('') }}>
                    <Img src={m.image} size={28} />
                    <span className="grow ellipsis">{m.title === m.question ? m.eventTitle : <>{m.eventTitle} · <b>{m.title}</b></>}</span>
                    <span className="muted">{pct(m.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {(portfolio?.positions.length ?? 0) > 0 && picked.length < max && (
        <button className="link-btn small" onClick={fromPositions}>+ Add my positions</button>
      )}
    </div>
  )
}

function usePickedFromQuery(): [Picked[], (p: Picked[]) => void] {
  const { query } = useLocation()
  const [picked, setPicked] = useState<Picked[]>([])
  const m = query.get('m')
  useEffect(() => {
    if (!m) return
    Promise.all(m.split(',').slice(0, 8).map((id) => api<Market & { eventTitle: string | null }>(`/api/markets/${id}`).catch(() => null)))
      .then((rows) => setPicked(rows.filter(Boolean).map((r) => ({
        id: r!.id, title: r!.title === r!.question ? (r!.eventTitle ?? r!.title) : `${r!.eventTitle} · ${r!.title}`, question: r!.question, image: r!.image, price: r!.price,
      }))))
  }, [m])
  return [picked, setPicked]
}

/* ---------------- backtest ---------------- */

interface Template { id: string; name: string; description: string; code: string }
interface BacktestResult {
  ok: boolean
  error: string | null
  config: { range: string; cash: number; spread: number; feeBps: number; bars: number; barSeconds: number }
  stats: Record<string, number | null>
  equity: { t: number; equity: number; cash: number; drawdown: number; benchmark: number | null; exposure: number }[]
  fills: { t: number; title: string; side: string; outcome: string; price: number; size: number; pnl: number | null }[]
  settlements: { title: string; payout: [number, number]; value: number }[]
  logs: { t: number; level: string; msg: string }[]
}

function Tile({ label, value, format, tone, hint }: { label: string; value: number | null | undefined; format: (n: number) => string; tone?: boolean; hint?: string }) {
  const v = value ?? NaN
  return (
    <div className={`tile ${tone && Number.isFinite(v) ? (v >= 0 ? 'up' : 'down') : ''}`} title={hint}>
      <span>{label}</span>
      <b>{Number.isFinite(v) ? <AnimatedNumber value={v} format={format} /> : '—'}</b>
    </div>
  )
}

function CodeEditor({ value, onChange, onRun }: { value: string; onChange: (v: string) => void; onRun: () => void }) {
  const gutter = useRef<HTMLDivElement>(null)
  const lines = value.split('\n').length
  return (
    <div className="code-editor">
      <div className="gutter" ref={gutter} aria-hidden>{Array.from({ length: lines }, (_, i) => <span key={i}>{i + 1}</span>)}</div>
      <textarea spellCheck={false} value={value} aria-label="Strategy code"
        onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop }}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onRun() }
          if (e.key === 'Tab') {
            e.preventDefault()
            const t = e.currentTarget, s = t.selectionStart
            onChange(`${value.slice(0, s)}  ${value.slice(t.selectionEnd)}`)
            requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2 })
          }
        }} />
    </div>
  )
}

function Backtest() {
  const { user, leagueId, openAuth, toast } = useApp()
  const [templates, setTemplates] = useState<Template[]>([])
  const [code, setCode] = useState(() => { try { return localStorage.getItem('pm_bt_code') ?? '' } catch { return '' } })
  const [picked, setPicked] = usePickedFromQuery()
  const [range, setRange] = useState('1m')
  const [cash, setCash] = useState('1000')
  const [spread, setSpread] = useState('2')
  const [fee, setFee] = useState('0')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<BacktestResult | null>(null)
  const [tab, setTab] = useState<'equity' | 'drawdown' | 'trades' | 'logs'>('equity')

  useEffect(() => {
    api<Template[]>('/api/backtest/templates').then((t) => {
      setTemplates(t)
      setCode((c) => c || t[0]?.code || '')
    }).catch(() => {})
  }, [])
  useEffect(() => { try { localStorage.setItem('pm_bt_code', code) } catch { /* ignore */ } }, [code])
  useEffect(() => {
    if (picked.length || !templates.length) return
    // sensible default universe: a few liquid, uncertain markets
    api<{ events: PMEvent[] }>('/api/events?limit=30&tag=politics').then((d) => {
      const ms = d.events.flatMap((e) => e.markets.map((m) => ({ ...m, ev: e }))).filter((m) => m.active && m.price > 0.15 && m.price < 0.85).slice(0, 3)
      setPicked(ms.map((m) => ({ id: m.id, title: m.title === m.question ? m.ev.title : `${m.ev.title} · ${m.title}`, question: m.question, image: m.image || m.ev.icon, price: m.price })))
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.length])

  const run = useCallback(async () => {
    if (!user) return openAuth('signup')
    if (!picked.length) return toast('Add at least one market', 'error')
    setBusy(true)
    try {
      const r = await api<BacktestResult>('/api/backtest', {
        method: 'POST',
        body: { code, marketIds: picked.map((p) => p.id), range, cash: Number(cash), spread: Number(spread) / 100, feeBps: Number(fee) },
      })
      setRes(r)
      if (!r.ok) { toast(r.error ?? 'Backtest failed', 'error'); setTab('logs') }
      else if (tab === 'logs') setTab('equity')
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }, [user, openAuth, picked, code, range, cash, spread, fee, toast, tab])

  const deploy = async () => {
    if (!leagueId) return navigate('/league?new=1')
    try {
      const s = await api<ScriptRow>(`/api/leagues/${leagueId}/scripts`, { method: 'POST', body: { name: `Backtested bot ${new Date().toLocaleDateString()}`, code, intervalSec: 60, enabled: false } })
      toast(`Saved as live bot “${s.name}” (off). Turn it on in Agents & API.`)
      navigate('/developers')
    } catch (e) { toast((e as Error).message, 'error') }
  }

  const st = res?.stats ?? {}
  const t = res?.equity.map((e) => e.t) ?? []
  return (
    <div className="lab-bt">
      <div className="bt-left">
        <div className="bt-toolbar">
          <select value="" onChange={(e) => { const tp = templates.find((x) => x.id === e.target.value); if (tp) setCode(tp.code) }} aria-label="Load template">
            <option value="">Load template…</option>
            {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}: {tp.description}</option>)}
          </select>
          <span className="grow" />
          <span className="muted small hide-sm">⌘/Ctrl + Enter to run</span>
        </div>
        <CodeEditor value={code} onChange={setCode} onRun={run} />
        <details className="api-ref">
          <summary>pm API</summary>
          <pre>{`initialize(pm)            // optional, runs once
onTick(pm)                // runs every bar
pm.markets()  pm.market(id)  pm.book(id)  pm.now
pm.history(id, n)         // last n bars, no lookahead
pm.portfolio()  pm.orders()
pm.buy(id, 'yes'|'no', price, shares)  pm.sell(...)
pm.marketBuy(id, outcome, dollars)  pm.marketSell(id, outcome, shares)
pm.cancel(orderId)  pm.cancelAll(id?)  pm.log(...)  pm.store`}</pre>
        </details>
      </div>
      <div className="bt-right">
        <div className="card bt-config">
          <label className="field"><span>Universe ({picked.length}/8)</span></label>
          <MarketPicker picked={picked} setPicked={setPicked} />
          <div className="bt-params">
            <label className="field"><span>Range</span>
              <div className="seg">{['1d', '1w', '1m', 'all'].map((r) => <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r.toUpperCase()}</button>)}</div>
            </label>
            <label className="field"><span>Cash $</span><input inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value.replace(/\D/g, ''))} /></label>
            <label className="field"><span>Spread ¢</span><input inputMode="decimal" value={spread} onChange={(e) => setSpread(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
            <label className="field"><span>Fee bps</span><input inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value.replace(/\D/g, ''))} /></label>
          </div>
          <button className={`ledge-btn ${busy ? 'loading' : ''}`} onClick={run} disabled={busy}>
            {busy ? <><span className="spin-sm" /> Running backtest…</> : <><Icon name="play" size={14} /> Run backtest</>}
          </button>
        </div>
        {!res ? (
          <div className="card bt-empty">
            <Icon name="zap" size={28} />
            <p>Pick markets, choose a template or write your own <code>onTick(pm)</code>, and hit run. Strategies replay bar by bar over real Polymarket history, then deploy as live bots with one click.</p>
          </div>
        ) : (
          <div className="bt-results fade-up">
            <div className="tiles">
              <Tile label="Total return" value={st.totalReturn} format={(n) => fmtPct(n, 2)} tone />
              <Tile label="Benchmark" value={st.benchmarkReturn} format={(n) => fmtPct(n, 2)} tone hint="Equal-weight buy-and-hold YES" />
              <Tile label="Sharpe" value={st.sharpe} format={(n) => fmtNum(n, 2)} tone />
              <Tile label="Sortino" value={st.sortino} format={(n) => fmtNum(n, 2)} tone />
              <Tile label="Max drawdown" value={st.maxDrawdown} format={(n) => fmtPct(n, 1)} />
              <Tile label="Win rate" value={st.winRate} format={(n) => fmtPct(n, 0)} />
              <Tile label="Trades" value={st.trades} format={(n) => String(Math.round(n))} />
              <Tile label="Exposure" value={st.exposure} format={(n) => fmtPct(n, 0)} hint="Average share of equity in positions" />
              <Tile label="Beta" value={st.beta} format={(n) => fmtNum(n, 2)} />
              <Tile label="Alpha (ann.)" value={st.alpha} format={(n) => fmtPct(n, 1)} tone />
              <Tile label="Volatility" value={st.volatility} format={(n) => fmtPct(n, 1)} />
              <Tile label="Final equity" value={st.finalEquity} format={(n) => usd(n)} />
            </div>
            <div className="card bt-chart">
              <div className="text-tabs">
                {(['equity', 'drawdown', 'trades', 'logs'] as const).map((k) => (
                  <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                    {k === 'equity' ? 'Equity' : k === 'drawdown' ? 'Drawdown' : k === 'trades' ? `Trades (${res.fills.length})` : `Logs (${res.logs.length})`}
                  </button>
                ))}
                <span className="grow" />
                <button className="btn btn-outline btn-sm" onClick={deploy} disabled={!res.ok}><Icon name="bot" size={16} /> Deploy as live bot</button>
              </div>
              {res.error && <p className="error-text">{res.error}</p>}
              {tab === 'equity' && (
                <LineChart t={t} height={280} format={(v) => usd(v, 0)} series={[
                  { name: 'Strategy', color: '#0093fd', values: res.equity.map((e) => e.equity), area: true },
                  { name: 'Buy & hold', color: '#7d8189', values: res.equity.map((e) => e.benchmark), dashed: true },
                ]} />
              )}
              {tab === 'drawdown' && (
                <LineChart t={t} height={220} yMax={0} format={(v) => fmtPct(v, 0)} zero series={[
                  { name: 'Drawdown', color: '#ff5952', values: res.equity.map((e) => e.drawdown), area: true },
                ]} />
              )}
              {tab === 'trades' && (
                <div className="ptable bt-trades">
                  {!res.fills.length ? <p className="muted">No trades.</p> : res.fills.slice().reverse().map((f, i) => (
                    <div className="trow" key={i}>
                      <time className="muted small">{new Date(f.t * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })}</time>
                      <span className={`pill-side ${f.side}`}>{f.side}</span>
                      <span className={`pill-outcome ${f.outcome}`}>{f.outcome.toUpperCase()}</span>
                      <span className="grow ellipsis">{f.title}</span>
                      <span>{f.size.toFixed(1)} @ {cents(f.price)}</span>
                      <span className={`right ${f.pnl === null ? '' : f.pnl >= 0 ? 'yes-accent' : 'no-color'}`}>{f.pnl === null ? '' : signedUsd(f.pnl)}</span>
                    </div>
                  ))}
                </div>
              )}
              {tab === 'logs' && (
                <div className="logs">{!res.logs.length && !res.error ? <span className="muted">No logs. Use pm.log(...)</span> : res.logs.map((l, i) => (
                  <div key={i} className={l.level}><time>{new Date(l.t * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })}</time> {l.msg}</div>
                ))}</div>
              )}
              <p className="muted small">{res.config.bars} bars of ~{Math.round(res.config.barSeconds / 60)}m · {res.config.spread * 100}¢ simulated spread · {res.config.feeBps}bps fees{res.settlements.length ? ` · ${res.settlements.length} market(s) settled at resolution` : ''}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------- correlation ---------------- */

function Correlation() {
  const [picked, setPicked] = usePickedFromQuery()
  const [range, setRange] = useState('1m')
  const [hist, setHist] = useState<Record<string, Pt[]>>({})
  const [pair, setPair] = useState<[number, number] | null>(null)
  const [loading, setLoading] = useState(false)
  const key = picked.map((p) => p.id).join(',')
  useEffect(() => {
    if (!picked.length) return
    setLoading(true)
    Promise.all(picked.map((p) => api<Pt[]>(`/api/markets/${p.id}/history?range=${range}`).then((h) => [p.id, h] as const).catch(() => [p.id, []] as const)))
      .then((rows) => setHist(Object.fromEntries(rows)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, range])
  useEffect(() => {
    if (picked.length >= 2) return
    // starter set: the top outcomes of a big multi-outcome event are usually strongly (negatively) linked
    api<{ events: PMEvent[] }>('/api/events?limit=20&tag=politics').then((d) => {
      const e = d.events.find((x) => x.markets.filter((m) => m.active && m.price > 0.05).length >= 3)
      if (!e || picked.length >= 2) return
      setPicked(e.markets.filter((m) => m.active).sort((a, b) => b.price - a.price).slice(0, 4)
        .map((m) => ({ id: m.id, title: `${e.title} · ${m.title}`, question: m.question, image: m.image || e.icon, price: m.price })))
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const calc = useMemo(() => {
    const ok = picked.filter((p) => (hist[p.id]?.length ?? 0) > 2)
    if (ok.length < 2) return null
    const { t, v } = align(ok.map((p) => hist[p.id]), 400)
    const d = v.map(diffs)
    const matrix = ok.map((_, i) => ok.map((__, j) => (i === j ? 1 : corr(d[i], d[j]))))
    return { ok, t, v, d, matrix }
  }, [picked, hist])

  const sel = calc && pair && pair[0] !== pair[1] && pair[0] < calc.ok.length && pair[1] < calc.ok.length ? pair : calc && calc.ok.length >= 2 ? ([0, 1] as [number, number]) : null
  const reg = calc && sel ? regress(calc.d[sel[0]], calc.d[sel[1]]) : null
  const roll = calc && sel ? rollingCorr(calc.d[sel[0]], calc.d[sel[1]], Math.max(10, Math.round(calc.t.length / 8))) : []
  const strongest = calc ? calc.matrix.flatMap((row, i) => row.map((c, j) => ({ i, j, c }))).filter((x) => x.i < x.j && Number.isFinite(x.c)).sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 3) : []

  return (
    <div className="lab-corr">
      <div className="card corr-config">
        <MarketPicker picked={picked} setPicked={setPicked} />
        <div className="seg">{['1w', '1m', 'all'].map((r) => <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r.toUpperCase()}</button>)}</div>
      </div>
      {loading && <Spinner />}
      {!loading && !calc && <Empty title="Pick at least two markets">Correlation is computed on aligned changes in probability, not price levels, so two markets that both drift up are not counted as related unless they move together.</Empty>}
      {calc && (
        <div className="corr-grid fade-up">
          <div className="card corr-card">
            <h3>Correlation matrix</h3>
            <p className="muted small">Pearson correlation of probability changes · {calc.t.length} aligned samples · click a cell</p>
            <Heatmap labels={calc.ok.map((p) => short(p.title))} matrix={calc.matrix} picked={sel} onPick={(i, j) => setPair([i, j])} />
            <div className="legend-bar"><span>−1</span><i /><span>+1</span></div>
            {strongest.length > 0 && (
              <ul className="insights">
                {strongest.map((x) => (
                  <li key={`${x.i}-${x.j}`}>
                    <b className={x.c > 0 ? 'brand-text' : 'red-text'}>{x.c.toFixed(2)}</b> {short(calc.ok[x.i].title)} <span className="muted">×</span> {short(calc.ok[x.j].title)}
                    <span className="muted"> · {Math.abs(x.c) > 0.6 ? 'strong' : Math.abs(x.c) > 0.3 ? 'moderate' : 'weak'} {x.c > 0 ? 'co-movement' : 'inverse (hedge)'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {sel && reg && (
            <div className="card corr-card">
              <h3 className="ellipsis">{short(calc.ok[sel[0]].title)} <span className="muted">vs</span> {short(calc.ok[sel[1]].title)}</h3>
              <div className="tiles small-tiles">
                <Tile label="ρ" value={calc.matrix[sel[0]][sel[1]]} format={(n) => fmtNum(n, 3)} tone />
                <Tile label="β (y on x)" value={reg.beta} format={(n) => fmtNum(n, 3)} />
                <Tile label="R²" value={reg.r2} format={(n) => fmtNum(n, 3)} />
                <Tile label="Hedge ratio" value={-reg.beta} format={(n) => `${fmtNum(n, 2)}×`} hint="Shares of x per share of y to neutralize co-movement" />
              </div>
              <Scatter x={calc.d[sel[0]]} y={calc.d[sel[1]]} xLabel={`#${sel[0] + 1}`} yLabel={`#${sel[1] + 1}`} beta={reg.beta} alpha={reg.alpha} />
              <h4>Rolling correlation</h4>
              <LineChart t={calc.t.slice(1)} height={150} yMin={-1} yMax={1} zero format={(v) => v.toFixed(1)}
                series={[{ name: 'ρ', color: '#9b51e0', values: roll, area: false }]} />
            </div>
          )}
          <div className="card corr-card wide">
            <h3>Prices</h3>
            <LineChart t={calc.t} height={240} yMin={0} yMax={1} format={(v) => `${Math.round(v * 100)}%`}
              series={calc.ok.map((p, i) => ({ name: short(p.title), color: PALETTE[i % PALETTE.length], values: calc.v[i] }))} />
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------- scanner ---------------- */

interface ScanRow { marketId?: string; title: string; eventSlug: string | null; eventTitle?: string; image: string; price?: number; change24h?: number | null; volume24h?: number; volume?: number; spread?: number; endDate?: string | null }
interface Scan {
  overround: { eventSlug: string; title: string; image: string; outcomes: number; sumMid: number; sumAsk: number; sumBid: number; arb: string | null; volume: number }[]
  movers: ScanRow[]; coinflips: ScanRow[]; spreads: ScanRow[]; longshots: ScanRow[]
}

function Scanner() {
  const [data, setData] = useState<Scan | null>(null)
  const [tab, setTab] = useState<'overround' | 'movers' | 'coinflips' | 'spreads' | 'longshots'>('overround')
  useEffect(() => {
    const load = () => api<Scan>('/api/quant/scanner').then(setData).catch(() => {})
    void load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])
  const desc: Record<typeof tab, string> = {
    overround: 'One-winner events whose YES prices don’t add up to 100%. If buying every YES at the ask costs under $1 (or selling every YES at the bid pays over $1), that’s a locked-in arb, so check the live book first.',
    movers: 'Biggest 24h moves among liquid, undecided markets.',
    coinflips: 'Close to 50/50 and resolving within 7 days: maximum variance.',
    spreads: 'Widest bid/ask among active markets, where market makers can earn the spread.',
    longshots: 'High-volume markets priced under 5¢. The favorite-longshot bias says these are often overpriced.',
  }
  return (
    <div className="lab-scan">
      <div className="text-tabs">
        {(['overround', 'movers', 'coinflips', 'spreads', 'longshots'] as const).map((k) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {{ overround: 'Overround & arbs', movers: 'Movers', coinflips: 'Coin flips', spreads: 'Wide spreads', longshots: 'Long shots' }[k]}
          </button>
        ))}
      </div>
      <p className="muted small">{desc[tab]}</p>
      {!data ? <Spinner /> : tab === 'overround' ? (
        <div className="ptable scan-table">
          <div className="ptable-head scan-head"><span>Event</span><span>Σ mid</span><span>Σ ask</span><span>Σ bid</span></div>
          {data.overround.map((r, i) => (
            <Link key={r.eventSlug} to={`/event/${r.eventSlug}`} className="ptable-row scan-row" style={{ animationDelay: `${i * 20}ms` }}>
              <span className="pt-market"><Img src={r.image} size={36} /><span className="pt-text"><span className="ellipsis">{r.title}</span>
                <small className="muted">{r.outcomes} outcomes · {compactUsd(r.volume)} vol {r.arb && <span className="arb-tag">{r.arb === 'buy-all' ? 'BUY-ALL ARB' : 'SELL-ALL ARB'}</span>}</small></span></span>
              <span className={Math.abs(r.sumMid - 1) > 0.03 ? 'no-color' : ''}>{pct(r.sumMid)}</span>
              <span>{pct(r.sumAsk)}</span>
              <span>{pct(r.sumBid)}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="ptable scan-table">
          {(data[tab] as ScanRow[]).map((r, i) => (
            <div key={`${r.marketId}-${i}`} className="ptable-row scan-row" style={{ animationDelay: `${i * 20}ms` }}>
              <Link to={r.eventSlug ? `/event/${r.eventSlug}?m=${r.marketId}` : '/'} className="pt-market">
                <Img src={r.image} size={36} />
                <span className="pt-text"><span className="ellipsis">{r.eventTitle && r.eventTitle !== r.title ? `${r.eventTitle} · ${r.title}` : r.title}</span>
                  <small className="muted">
                    {tab === 'movers' && `${compactUsd(r.volume24h ?? 0)} 24h vol`}
                    {tab === 'coinflips' && `resolves ${shortDate(r.endDate ?? null)}`}
                    {tab === 'spreads' && `${compactUsd(r.volume24h ?? 0)} 24h vol`}
                    {tab === 'longshots' && `${compactUsd(r.volume ?? 0)} vol · ends ${shortDate(r.endDate ?? null)}`}
                  </small></span>
              </Link>
              <span>{pct(r.price ?? 0)}</span>
              <span className={tab === 'movers' ? ((r.change24h ?? 0) >= 0 ? 'yes-accent' : 'no-color') : ''}>
                {tab === 'movers' ? `${(r.change24h ?? 0) >= 0 ? '▲' : '▼'} ${Math.abs(Math.round((r.change24h ?? 0) * 100))}pp` : tab === 'spreads' ? cents(r.spread ?? 0) : ''}
              </span>
              <span className="right row-actions">
                <Link to={`/lab?tab=backtest&m=${r.marketId}`} className="icon-btn" title="Backtest"><Icon name="zap" size={16} /></Link>
                <Link to={`/lab?tab=correlation&m=${r.marketId}`} className="icon-btn" title="Correlate"><Icon name="swap" size={16} /></Link>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Lab() {
  const { query } = useLocation()
  const tab = (query.get('tab') as 'backtest' | 'correlation' | 'scanner') || 'backtest'
  useTitle('Quant Lab')
  return (
    <div className="wrap page lab">
      <div className="lab-hero">
        <div>
          <h1><span className="gradient-text">Quant Lab</span></h1>
          <p className="muted">Backtest strategies on real Polymarket history, find correlated markets, and scan for mispricings. Every tool here is also available to agents over MCP.</p>
        </div>
      </div>
      <div className="lab-tabs">
        {([['backtest', 'Backtest', 'zap'], ['correlation', 'Correlation', 'swap'], ['scanner', 'Scanner', 'search']] as const).map(([k, label, icon]) => (
          <Link key={k} to={`/lab?tab=${k}`} className={`lab-tab ${tab === k ? 'active' : ''}`}><Icon name={icon} size={16} /> {label}</Link>
        ))}
      </div>
      <div key={tab} className="fade-up">
        {tab === 'backtest' && <Backtest />}
        {tab === 'correlation' && <Correlation />}
        {tab === 'scanner' && <Scanner />}
      </div>
    </div>
  )
}
