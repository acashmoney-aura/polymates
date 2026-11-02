// Small quant toolkit for prediction-market prices (probabilities in 0..1).

export type Pt = { t: number; p: number }

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export function std(xs: number[]) {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}

export const clampP = (p: number) => Math.min(0.999, Math.max(0.001, p))
export const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)))

/** Resample irregular series onto a shared regular grid (forward fill). */
export function align(series: Pt[][], buckets = 300) {
  const ts = series.flat().map((x) => x.t)
  if (!ts.length) return { t: [] as number[], v: series.map(() => [] as (number | null)[]) }
  const t0 = Math.max(...series.filter((s) => s.length).map((s) => s[0].t))
  const t1 = Math.max(...ts)
  const n = Math.max(2, Math.min(buckets, series.reduce((m, s) => Math.max(m, s.length), 0)))
  const step = (t1 - t0) / (n - 1) || 1
  const grid = Array.from({ length: n }, (_, i) => t0 + i * step)
  const v = series.map((s) => {
    const out: (number | null)[] = []
    let j = 0
    let last: number | null = null
    for (const t of grid) {
      while (j < s.length && s[j].t <= t) last = s[j++].p
      out.push(last)
    }
    return out
  })
  return { t: grid, v }
}

/** First differences in probability points (better behaved than % returns near 0/1). */
export function diffs(xs: (number | null)[]) {
  const out: number[] = []
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1], b = xs[i]
    out.push(a === null || b === null ? 0 : b - a)
  }
  return out
}

export function corr(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length)
  if (n < 3) return NaN
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n))
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : NaN
}

/** OLS of y on x: slope (beta), intercept, r² */
export function regress(x: number[], y: number[]) {
  const n = Math.min(x.length, y.length)
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n))
  let sxy = 0, sxx = 0
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2 }
  const beta = sxx > 0 ? sxy / sxx : 0
  const r = corr(x, y)
  return { beta, alpha: my - beta * mx, r2: Number.isFinite(r) ? r * r : 0 }
}

export function rollingCorr(a: number[], b: number[], window: number) {
  const out: (number | null)[] = []
  for (let i = 0; i < a.length; i++) {
    if (i + 1 < window) { out.push(null); continue }
    const c = corr(a.slice(i + 1 - window, i + 1), b.slice(i + 1 - window, i + 1))
    out.push(Number.isFinite(c) ? c : null)
  }
  return out
}

export function autocorr(xs: number[], lag = 1) {
  return corr(xs.slice(0, -lag), xs.slice(lag))
}

export function maxDrawdown(xs: number[]) {
  let peak = -Infinity, dd = 0
  for (const x of xs) { peak = Math.max(peak, x); dd = Math.min(dd, x - peak) }
  return dd
}

/** Rescaled-range Hurst exponent estimate. ~0.5 random walk, <0.5 mean-reverting, >0.5 trending. */
export function hurst(xs: number[]) {
  if (xs.length < 32) return NaN
  const pts: [number, number][] = []
  for (let size = 8; size <= xs.length / 2; size = Math.floor(size * 1.6)) {
    const rs: number[] = []
    for (let s = 0; s + size <= xs.length; s += size) {
      const chunk = xs.slice(s, s + size)
      const m = mean(chunk)
      let cum = 0, mn = 0, mx = 0
      for (const x of chunk) { cum += x - m; mn = Math.min(mn, cum); mx = Math.max(mx, cum) }
      const sd = std(chunk)
      if (sd > 0) rs.push((mx - mn) / sd)
    }
    if (rs.length) pts.push([Math.log(size), Math.log(mean(rs))])
  }
  if (pts.length < 3) return NaN
  return regress(pts.map((p) => p[0]), pts.map((p) => p[1])).beta
}

export function histogram(xs: number[], bins = 21) {
  if (!xs.length) return []
  const lim = Math.max(...xs.map(Math.abs)) || 1
  const out = Array.from({ length: bins }, (_, i) => ({ x: -lim + ((i + 0.5) * 2 * lim) / bins, n: 0 }))
  for (const x of xs) out[Math.min(bins - 1, Math.floor(((x + lim) / (2 * lim)) * bins))].n++
  return out
}

/** Kelly fraction for buying a binary contract at `price` when you believe `prob`. */
export const kelly = (prob: number, price: number) => (price >= 1 || price <= 0 ? 0 : (prob - price) / (1 - price))

export const decimalOdds = (p: number) => 1 / clampP(p)
export function americanOdds(p: number) {
  const q = clampP(p)
  return q >= 0.5 ? `-${Math.round((q / (1 - q)) * 100)}` : `+${Math.round(((1 - q) / q) * 100)}`
}

/** Annualized return of buying at `price` if it pays $1 in `days`. */
export const impliedApr = (price: number, days: number) =>
  days > 0 && price > 0 && price < 1 ? (1 / price) ** (365 / days) - 1 : NaN

export const fmtPct = (x: number, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : '—')
export const fmtNum = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—')
export const fmtPp = (x: number, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}pp` : '—')
