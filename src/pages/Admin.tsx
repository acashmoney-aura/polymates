import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, timeAgo, type User } from '../api'
import { Avatar, Empty, Spinner } from '../components/ui'
import { Icon } from '../icons'
import { useTitle } from '../router'
import { useApp } from '../store'

interface AdminStats {
  generatedAt: number
  users: {
    total: number; google: number; password: number
    new1d: number; new7d: number; new30d: number
    active1d: number; active7d: number; active30d: number
  }
  activity: { leagues: number; orders: number; openOrders: number; trades: number; trades1d: number; apiKeys: number; scripts: number }
  signups: { day: number; count: number }[]
  leagues: { id: string; name: string; mode: string; createdAt: number; owner: string | null; members: number; trades: number }[]
  userList: (User & { signIn: 'google' | 'password' | 'both'; leagues: number; trades: number; lastSeen: number | null })[]
  server: { uptimeSec: number; memoryMb: number }
}

const n = (x: number) => x.toLocaleString('en-US')
const day = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const uptime = (s: number) => (s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`)

function Tile({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="card admin-tile">
      <span className="muted small">{label}</span>
      <b>{typeof value === 'number' ? n(value) : value}</b>
      {sub && <span className="small admin-sub">{sub}</span>}
    </div>
  )
}

function Signups({ data }: { data: AdminStats['signups'] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const total = data.reduce((a, d) => a + d.count, 0)
  return (
    <section className="card admin-card">
      <div className="admin-card-head">
        <h3>Signups, last 30 days</h3>
        <span className="muted small">{n(total)} total</span>
      </div>
      <div className="admin-bars" role="img" aria-label={`Signups per day for the last 30 days, ${total} total`}>
        {data.map((d) => (
          <div key={d.day} className="admin-bar" title={`${day(d.day)}: ${d.count}`}>
            <i style={{ height: `${(d.count / max) * 100}%` }} className={d.count ? '' : 'zero'} />
          </div>
        ))}
      </div>
      <div className="admin-axis muted small"><span>{day(data[0].day)}</span><span>Today</span></div>
    </section>
  )
}

export function AdminPage() {
  const { user, openAuth } = useApp()
  useTitle('Admin')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setBusy(true)
    api<AdminStats>('/api/admin/stats')
      .then((s) => { setStats(s); setError(null) })
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'denied' : (e as Error).message))
      .finally(() => setBusy(false))
  }, [])
  useEffect(() => { if (user) load() }, [user, load])

  if (!user) {
    return <div className="wrap page"><Empty title="Log in to see admin stats"><button className="btn btn-primary" onClick={() => openAuth('login')}>Log in</button></Empty></div>
  }
  if (error === 'denied') return <div className="wrap page"><Empty title="Page not found" /></div>
  if (error) return <div className="wrap page"><Empty title="Couldn't load stats">{error}</Empty></div>
  if (!stats) return <div className="wrap page center"><Spinner /></div>

  const { users: u, activity: a } = stats
  return (
    <div className="wrap page admin">
      <div className="admin-head">
        <h1>Admin</h1>
        <span className="muted small">Updated {timeAgo(stats.generatedAt)}</span>
        <button className="btn admin-refresh" onClick={load} disabled={busy}><Icon name="refresh" size={16} /> Refresh</button>
      </div>

      <div className="admin-tiles">
        <Tile label="Users" value={u.total} sub={`${n(u.password)} password · ${n(u.google)} Google`} />
        <Tile label="New users" value={u.new7d} sub={`${n(u.new1d)} today · ${n(u.new30d)} in 30 days`} />
        <Tile label="Active, last 7 days" value={u.active7d} sub={`${n(u.active1d)} today · ${n(u.active30d)} in 30 days`} />
        <Tile label="Trades" value={a.trades} sub={`${n(a.trades1d)} in the last 24h`} />
        <Tile label="Leagues" value={a.leagues} />
        <Tile label="Orders" value={a.orders} sub={`${n(a.openOrders)} open`} />
        <Tile label="API keys · scripts" value={`${n(a.apiKeys)} · ${n(a.scripts)}`} />
        <Tile label="Server" value={`${n(stats.server.memoryMb)} MB`} sub={`up ${uptime(stats.server.uptimeSec)}`} />
      </div>

      <Signups data={stats.signups} />

      <section className="card admin-card">
        <div className="admin-card-head"><h3>Users</h3><span className="muted small">newest first</span></div>
        <div className="admin-scroll">
          <table className="admin-table">
            <thead><tr><th>User</th><th>Sign-in</th><th className="num">Leagues</th><th className="num">Trades</th><th>Joined</th><th>Last seen</th></tr></thead>
            <tbody>
              {stats.userList.map((r) => (
                <tr key={r.id}>
                  <td><span className="admin-user"><Avatar user={r} size={24} /><span><b>{r.displayName}</b> <span className="muted mono">@{r.username}</span></span></span></td>
                  <td className="muted">{r.signIn === 'both' ? 'Password + Google' : r.signIn === 'google' ? 'Google' : 'Password'}</td>
                  <td className="num">{n(r.leagues)}</td>
                  <td className="num">{n(r.trades)}</td>
                  <td className="muted">{timeAgo(r.createdAt)}</td>
                  <td className="muted">{r.lastSeen ? timeAgo(r.lastSeen) : 'never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card admin-card">
        <div className="admin-card-head"><h3>Leagues</h3></div>
        <div className="admin-scroll">
          <table className="admin-table">
            <thead><tr><th>League</th><th>Mode</th><th>Owner</th><th className="num">Members</th><th className="num">Trades</th><th>Created</th></tr></thead>
            <tbody>
              {stats.leagues.map((l) => (
                <tr key={l.id}>
                  <td><b>{l.name}</b></td>
                  <td className="muted">{l.mode}</td>
                  <td className="muted mono">{l.owner ? `@${l.owner}` : '—'}</td>
                  <td className="num">{n(l.members)}</td>
                  <td className="num">{n(l.trades)}</td>
                  <td className="muted">{timeAgo(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
