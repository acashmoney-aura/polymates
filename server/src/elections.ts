import { catalog, displayPrice, ingestEvent } from './polymarket.ts'
import type { PMEvent, PMMarket } from './types.ts'
import { fetchJson } from './util.ts'

/*
 * Elections hub: groups the mirrored Polymarket catalog into US midterm races (by state and office),
 * chamber-control odds and per-country global elections. Everything here is derived from real Gamma
 * events; the only hand-entered data is the Senate's current composition and which party holds each
 * seat up in 2026 (public record), used to fill seats that have no market yet.
 */

const GAMMA = 'https://gamma-api.polymarket.com'
/* eslint-disable @typescript-eslint/no-explicit-any */

/* ---------------- extra sync: the main catalog only pulls 100 events per tag ---------------- */

/** Gamma's `seriesColor` (blue/red) marks a candidate's party even when the name has no "(D)". */
const seriesColor = new Map<string, string>()
let syncedAt = 0
let syncing: Promise<void> | null = null

const SYNC_TAGS: [string, number][] = [['midterms', 12], ['global-elections', 4], ['elections', 6]]

function syncElections() {
  if (syncing) return syncing
  syncing = (async () => {
    const base = `${GAMMA}/events?active=true&closed=false&archived=false&order=volume24hr&ascending=false&limit=100`
    await Promise.all(SYNC_TAGS.map(async ([tag, pages]) => {
      for (let page = 0; page < pages; page++) {
        try {
          const rows = await fetchJson<any[]>(`${base}&tag_slug=${tag}&offset=${page * 100}`, 20_000)
          for (const e of rows) {
            const id = String(e.id)
            const known = catalog.events.get(id)
            ingestEvent(e, known ? known.rank : 10_000 + 1e9 - Number(e.volume24hr ?? 0))
            for (const m of Array.isArray(e.markets) ? e.markets : []) if (m.seriesColor) seriesColor.set(String(m.id), String(m.seriesColor))
          }
          if (rows.length < 100) break
        } catch (err) {
          console.warn('[elections] page failed', tag, page, (err as Error).message)
          break
        }
      }
    }))
    syncedAt = Date.now()
  })().finally(() => { syncing = null })
  return syncing
}

async function ensureSynced() {
  if (!syncedAt) {
    await Promise.race([syncElections(), new Promise((r) => setTimeout(r, 20_000))])
  } else if (Date.now() - syncedAt > 10 * 60_000) {
    void syncElections()
  }
}

/* ---------------- reference data ---------------- */

const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming',
}
const STATE_BY_NAME = new Map(Object.entries(STATES).map(([abbr, name]) => [name.toLowerCase(), abbr]))

/** Party currently holding each Senate seat on the 2026 ballot (class 2 plus the OH and FL specials). */
const SENATE_2026: Record<string, Party> = {
  CO: 'D', DE: 'D', GA: 'D', IL: 'D', MA: 'D', MI: 'D', MN: 'D', NH: 'D', NJ: 'D', NM: 'D', OR: 'D', RI: 'D', VA: 'D',
  AL: 'R', AK: 'R', AR: 'R', FL: 'R', ID: 'R', IA: 'R', KS: 'R', KY: 'R', LA: 'R', ME: 'R', MS: 'R', MT: 'R', NE: 'R',
  NC: 'R', OH: 'R', OK: 'R', SC: 'R', SD: 'R', TN: 'R', TX: 'R', WV: 'R', WY: 'R',
}
/** Senate today: 45 D + 2 independents who caucus with them, 53 R. */
const SENATE_NOW = { D: 47, R: 53 }

const US_WORDS = new RegExp(`\\b(US|U\\.S\\.|America|Senate|House|Governor|Congress|Trump|midterms?|President|${Object.values(STATES).join('|')})\\b`, 'i')

/** Country groupings for the global page. `map` is the Natural Earth name used by the world map. */
const COUNTRIES: { name: string; map: string; tags: string[]; words: RegExp }[] = [
  { name: 'United States', map: 'United States of America', tags: ['united-states', 'midterms', 'us-presidential-election'], words: US_WORDS },
  { name: 'Argentina', map: 'Argentina', tags: ['argentina', 'argentina-election'], words: /argentin/i },
  { name: 'Australia', map: 'Australia', tags: ['australia', 'australia-election'], words: /australia|new south wales|victoria(n)? state/i },
  { name: 'Brazil', map: 'Brazil', tags: ['brazil', 'brazil-election'], words: /brazil/i },
  { name: 'Bulgaria', map: 'Bulgaria', tags: ['bulgaria', 'bulgaria-election'], words: /bulgaria/i },
  { name: 'Bosnia and Herzegovina', map: 'Bosnia and Herz.', tags: ['bosnia'], words: /bosnia/i },
  { name: 'Cabo Verde', map: 'Cabo Verde', tags: ['cape-verde', 'cabo-verde'], words: /cape verde|cabo verde/i },
  { name: 'Canada', map: 'Canada', tags: ['canada', 'canada-election', 'canadian-election'], words: /canad|alberta|quebec|ontario/i },
  { name: 'Chile', map: 'Chile', tags: ['chile'], words: /\bchile/i },
  { name: 'Colombia', map: 'Colombia', tags: ['colombia', 'colombia-election'], words: /colombia/i },
  { name: 'Czechia', map: 'Czechia', tags: ['czechia', 'czech-republic'], words: /czech/i },
  { name: 'Denmark', map: 'Denmark', tags: ['denmark'], words: /denmark|danish/i },
  { name: 'Ecuador', map: 'Ecuador', tags: ['ecuador'], words: /ecuador/i },
  { name: 'El Salvador', map: 'El Salvador', tags: ['el-salvador'], words: /el salvador/i },
  { name: 'France', map: 'France', tags: ['france', 'french-election', 'french-elections'], words: /france|french/i },
  { name: 'Gambia', map: 'Gambia', tags: ['gambia'], words: /gambia/i },
  { name: 'Germany', map: 'Germany', tags: ['germany', 'german-elections'], words: /german|bundestag|ministerpr/i },
  { name: 'Greece', map: 'Greece', tags: ['greece'], words: /greece|greek/i },
  { name: 'Greenland', map: 'Greenland', tags: ['greenland'], words: /greenland/i },
  { name: 'Guinea-Bissau', map: 'Guinea-Bissau', tags: ['guinea-bissau'], words: /guinea-bissau/i },
  { name: 'Haiti', map: 'Haiti', tags: ['haiti'], words: /haiti/i },
  { name: 'Hungary', map: 'Hungary', tags: ['hungary', 'hungary-election'], words: /hungar/i },
  { name: 'India', map: 'India', tags: ['india', 'india-election'], words: /india|bihar|kerala|tamil|bengal/i },
  { name: 'Israel', map: 'Israel', tags: ['israel', 'israel-election'], words: /israel|knesset/i },
  { name: 'Italy', map: 'Italy', tags: ['italy'], words: /ital/i },
  { name: 'Japan', map: 'Japan', tags: ['japan', 'japan-election'], words: /japan/i },
  { name: 'Latvia', map: 'Latvia', tags: ['latvia'], words: /latvia/i },
  { name: 'Mexico', map: 'Mexico', tags: ['mexico', 'mexico-election'], words: /mexic|nuevo le|chihuahua|quer[eé]taro/i },
  { name: 'Netherlands', map: 'Netherlands', tags: ['netherlands', 'dutch-election'], words: /netherlands|dutch/i },
  { name: 'New Zealand', map: 'New Zealand', tags: ['new-zealand', 'new-zealand-election', 'nz'], words: /new zealand/i },
  { name: 'Nigeria', map: 'Nigeria', tags: ['nigeria', 'nigeria-election'], words: /nigeria/i },
  { name: 'Peru', map: 'Peru', tags: ['peru', 'peru-election'], words: /\bperu/i },
  { name: 'Poland', map: 'Poland', tags: ['poland', 'poland-election'], words: /poland|polish/i },
  { name: 'Portugal', map: 'Portugal', tags: ['portugal'], words: /portug/i },
  { name: 'Serbia', map: 'Serbia', tags: ['serbia', 'serbia-elections'], words: /serbia/i },
  { name: 'Slovenia', map: 'Slovenia', tags: ['slovenia'], words: /sloven|ljubljana/i },
  { name: 'Somaliland', map: 'Somaliland', tags: ['somaliland'], words: /somaliland/i },
  { name: 'South Africa', map: 'South Africa', tags: ['south-africa'], words: /south africa/i },
  { name: 'South Korea', map: 'South Korea', tags: ['south-korea', 'korea'], words: /korea/i },
  { name: 'Spain', map: 'Spain', tags: ['spain', 'spain-elections'], words: /spain|spanish|catalonia/i },
  { name: 'Sweden', map: 'Sweden', tags: ['sweden', 'sweden-elections'], words: /swed/i },
  { name: 'Switzerland', map: 'Switzerland', tags: ['switzerland'], words: /switzerland|swiss/i },
  { name: 'Taiwan', map: 'Taiwan', tags: ['taiwan', 'taiwan-elections'], words: /taiwan|taipei|taichung|kaohsiung/i },
  { name: 'United Kingdom', map: 'United Kingdom', tags: ['uk', 'united-kingdom', 'uk-election'], words: /\bUK\b|britain|british|scotland|scottish|wales|welsh/i },
  { name: 'Venezuela', map: 'Venezuela', tags: ['venezuela'], words: /venezuela/i },
]

/** Polymarket's midterm hub sidebar, keyed by their tag slugs. */
const MIDTERM_CATEGORIES = [
  { slug: 'midterms', label: 'All' },
  { slug: 'midterms-control', label: 'Control & Seats' },
  { slug: 'midterm-tossups', label: 'Tossups' },
  { slug: 'senate-midterms', label: 'Senate Elections' },
  { slug: 'house-elections', label: 'House Elections' },
  { slug: 'governor-midterms', label: 'Governor Elections' },
  { slug: 'midtermmov', label: 'Midterm MOV' },
  { slug: 'turnout', label: 'Turnout' },
  { slug: 'ballot-measures', label: 'Ballot Measures' },
  { slug: 'down-ballot', label: 'Down Ballot' },
  { slug: 'mayoral-races', label: 'Mayoral Races' },
  { slug: 'midterm-combos', label: 'Midterm Combos' },
  { slug: 'midterm-derivatives', label: 'Midterm Derivatives' },
]

/* ---------------- parsing ---------------- */

type Party = 'D' | 'R' | 'O'
type Office = 'senate' | 'house' | 'governor'
type Rating = 'safe-d' | 'likely-d' | 'lean-d' | 'tossup' | 'lean-r' | 'likely-r' | 'safe-r'

const isLive = (e: PMEvent) => !e.closed && e.marketIds.some((id) => catalog.markets.get(id)?.active)
const marketsOf = (e: PMEvent) => e.marketIds.map((id) => catalog.markets.get(id)).filter((m): m is PMMarket => Boolean(m?.active))
const hasTag = (e: PMEvent, slug: string) => e.tags.some((t) => t.slug === slug)
const r3 = (n: number) => Math.round(n * 1000) / 1000

function partyOf(m: PMMarket): Party {
  const c = seriesColor.get(m.id)
  if (c === 'blue') return 'D'
  if (c === 'red') return 'R'
  const t = `${m.groupTitle} ${m.question}`
  if (/\(D\)|\bDemocrat/i.test(t)) return 'D'
  if (/\(R\)|\bRepublican/i.test(t)) return 'R'
  return 'O'
}

const cleanName = (s: string) => s.replace(/\s*\((D|R|I)\)\s*/g, '').replace(/^Sen\.\s+/, '').trim()

function rate(dem: number, rep: number): Rating {
  const d = dem >= rep
  const p = Math.max(dem, rep)
  if (p >= 0.85) return d ? 'safe-d' : 'safe-r'
  if (p >= 0.65) return d ? 'likely-d' : 'likely-r'
  if (p >= 0.55) return d ? 'lean-d' : 'lean-r'
  return 'tossup'
}

function parseRace(e: PMEvent): { office: Office; state: string; district: string | null } | null {
  const title = e.title.trim()
  if (/primary|margin|turnout|nominee|runoff|vote share/i.test(title)) return null
  let m = /^([A-Z]{2})-(\d{1,2}|AL) House Election Winner/i.exec(title)
  if (m && STATES[m[1].toUpperCase()]) return { office: 'house', state: m[1].toUpperCase(), district: m[2].toUpperCase() }
  m = /^(.+?) (Senate|Governor) Election Winner/i.exec(title)
  if (m) {
    const state = STATE_BY_NAME.get(m[1].toLowerCase().replace(/^20\d\d\s+/, ''))
    if (state) return { office: m[2].toLowerCase() as Office, state, district: null }
  }
  return null
}

function buildRace(e: PMEvent, where: { office: Office; state: string; district: string | null }) {
  const markets = marketsOf(e)
  const candidates = markets
    .map((m) => ({ marketId: m.id, name: cleanName(m.groupTitle), party: partyOf(m), p: r3(displayPrice(m)) }))
    .filter((c) => c.p >= 0.005)
    .sort((a, b) => b.p - a.p)
  if (!candidates.length) return null
  const dem = r3(candidates.filter((c) => c.party === 'D').reduce((s, c) => s + c.p, 0))
  const rep = r3(candidates.filter((c) => c.party === 'R').reduce((s, c) => s + c.p, 0))
  const leader = candidates[0]
  const label = where.office === 'house'
    ? `${where.state}-${where.district!.padStart(2, '0')}`
    : `${STATES[where.state]} ${where.office === 'senate' ? 'Senate' : 'Governor'}`
  return {
    ...where,
    label,
    stateName: STATES[where.state],
    slug: e.slug,
    title: e.title,
    image: where.office === 'house' ? '' : e.icon || e.image,
    volume: Math.round(e.volume),
    dem,
    rep,
    leader: { name: leader.name, party: leader.party, p: leader.p },
    change24h: markets.find((m) => m.id === leader.marketId)?.change24h ?? null,
    candidates: candidates.slice(0, where.office === 'house' ? 2 : 4),
    rating: leader.party === 'O' && leader.p > Math.max(dem, rep) ? ('tossup' as Rating) : rate(dem, rep),
    incumbent: where.office === 'senate' ? (SENATE_2026[where.state] ?? null) : null,
  }
}
export type Race = NonNullable<ReturnType<typeof buildRace>>

function outcomesOf(e: PMEvent) {
  const ms = marketsOf(e)
  if (ms.length === 1) {
    const m = ms[0]
    const p = displayPrice(m)
    return [{ label: m.outcomes[0], p: r3(p) }, { label: m.outcomes[1], p: r3(1 - p) }]
  }
  const out = ms.map((m) => ({ label: m.groupTitle, p: r3(displayPrice(m)) }))
  return e.negRisk ? out.sort((a, b) => b.p - a.p) : out
}

function card(e: PMEvent, country: string | null) {
  const outcomes = outcomesOf(e)
  return {
    slug: e.slug, title: e.title, image: e.icon || e.image, endDate: e.endDate, volume: Math.round(e.volume),
    country, midterm: hasTag(e, 'midterms'), outcomes: outcomes.slice(0, 2), more: Math.max(0, outcomes.length - 2),
  }
}

function countryOf(e: PMEvent) {
  for (const c of COUNTRIES) if (c.tags.some((t) => hasTag(e, t))) return c
  for (const c of COUNTRIES.slice(1)) if (c.words.test(e.title)) return c
  return COUNTRIES[0].words.test(e.title) ? COUNTRIES[0] : null
}

/** Chamber control from "Which party will win the Senate/House in 2026?" */
function control(re: RegExp) {
  const e = [...catalog.events.values()].filter((x) => isLive(x) && re.test(x.title)).sort((a, b) => b.volume - a.volume)[0]
  if (!e) return null
  const ms = marketsOf(e)
  const dem = ms.find((m) => /democrat/i.test(m.groupTitle))
  const rep = ms.find((m) => /republican/i.test(m.groupTitle))
  if (!dem && !rep) return null
  return {
    slug: e.slug, title: e.title, volume: e.volume,
    dem: dem ? r3(displayPrice(dem)) : null, rep: rep ? r3(displayPrice(rep)) : null,
    change24h: dem?.change24h ?? null,
  }
}

/** Expected Republican House seats from the seat-bracket markets (main + lower-bracket events). */
function houseSeats() {
  const live = [...catalog.events.values()].filter(isLive)
  const main = live.find((e) => /^Republican House seats after the 2026 midterm elections\?$/i.test(e.title.trim()))
  const lower = live.find((e) => /^Republican House seats after the 2026 midterm elections\? \(Lower Brackets\)/i.test(e.title.trim()))
  if (!main) return null
  const buckets: { mid: number; p: number }[] = []
  const add = (label: string, p: number) => {
    let m = /(\d+)\s*[-–]\s*(\d+)/.exec(label)
    if (m) return buckets.push({ mid: (Number(m[1]) + Number(m[2])) / 2, p })
    m = /below\s*(\d+)/i.exec(label) ?? /[<≤]\s*(\d+)/.exec(label)
    if (m) return buckets.push({ mid: Number(m[1]) - 3, p })
    m = /(\d+)\s*\+|[>≥]\s*(\d+)/.exec(label)
    if (m) return buckets.push({ mid: Number(m[1] ?? m[2]) + 3, p })
  }
  const mainMs = marketsOf(main)
  const lowerMs = lower ? marketsOf(lower) : []
  const belowMain = mainMs.find((m) => /below/i.test(m.groupTitle))
  for (const m of mainMs) if (!(lowerMs.length && m === belowMain)) add(m.groupTitle, displayPrice(m))
  if (lowerMs.length && belowMain) {
    // the lower-bracket event splits the main event's "Below N" bucket
    const sub = lowerMs.filter((m) => !/\+/.test(m.groupTitle))
    const tot = sub.reduce((s, m) => s + displayPrice(m), 0) || 1
    for (const m of sub) add(m.groupTitle, (displayPrice(m) / tot) * displayPrice(belowMain))
  }
  const total = buckets.reduce((s, b) => s + b.p, 0)
  if (!total) return null
  const rep = Math.round(buckets.reduce((s, b) => s + b.mid * b.p, 0) / total)
  return { rep, dem: 435 - rep, slug: main.slug }
}

/* ---------------- public shape ---------------- */

const RATINGS: Rating[] = ['safe-d', 'likely-d', 'lean-d', 'tossup', 'lean-r', 'likely-r', 'safe-r']

function tally(races: Race[]) {
  const ratings = Object.fromEntries(RATINGS.map((r) => [r, 0])) as Record<Rating, number>
  for (const r of races) ratings[r.rating]++
  return ratings
}

export async function electionsOverview() {
  await ensureSynced()
  const live = [...catalog.events.values()].filter(isLive)

  // races: one per (office, state, district), highest volume wins
  const byKey = new Map<string, Race>()
  for (const e of live) {
    const where = parseRace(e)
    if (!where) continue
    const race = buildRace(e, where)
    if (!race) continue
    const key = `${where.office}:${where.state}:${where.district ?? ''}`
    const prev = byKey.get(key)
    if (!prev || prev.volume < race.volume) byKey.set(key, race)
  }
  const races = [...byKey.values()].sort((a, b) => b.volume - a.volume)
  const of = (o: Office) => races.filter((r) => r.office === o)

  // Senate seat math: seats not up + each race's favorite (or the incumbent party where no market exists)
  const senateRaces = of('senate')
  const up = Object.entries(SENATE_2026)
  const notUp = { D: SENATE_NOW.D - up.filter(([, p]) => p === 'D').length, R: SENATE_NOW.R - up.filter(([, p]) => p === 'R').length }
  const segments = Object.fromEntries(RATINGS.map((r) => [r, 0])) as Record<Rating, number>
  const unmarketed = { D: 0, R: 0 }
  for (const [state, holder] of up) {
    const race = senateRaces.find((r) => r.state === state)
    if (race) segments[race.rating]++
    else unmarketed[holder as 'D' | 'R']++
  }
  // tossups count for neither side, like Polymarket's "53 DEM … REP 46"
  const projDem = notUp.D + unmarketed.D + segments['safe-d'] + segments['likely-d'] + segments['lean-d']
  const projRep = notUp.R + unmarketed.R + segments['safe-r'] + segments['likely-r'] + segments['lean-r']

  const governors = of('governor')
  const house = of('house')
  const hs = houseSeats()

  // global elections grid + country counts
  const elections = live.filter((e) => hasTag(e, 'elections') || hasTag(e, 'global-elections'))
  const countryCounts = new Map<string, { name: string; map: string; count: number; volume: number }>()
  const headline = (e: PMEvent) => hasTag(e, 'midterms-control') || hasTag(e, 'main-election')
  const cards = elections.map((e) => {
    const c = countryOf(e)
    if (c) {
      const row = countryCounts.get(c.name) ?? { name: c.name, map: c.map, count: 0, volume: 0 }
      row.count++
      row.volume += e.volume
      countryCounts.set(c.name, row)
    }
    return c?.name === 'United States' && !headline(e) ? null : card(e, c?.name ?? null)
  }).filter((c) => c !== null).sort((a, b) => b.volume - a.volume)

  return {
    syncedAt: Math.max(syncedAt, catalog.syncedAt),
    control: {
      senate: control(/which party will win the senate in 2026/i),
      house: control(/which party will win the house in 2026/i),
      balance: (() => {
        const e = live.find((x) => /^balance of power: 2026 midterms$/i.test(x.title.trim()))
        return e ? { slug: e.slug, title: e.title, volume: e.volume, outcomes: outcomesOf(e) } : null
      })(),
    },
    // "Which Senate swing states will Republicans win? (Build Your Map)": one market per combination
    buildMap: (() => {
      const e = live.find((x) => /which senate swing states will republicans win/i.test(x.title))
      if (!e) return null
      const outcomes = marketsOf(e).map((m) => ({ marketId: m.id, label: m.groupTitle.trim(), p: r3(displayPrice(m)) }))
      const states = [...new Set(outcomes.flatMap((o) => o.label.match(/\b[A-Z]{2}\b/g) ?? []))].filter((x) => STATES[x]).sort()
      return { slug: e.slug, title: e.title, states, outcomes }
    })(),
    senate: {
      races: senateRaces,
      ratings: tally(senateRaces),
      seats: {
        total: 100, toWin: 51, current: SENATE_NOW, notUp, unmarketed,
        projected: { D: projDem, R: projRep, tossup: 100 - projDem - projRep },
        segments: { ...segments },
      },
    },
    house: {
      races: house,
      ratings: tally(house),
      seats: {
        total: 435, toWin: 218, unmarketed: 435 - house.length,
        // House seat-bracket markets imply an expected count (bracket midpoints weighted by price)
        implied: hs ? { D: hs.dem, R: hs.rep, slug: hs.slug } : null,
      },
    },
    governor: {
      races: governors,
      ratings: tally(governors),
      favored: { D: governors.filter((r) => r.dem > r.rep).length, R: governors.filter((r) => r.rep > r.dem).length },
    },
    categories: MIDTERM_CATEGORIES.map((c) => ({ ...c, count: live.filter((e) => hasTag(e, c.slug)).length })).filter((c) => c.count > 0),
    countries: [...countryCounts.values()].sort((a, b) => a.name.localeCompare(b.name)),
    events: cards,
  }
}
