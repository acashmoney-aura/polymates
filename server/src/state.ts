import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  Activity, ApiKey, EquityPoint, League, Member, Order, PerpPosition, Position, Script, ScriptLog, Session, Settlement, Trade, User,
} from './types.ts'

/**
 * All game state lives in memory in a single process (Cloud Run max-instances=1)
 * and is snapshotted to Google Cloud Storage (or a local file in dev). For a game
 * of 20-30 people per league this is simpler and faster than a database round trip
 * on every order, and the matching engine needs a single writer anyway.
 */
export const db = {
  users: new Map<string, User>(),
  sessions: new Map<string, Session>(),
  apiKeys: new Map<string, ApiKey>(),
  leagues: new Map<string, League>(),
  members: new Map<string, Member>(),
  positions: new Map<string, Position>(),
  orders: new Map<string, Order>(),
  trades: [] as Trade[],
  scripts: new Map<string, Script>(),
  settlements: new Map<string, Settlement>(),
  activity: [] as Activity[],
  perps: new Map<string, PerpPosition>(),
  /** keyed by memberKey; hourly for the last week, daily before that */
  equity: new Map<string, EquityPoint[]>(),
}

export const scriptLogs = new Map<string, ScriptLog[]>()

export const memberKey = (leagueId: string, userId: string) => `${leagueId}:${userId}`
export const positionKey = (leagueId: string, userId: string, marketId: string) => `${leagueId}:${userId}:${marketId}`
export const settlementKey = (leagueId: string, marketId: string) => `${leagueId}:${marketId}`

const MAX_TRADES = 100_000
const MAX_ACTIVITY = 20_000

interface Snapshot {
  version: 1
  savedAt: number
  users: User[]
  sessions: Session[]
  apiKeys: ApiKey[]
  leagues: League[]
  members: Member[]
  positions: Position[]
  orders: Order[]
  trades: Trade[]
  scripts: Script[]
  settlements: Settlement[]
  activity: Activity[]
  perps?: PerpPosition[]
  equity?: { key: string; points: [number, number][] }[]
}

function toSnapshot(): Snapshot {
  if (db.trades.length > MAX_TRADES) db.trades.splice(0, db.trades.length - MAX_TRADES)
  if (db.activity.length > MAX_ACTIVITY) db.activity.splice(0, db.activity.length - MAX_ACTIVITY)
  // closed orders are only needed for history; keep the most recent ones
  const orders = [...db.orders.values()]
  const closed = orders.filter((o) => o.status !== 'open')
  if (closed.length > 50_000) {
    closed.sort((a, b) => a.updatedAt - b.updatedAt)
    for (const o of closed.slice(0, closed.length - 50_000)) db.orders.delete(o.id)
  }
  return {
    version: 1,
    savedAt: Date.now(),
    users: [...db.users.values()],
    sessions: [...db.sessions.values()],
    apiKeys: [...db.apiKeys.values()],
    leagues: [...db.leagues.values()],
    members: [...db.members.values()],
    positions: [...db.positions.values()],
    orders: [...db.orders.values()],
    trades: db.trades,
    scripts: [...db.scripts.values()],
    settlements: [...db.settlements.values()],
    activity: db.activity,
    perps: [...db.perps.values()],
    equity: [...db.equity].map(([key, pts]) => ({ key, points: pts.map((p) => [p.ts, p.pnl] as [number, number]) })),
  }
}

function fromSnapshot(s: Snapshot) {
  for (const u of s.users) db.users.set(u.id, u)
  for (const x of s.sessions) db.sessions.set(x.token, x)
  for (const k of s.apiKeys) db.apiKeys.set(k.id, k)
  for (const l of s.leagues) {
    const defaults = { marketScope: 'all', enabledEvents: [], disabledMarkets: [], houseLiquidity: false }
    db.leagues.set(l.id, Object.assign(defaults, l))
  }
  for (const m of s.members) db.members.set(memberKey(m.leagueId, m.userId), m)
  for (const p of s.positions) db.positions.set(positionKey(p.leagueId, p.userId, p.marketId), p)
  for (const o of s.orders) db.orders.set(o.id, o)
  db.trades = s.trades ?? []
  for (const sc of s.scripts) db.scripts.set(sc.id, sc)
  for (const st of s.settlements ?? []) db.settlements.set(settlementKey(st.leagueId, st.marketId), st)
  db.activity = s.activity ?? []
  for (const p of s.perps ?? []) db.perps.set(p.id, p)
  for (const e of s.equity ?? []) db.equity.set(e.key, e.points.map(([ts, pnl]) => ({ ts, pnl })))
}

interface Store {
  load(): Promise<Snapshot | null>
  save(data: string): Promise<void>
  describe: string
}

function fileStore(file: string): Store {
  return {
    describe: `file:${file}`,
    async load() {
      try {
        return JSON.parse(await fs.readFile(file, 'utf8'))
      } catch {
        return null
      }
    },
    async save(data) {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(`${file}.tmp`, data)
      await fs.rename(`${file}.tmp`, file)
    },
  }
}

async function gcsStore(bucketName: string, object: string): Promise<Store> {
  const { Storage } = await import('@google-cloud/storage')
  const file = new Storage().bucket(bucketName).file(object)
  return {
    describe: `gs://${bucketName}/${object}`,
    async load() {
      const [exists] = await file.exists()
      if (!exists) return null
      const [buf] = await file.download()
      return JSON.parse(buf.toString('utf8'))
    },
    async save(data) {
      await file.save(data, { contentType: 'application/json', resumable: false })
    },
  }
}

let store: Store
let dirty = false
let saving: Promise<void> | null = null

export async function initState() {
  const bucket = process.env.STATE_BUCKET
  store = bucket
    ? await gcsStore(bucket, process.env.STATE_OBJECT ?? 'polymates/state.json')
    : fileStore(process.env.STATE_FILE ?? path.resolve('data/state.json'))
  const snap = await store.load()
  if (snap) fromSnapshot(snap)
  console.log(`[state] ${store.describe} users=${db.users.size} leagues=${db.leagues.size} orders=${db.orders.size}`)
  setInterval(() => void flush(), 3000).unref()
}

export function markDirty() {
  dirty = true
}

export async function flush() {
  if (!dirty || !store) return saving ?? undefined
  if (saving) return saving
  dirty = false
  const data = JSON.stringify(toSnapshot())
  saving = store
    .save(data)
    .catch((err) => {
      dirty = true
      console.error('[state] save failed', err)
    })
    .finally(() => {
      saving = null
    })
  return saving
}
