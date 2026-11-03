import { useMemo, useState } from 'react'
import { cents, compactUsd, pct, type GameInfo, type GameTeam, type Market, type Outcome, type PMEvent } from '../api'
import { Icon } from '../icons'
import { PriceChart, SERIES_COLORS, type Series } from './Chart'
import { OrderBook } from './OrderBook'
import { Img } from './ui'

/* Polymarket-style game view: scoreboard, two-team chart, and moneyline / spread / total
   lines grouped into tabs, with a carousel to step through alternate lines. */

export const isGame = (e: PMEvent): e is PMEvent & { game: GameInfo } =>
  !!e.game && e.game.teams.length === 2 && e.markets.some((m) => m.sportsMarketType)

export const gameMoneyline = (e: PMEvent) => e.markets.find((m) => m.sportsMarketType === 'moneyline') ?? null

const isEsports = (e: PMEvent) => e.tags.some((t) => t.slug === 'esports')
const norm = (s: string) => s.trim().toLowerCase()
const teamIndex = (game: GameInfo, name: string) => game.teams.findIndex((t) => norm(t.name) === norm(name))
const fmtLine = (l: number) => (l > 0 ? `+${l}` : `${l}`)

/** Ask for one outcome, or null when there's nothing to buy (Polymarket shows "--"). */
export function askFor(m: Market, o: Outcome) {
  const a = o === 'yes' ? m.bestAsk : m.bestBid !== null ? 1 - m.bestBid : null
  return a === null || a >= 0.995 || a <= 0 ? null : a
}

export interface Side { outcome: Outcome; label: string; tag: string | null; team: GameTeam | null; price: number | null }

/** The two buttons for a market, in scoreboard team order, labelled like Polymarket ("FAL -1.5", "O 2.5"). */
export function sidesOf(game: GameInfo, m: Market): Side[] {
  const t0 = teamIndex(game, m.outcomes[0])
  const t1 = teamIndex(game, m.outcomes[1])
  const teams = t0 >= 0 && t1 >= 0 && t0 !== t1
  const spread = teams && m.line != null && /spread|handicap/.test(m.sportsMarketType ?? '')
  const sides = (['yes', 'no'] as const).map((o, i): Side => {
    const name = m.outcomes[i]
    const ti = i === 0 ? t0 : t1
    let label = name.toUpperCase()
    if (teams) label = game.teams[ti].abbr
    else if (/^over\b/i.test(name)) label = `O ${m.line ?? name.replace(/^over\s*/i, '')}`
    else if (/^under\b/i.test(name)) label = `U ${m.line ?? name.replace(/^under\s*/i, '')}`
    const tag = spread ? fmtLine(o === 'yes' ? m.line! : -m.line!) : null
    return { outcome: o, label, tag, team: teams ? game.teams[ti] : null, price: askFor(m, o) }
  })
  return teams && t0 > t1 ? sides.reverse() : sides
}

/** "Chennai Open: A vs B Set 2 Winner" → "Set 2 Winner"; "Map 1 Total Rounds: Over/Under 21.5" → "Map 1 Total Rounds". */
function cleanTitle(game: GameInfo, m: Market) {
  const type = m.sportsMarketType ?? ''
  if (type === 'moneyline') return 'Moneyline'
  let s = (type === 'totals' ? m.question : m.title) || m.question
  const names = game.teams.map((t) => t.name).filter(Boolean)
  const colon = s.indexOf(': ')
  if (colon > 0 && names.some((n) => s.slice(colon).includes(n))) {
    // either "Title: A (-1.5) vs B (+1.5)" or "League: A vs B Title"
    let cut = -1
    for (const n of names) {
      const at = s.lastIndexOf(n)
      if (at > colon) cut = Math.max(cut, at + n.length)
    }
    const after = cut > 0 ? s.slice(cut).trim() : ''
    s = after && !/^\(/.test(after) ? after : s.slice(0, colon)
  }
  let ou = false
  s = s.replace(/[:\s]*(O\/U|Over\/Under|\+\/-)\s*[-+]?\d+(\.\d+)?\s*(Games)?$/i, (x) => { ou = /O\/U|Over/i.test(x); return '' })
  s = s.replace(/[:\s]+$/, '').trim()
  if (ou && !/total/i.test(s)) s = `${s} Total`.trim()
  if (s) return s
  if (/spread|handicap/.test(type)) return 'Spread'
  if (/total/.test(type)) return 'Total'
  return m.title || m.question
}

const PERIOD = /^(Map|Set|Game|Quarter|Half|Period|Inning)\s+(\d+)\b/i
const PLURAL: Record<string, string> = { Map: 'Maps', Set: 'Sets', Game: 'Games', Quarter: 'Quarters', Half: 'Halves', Period: 'Periods', Inning: 'Innings' }

function periodOf(e: PMEvent, m: Market, title: string): { kind: string; n: number } | null {
  const hit = title.match(PERIOD)
  if (hit) return { kind: hit[1][0].toUpperCase() + hit[1].slice(1).toLowerCase(), n: Number(hit[2]) }
  const t = (m.sportsMarketType ?? '').match(/_(game|set|map)_(\d+)$/)
  if (t) return { kind: isEsports(e) ? 'Map' : t[1][0].toUpperCase() + t[1].slice(1), n: Number(t[2]) }
  return null
}

const rank = (type: string) =>
  type === 'moneyline' ? 0 : type === 'child_moneyline' ? 1 : /spread|handicap/.test(type) ? 2 : /total|over_under/.test(type) ? 3 : /winner/.test(type) ? 1.5 : 10

interface Line { m: Market; title: string; label: string }
interface Group { key: string; title: string; lines: Line[]; rank: number }
interface Section { name: string | null; groups: Group[] }
interface Tab { name: string; sections: Section[] }

export function buildTabs(e: PMEvent & { game: GameInfo }): Tab[] {
  const groups = new Map<string, Group & { tab: string; section: string | null; n: number }>()
  for (const m of e.markets) {
    if (!m.sportsMarketType) continue
    const type = m.sportsMarketType
    const title = cleanTitle(e.game, m)
    const per = periodOf(e, m, title)
    const child = type === 'child_moneyline'
    const tab = per && !child ? PLURAL[per.kind] ?? 'More' : 'Main Lines'
    const section = per && !child ? `${per.kind} ${per.n}` : null
    const key = child ? type : `${type}|${section ?? ''}`
    const label = child && per ? String(per.n) : m.line != null ? String(Math.abs(m.line)) : title
    const g = groups.get(key) ?? { key, title: child && per ? `${per.kind} Winner` : title, lines: [], rank: rank(type), tab, section, n: section ? per!.n : 0 }
    g.lines.push({ m, title, label })
    groups.set(key, g)
  }
  const tabs = new Map<string, Map<string | null, Group[]>>()
  const all = [...groups.values()].sort((a, b) => a.n - b.n || a.rank - b.rank)
  for (const g of all) {
    g.lines.sort((a, b) => (Number(a.label) || 0) - (Number(b.label) || 0))
    // closed lines only clutter the carousel
    const open = g.lines.filter((l) => l.m.active)
    if (open.length) g.lines = open
    const t = tabs.get(g.tab) ?? new Map<string | null, Group[]>()
    t.set(g.section, [...(t.get(g.section) ?? []), g])
    tabs.set(g.tab, t)
  }
  const order = (n: string) => (n === 'Main Lines' ? 0 : n === 'More' ? 2 : 1)
  return [...tabs.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([name, secs]) => ({ name, sections: [...secs.entries()].map(([s, gs]) => ({ name: s, groups: gs })) }))
}

/** The main line: the one priced closest to a coin flip, as Polymarket centres its carousel. */
const mainLine = (lines: Line[]) =>
  lines.reduce((best, l, i) => (Math.abs(l.m.price - 0.5) < Math.abs(lines[best].m.price - 0.5) ? i : best), 0)

function parseScore(game: GameInfo, esports: boolean) {
  const parts = (game.score ?? '').split('|').map((p) => p.match(/^(\d+)-(\d+)$/)).filter(Boolean) as RegExpMatchArray[]
  const per = game.period ?? ''
  const of = per.match(/^(\d+)\/(\d+)$/)
  const cur = of ? `${esports ? 'M' : 'G'}${of[1]}` : per && per !== 'NS' ? per : ''
  const heads = parts.length >= 2 ? [cur || 'Now', esports ? 'Maps' : 'Total'] : parts.length ? [cur || 'Score'] : []
  return { heads, cols: parts.slice(0, 2).map((p) => [Number(p[1]), Number(p[2])]) }
}

export function gameStatus(e: PMEvent & { game: GameInfo }) {
  const g = e.game
  if (g.ended || e.closed) return { live: false, text: 'Final' }
  const of = (g.period ?? '').match(/^(\d+)\/(\d+)$/)
  if (g.live) return { live: true, text: of ? `${isEsports(e) ? 'Map' : 'Game'} ${of[1]} of ${of[2]}` : g.period || 'Live' }
  if (!g.startTime) return { live: false, text: '' }
  const d = new Date(g.startTime)
  const today = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return { live: false, text: today ? `Today ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}` }
}

/** Probability per scoreboard team from the moneyline. */
export function teamOdds(game: GameInfo, ml: Market | null): (number | null)[] {
  if (!ml) return [null, null]
  const i0 = teamIndex(game, ml.outcomes[0])
  return i0 === 1 ? [1 - ml.price, ml.price] : [ml.price, 1 - ml.price]
}

const teamColor = (t: GameTeam | null, i: number) => (t?.color && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : SERIES_COLORS[i])

export function GameHeader({ event, ml }: { event: PMEvent & { game: GameInfo }; ml: Market | null }) {
  const g = event.game
  const { heads, cols } = parseScore(g, isEsports(event))
  const st = gameStatus(event)
  const odds = teamOdds(g, ml)
  return (
    <div className="gh">
      <div className="gh-status">
        {st.live && <span className="gh-live"><i />{st.text}</span>}
        {!st.live && st.text && <span>{st.text}</span>}
        <span className="muted">{compactUsd(event.volume)} Vol.</span>
      </div>
      <div className="gh-board" style={{ '--cols': heads.length } as React.CSSProperties}>
        <span />
        {heads.map((h, i) => <span key={h} className={`gh-h ${i === 0 && st.live ? 'now' : ''}`}>{h}</span>)}
        <span className="gh-h">Odds</span>
        {g.teams.map((t, ti) => (
          <div className="gh-row" key={t.name}>
            <span className="gh-team"><Img src={t.logo} size={28} radius={6} /><b className="ellipsis">{t.name}</b></span>
            {cols.map((c, ci) => <span key={ci} className={`gh-score ${ci === 0 && st.live ? 'now' : ''}`}>{c[ti]}</span>)}
            <span className="gh-odds">{odds[ti] === null ? '—' : pct(odds[ti]!)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function gameSeries(event: PMEvent & { game: GameInfo }, ml: Market, points: { t: number; p: number }[]): Series[] {
  const flip = teamIndex(event.game, ml.outcomes[0]) === 1
  return event.game.teams.map((t, i) => {
    const yesSide = (i === 0) !== flip
    return { id: `${ml.id}:${i}`, name: t.name, color: teamColor(t, i), points: yesSide ? points : points.map((x) => ({ t: x.t, p: 1 - x.p })) }
  })
}

export function GameChart({ event, ml, points }: { event: PMEvent & { game: GameInfo }; ml: Market; points: { t: number; p: number }[] }) {
  return <PriceChart height={240} endLabels series={gameSeries(event, ml, points)} />
}

function SideButton({ side, m, selected, onClick, colored }: { side: Side; m: Market; selected: boolean; onClick: () => void; colored: boolean }) {
  const off = !m.active || !m.enabled
  const color = colored && side.team ? teamColor(side.team, 0) : null
  return (
    <button className={`gl-btn ${color ? 'team' : ''} ${selected ? 'selected' : ''}`} disabled={off}
      style={color ? ({ '--team': color } as React.CSSProperties) : undefined}
      onClick={(e) => { e.stopPropagation(); onClick() }}>
      <span className="gl-label"><span className="ellipsis">{side.label}</span>{side.tag && <i>{side.tag}</i>}</span>
      <b>{m.resolved ? (m.payout?.[side.outcome === 'yes' ? 0 : 1] === 1 ? '✓' : '✗') : side.price === null ? '--' : cents(side.price)}</b>
    </button>
  )
}

function Carousel({ lines, at, onAt }: { lines: Line[]; at: number; onAt: (i: number) => void }) {
  return (
    <div className="gl-carousel">
      <button aria-label="Previous line" disabled={at === 0} onClick={() => onAt(at - 1)}><Icon name="chevronLeft" size={16} /></button>
      <div className="gl-lines">
        {lines.map((l, i) => (
          <button key={l.m.id} className={i === at ? 'active' : ''} onClick={() => onAt(i)}>{l.label}</button>
        ))}
      </div>
      <button aria-label="Next line" disabled={at === lines.length - 1} onClick={() => onAt(at + 1)}><Icon name="chevronRight" size={16} /></button>
    </div>
  )
}

function GroupCard({ event, group, selected, outcome, onPick, onPrice }: {
  event: PMEvent & { game: GameInfo }; group: Group; selected: Market; outcome: Outcome
  onPick: (m: Market, o: Outcome) => void; onPrice: (p: number) => void
}) {
  const holds = group.lines.findIndex((l) => l.m.id === selected.id)
  const [pickAt, setAt] = useState(() => (holds >= 0 ? holds : mainLine(group.lines)))
  const [open, setOpen] = useState(false)
  const at = Math.min(pickAt, group.lines.length - 1)
  const line = group.lines[at]
  const m = line.m
  const colored = group.rank <= 1.5
  const sides = sidesOf(event.game, m)
  const title = group.key === 'child_moneyline' ? line.title : group.title
  return (
    <div className={`gl-card ${holds >= 0 ? 'has-sel' : ''}`}>
      <div className="gl-row" onClick={() => setOpen(!open)}>
        <div className="gl-name">
          <b>{title}</b>
          <small className="muted">{compactUsd(m.volume)} Vol.{m.leagueVolume > 0 && ` · ${compactUsd(m.leagueVolume)} league`}{!m.enabled && ' · off in league'}</small>
        </div>
        <div className="gl-btns">
          {sides.map((s) => (
            <SideButton key={s.outcome} side={s} m={m} colored={colored} selected={m.id === selected.id && outcome === s.outcome}
              onClick={() => onPick(m, s.outcome)} />
          ))}
        </div>
      </div>
      {group.lines.length > 1 && <Carousel lines={group.lines} at={at} onAt={(i) => { setAt(i); if (holds >= 0) onPick(group.lines[i].m, outcome) }} />}
      {open && m.active && (
        <div className="gl-book">
          <OrderBook market={m} outcome={m.id === selected.id ? outcome : 'yes'} onOutcome={(o) => onPick(m, o)} onPrice={onPrice} />
        </div>
      )}
    </div>
  )
}

export function GameLines({ event, selected, outcome, onPick, onPrice }: {
  event: PMEvent & { game: GameInfo }; selected: Market; outcome: Outcome
  onPick: (m: Market, o: Outcome) => void; onPrice: (p: number) => void
}) {
  const tabs = useMemo(() => buildTabs(event), [event])
  const [tab, setTab] = useState(0)
  const cur = tabs[Math.min(tab, tabs.length - 1)]
  if (!cur) return null
  return (
    <section className="game-lines">
      {tabs.length > 1 && (
        <div className="text-tabs gl-tabs">
          {tabs.map((t, i) => <button key={t.name} className={t === cur ? 'active' : ''} onClick={() => setTab(i)}>{t.name}</button>)}
        </div>
      )}
      {cur.sections.map((s) => (
        <div key={s.name ?? 'main'} className="gl-section">
          {s.name && <h3>{s.name}</h3>}
          {s.groups.map((g) => (
            <GroupCard key={g.key} event={event} group={g} selected={selected} outcome={outcome} onPick={onPick} onPrice={onPrice} />
          ))}
        </div>
      ))}
    </section>
  )
}

/** List card for a game: team rows with moneyline, spread and total columns. */
export function GameCardBody({ event, onQuick }: { event: PMEvent & { game: GameInfo }; onQuick: (m: Market, o: Outcome) => (e: React.MouseEvent) => void }) {
  const tabs = buildTabs(event)
  const main = tabs.find((t) => t.name === 'Main Lines')?.sections[0]?.groups ?? []
  const pickMain = (re: RegExp) => {
    const g = main.find((x) => re.test(x.lines[0].m.sportsMarketType ?? '') && x.key !== 'child_moneyline')
    return g ? g.lines[mainLine(g.lines)].m : null
  }
  const cols = [
    { name: 'Moneyline', m: pickMain(/^moneyline$/) },
    { name: 'Spread', m: pickMain(/spread|handicap/) },
    { name: 'Total', m: pickMain(/total/) },
  ].filter((c) => c.m && c.m.active && c.m.enabled) as { name: string; m: Market }[]
  const { cols: score } = parseScore(event.game, isEsports(event))
  const st = gameStatus(event)
  return (
    <div className="gc">
      <div className="gc-head">
        {st.live ? <span className="gh-live"><i />{st.text}</span> : <span className="muted">{st.text}</span>}
        <span className="grow" />
        {cols.map((c) => <span key={c.name} className="gc-col">{c.name}</span>)}
      </div>
      {event.game.teams.map((t, ti) => (
        <div className="gc-row" key={t.name}>
          <Img src={t.logo} size={22} radius={5} />
          <b className="ellipsis grow">{t.name}</b>
          {score[0] && <span className="gc-score">{score[score.length - 1][ti]}</span>}
          {cols.map((c, ci) => {
            const s = sidesOf(event.game, c.m)[ti]
            return (
              <button key={c.name} className={`gl-btn sm ${ci === 0 ? 'team' : ''}`} onClick={onQuick(c.m, s.outcome)}
                style={ci === 0 ? ({ '--team': teamColor(t, ti) } as React.CSSProperties) : undefined}>
                {ci > 0 && <span className="ellipsis">{s.tag ?? s.label}</span>}
                <b>{s.price === null ? '--' : cents(s.price)}</b>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
