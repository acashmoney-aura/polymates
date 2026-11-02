import { useId, useRef, useState } from 'react'
import { api, signedUsd, usd } from '../api'
import { Icon } from '../icons'
import { fmtPct, fmtPrice, liqPrice, type PerpAsset, type PerpPosition, type PerpSide } from '../perps'
import { Link } from '../router'
import { useApp } from '../store'
import { burst } from './Motion'

/* ---------------- small pieces ---------------- */

export function AssetIcon({ asset, size = 32 }: { asset: Pick<PerpAsset, 'icon' | 'symbol'>; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (!asset.icon || broken) {
    return <span className="perp-icon perp-icon-fallback" style={{ width: size, height: size, fontSize: size * 0.4 }}>{asset.symbol.slice(0, 2)}</span>
  }
  return <img className="perp-icon" src={asset.icon} width={size} height={size} alt="" loading="lazy" onError={() => setBroken(true)} />
}

export function Sparkline({ values, up, width = 100, height = 32, fill = false }: { values: number[]; up: boolean; width?: number; height?: number; fill?: boolean }) {
  const gid = useId().replace(/:/g, '')
  if (values.length < 2) return <svg width={width} height={height} className="spark" />
  const lo = Math.min(...values), hi = Math.max(...values)
  const span = hi - lo || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, 2 + (1 - (v - lo) / span) * (height - 4)] as const)
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
  const color = up ? 'var(--yes-text)' : 'var(--no-text)'
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="spark">
      {fill && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d}L${width},${height}L0,${height}Z`} fill={`url(#${gid})`} />
        </>
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={fill ? 1.75 : 1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

export function StarButton({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button className={`perp-star ${on ? 'on' : ''}`} aria-pressed={on} aria-label={`${on ? 'Remove' : 'Add'} ${label} ${on ? 'from' : 'to'} watchlist`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle() }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />
      </svg>
    </button>
  )
}

export const changeClass = (x: number | null | undefined) => ((x ?? 0) >= 0 ? 'yes-accent' : 'no-color')

/* ---------------- trade panel ---------------- */

export function PerpTradePanel({ asset, onDone }: { asset: PerpAsset; onDone?: () => void }) {
  const { user, leagueId, portfolio, openAuth, toast, refreshPortfolio } = useApp()
  const [side, setSide] = useState<PerpSide>('long')
  const [amount, setAmount] = useState('')
  const [leverage, setLeverage] = useState(Math.min(10, asset.maxLeverage))
  const [showTpsl, setShowTpsl] = useState(false)
  const [tp, setTp] = useState('')
  const [sl, setSl] = useState('')
  const [busy, setBusy] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const lev = Math.min(leverage, asset.maxLeverage)

  const cash = portfolio?.availableCash ?? 0
  const notional = Number(amount) || 0
  const margin = notional / lev
  const fee = notional * asset.feeRate
  const liq = liqPrice(side, asset.price, lev, asset.maintenanceRate)
  const tooMuch = margin + fee > cash + 1e-9
  const maxNotional = Math.floor(((cash / (1 / lev + asset.feeRate)) * 100)) / 100

  const submit = async () => {
    if (!user) return openAuth('signup')
    if (!leagueId) return
    setBusy(true)
    try {
      const res = await api<{ position: PerpPosition }>(`/api/leagues/${leagueId}/perps`, {
        method: 'POST',
        body: { symbol: asset.symbol, side, amount: notional, leverage: lev, takeProfit: tp ? Number(tp) : undefined, stopLoss: sl ? Number(sl) : undefined },
      })
      const r = btn.current?.getBoundingClientRect()
      if (r) burst(r.left + r.width / 2, r.top + r.height / 2)
      toast(`${side === 'long' ? 'Long' : 'Short'} ${asset.symbol} ${lev}x opened at ${fmtPrice(res.position.entryPrice)}`)
      setAmount('')
      setTp('')
      setSl('')
      void refreshPortfolio()
      onDone?.()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="trade-panel perp-panel">
      <div className="perp-side">
        {(['long', 'short'] as const).map((s) => (
          <button key={s} className={`trading-btn ${s === 'long' ? 'yes' : 'no'} ${side === s ? 'selected' : ''}`} onClick={() => setSide(s)}>
            <span>{s === 'long' ? 'Long' : 'Short'}</span>
          </button>
        ))}
      </div>
      <div className="tp-amount">
        <label>Amount<small>Cash {usd(cash)}</small></label>
        <div className="amount-input">
          <span className={amount ? '' : 'muted'}>$</span>
          <input inputMode="decimal" value={amount} placeholder="0" aria-label="Position size in dollars"
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
      </div>
      <div className="chips">
        {[10, 100, 1000].map((d) => <button key={d} onClick={() => setAmount(String(Math.round(((Number(amount) || 0) + d) * 100) / 100))}>+${d.toLocaleString()}</button>)}
        <button onClick={() => setAmount(String(Math.max(0, maxNotional)))}>Max</button>
      </div>
      <div className="perp-lev">
        <div className="perp-lev-head"><span>Leverage</span><b>{lev}x</b></div>
        <input type="range" min={1} max={asset.maxLeverage} step={1} value={lev} aria-label="Leverage"
          onChange={(e) => setLeverage(Number(e.target.value))}
          style={{ ['--fill' as string]: `${((lev - 1) / Math.max(1, asset.maxLeverage - 1)) * 100}%` }} />
        <div className="perp-lev-marks">
          {[1, ...[0.25, 0.5, 0.75].map((f) => Math.max(2, Math.round(asset.maxLeverage * f))), asset.maxLeverage]
            .filter((v, i, a) => a.indexOf(v) === i)
            .map((v) => <button key={v} onClick={() => setLeverage(v)}>{v}x</button>)}
        </div>
      </div>
      <button className="perp-tpsl-toggle" onClick={() => setShowTpsl(!showTpsl)} aria-expanded={showTpsl}>
        <Icon name={showTpsl ? 'chevronDown' : 'chevronRight'} size={14} /> Take profit / Stop loss
      </button>
      {showTpsl && (
        <div className="perp-tpsl">
          <label><span>Take profit</span><input inputMode="decimal" value={tp} placeholder={fmtPrice(asset.price * (side === 'long' ? 1.1 : 0.9)).slice(1)} onChange={(e) => setTp(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
          <label><span>Stop loss</span><input inputMode="decimal" value={sl} placeholder={fmtPrice(asset.price * (side === 'long' ? 0.95 : 1.05)).slice(1)} onChange={(e) => setSl(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
        </div>
      )}
      <div className="perp-readout">
        <div><span>Entry price</span><b>{fmtPrice(asset.price)}</b></div>
        <div><span>Liquidation price</span><b className="no-color">{notional > 0 ? fmtPrice(liq) : '—'}</b></div>
        <div><span>Margin required</span><b>{usd(margin)}</b></div>
        <div><span>Fees ({(asset.feeRate * 100).toFixed(3)}%)</span><b>{usd(fee)}</b></div>
        <div><span>Funding (1h)</span><b className={asset.fundingRate > 0 === (side === 'long') ? 'no-color' : 'yes-accent'}>{fmtPct(asset.fundingRate, 4)}</b></div>
      </div>
      {!user ? (
        <button className="ledge-btn" onClick={() => openAuth('signup')}>Sign up to trade</button>
      ) : !leagueId ? (
        <Link to="/league?new=1" className="ledge-btn">Create or join a league to trade</Link>
      ) : (
        <button ref={btn} className={`ledge-btn perp-submit ${side} ${busy ? 'loading' : ''}`} disabled={busy || notional <= 0 || tooMuch || asset.closeOnly} onClick={submit}>
          {asset.closeOnly ? 'Close-only' : tooMuch ? 'Not enough cash' : busy ? 'Opening…' : `${side === 'long' ? 'Long' : 'Short'} ${asset.symbol}`}
        </button>
      )}
      <p className="tp-note">Market order at the live mark price from Polymarket Perps. Isolated margin: you can lose at most your margin. Fantasy dollars only.</p>
    </div>
  )
}

/* ---------------- positions ---------------- */

const REASON: Record<string, string> = { manual: 'Closed', tp: 'Take profit', sl: 'Stop loss', liquidation: 'Liquidated' }

export function PerpPositions({ positions, onChange, showAsset = true }: { positions: PerpPosition[]; onChange?: () => void; showAsset?: boolean }) {
  const { toast, refreshPortfolio } = useApp()
  const [closing, setClosing] = useState<string | null>(null)
  const close = async (p: PerpPosition) => {
    setClosing(p.id)
    try {
      const res = await api<{ position: PerpPosition }>(`/api/leagues/${p.leagueId}/perps/${p.id}/close`, { method: 'POST' })
      toast(`Closed ${p.symbol} ${p.side}: ${signedUsd(res.position.pnl)}`)
      void refreshPortfolio()
      onChange?.()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setClosing(null)
    }
  }
  return (
    <div className="perp-pos-list">
      {positions.map((p) => {
        const open = p.status === 'open'
        return (
          <div key={p.id} className={`perp-pos ${open ? '' : 'closed'}`}>
            <div className="perp-pos-main">
              {showAsset && (
                <Link to={`/perps/${p.symbol}`} className="perp-pos-asset">
                  <AssetIcon asset={p} size={36} />
                  <span><b>{p.symbol}</b><small className="muted">{p.name}</small></span>
                </Link>
              )}
              <span className={`perp-badge ${p.side}`}>{p.side === 'long' ? 'Long' : 'Short'} {p.leverage}x</span>
              {!open && <span className={`perp-badge reason ${p.closeReason ?? ''}`}>{REASON[p.closeReason ?? 'manual']}</span>}
              <span className="grow" />
              <span className="perp-pos-pnl">
                <b className={changeClass(p.pnl)}>{signedUsd(p.pnl)}</b>
                <small className={changeClass(p.pnl)}>{fmtPct(p.pnlPct)}</small>
              </span>
              {open && (
                <button className="btn btn-outline btn-sm" disabled={closing === p.id} onClick={() => close(p)}>{closing === p.id ? '…' : 'Close'}</button>
              )}
            </div>
            <div className="perp-pos-grid">
              <div><span>Size</span><b>{usd(p.notional)}</b></div>
              <div><span>Margin</span><b>{usd(p.margin)}</b></div>
              <div><span>Entry</span><b>{fmtPrice(p.entryPrice)}</b></div>
              <div><span>{open ? 'Mark' : 'Exit'}</span><b>{fmtPrice(open ? p.markPrice : p.exitPrice)}</b></div>
              {open
                ? <div><span>Liq. price</span><b className="no-color">{fmtPrice(p.liquidationPrice)}</b></div>
                : <div><span>Fees</span><b>{usd(p.fees)}</b></div>}
              <div><span>Funding</span><b>{Math.abs(p.funding) < 0.005 ? '$0.00' : signedUsd(-p.funding)}</b></div>
              {open && (p.takeProfit || p.stopLoss) && (
                <div><span>TP / SL</span><b>{p.takeProfit ? fmtPrice(p.takeProfit) : '—'} / {p.stopLoss ? fmtPrice(p.stopLoss) : '—'}</b></div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
