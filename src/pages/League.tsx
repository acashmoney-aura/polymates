import { useEffect, useState } from 'react'
import { api, compactUsd, pct, qs, usd, type League as LeagueT, type LeagueMode } from '../api'
import { CATEGORIES } from '../components/Header'
import { Avatar, Empty, Img, ModeBadge, Spinner, useEvents } from '../components/ui'
import { Icon } from '../icons'
import { Link, navigate, useLocation, useTitle } from '../router'
import { useApp } from '../store'
import { Toggle, toggleMarket } from './Event'

function CreateLeague({ onDone }: { onDone: () => void }) {
  const { refreshMe, setLeagueId, toast } = useApp()
  const [name, setName] = useState('')
  const [mode, setMode] = useState<LeagueMode>('mirror')
  const [balance, setBalance] = useState('10000')
  const [scope, setScope] = useState<'all' | 'curated'>('all')
  const [house, setHouse] = useState(true)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const l = await api<LeagueT>('/api/leagues', { method: 'POST', body: { name, mode, startingBalance: Number(balance), marketScope: scope, houseLiquidity: house } })
      await refreshMe()
      setLeagueId(l.id)
      toast(`Created ${l.name}`)
      onDone()
      navigate(scope === 'curated' ? '/league#markets' : '/league', { replace: true })
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <form className="card form-card" onSubmit={submit}>
      <h2>Create a league</h2>
      <label className="field"><span>League name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Friday Night Futures" maxLength={60} required /></label>
      <div className="field"><span>Mode</span>
        <div className="mode-cards">
          <button type="button" className={`mode-card ${mode === 'mirror' ? 'active' : ''}`} onClick={() => setMode('mirror')}>
            <b><Icon name="globe" size={18} /> Mirror Polymarket</b>
            <span>Your orders fill against the real, live Polymarket order book. Compete with friends on who trades best. Great for any group size.</span>
          </button>
          <button type="button" className={`mode-card ${mode === 'exchange' ? 'active' : ''}`} onClick={() => setMode('exchange')}>
            <b><Icon name="swap" size={18} /> Own order book</b>
            <span>The league runs its own exchange. 20–30 friends post bids and asks and only trade with each other. Same markets, same resolution.</span>
          </button>
        </div>
      </div>
      <label className="field"><span>Starting balance (fantasy $)</span><input inputMode="numeric" value={balance} onChange={(e) => setBalance(e.target.value.replace(/\D/g, ''))} /></label>
      <div className="field"><span>Markets</span>
        <div className="seg">
          <button type="button" className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>All Polymarket markets</button>
          <button type="button" className={scope === 'curated' ? 'active' : ''} onClick={() => setScope('curated')}>Hand-picked only</button>
        </div>
        <small className="muted">{scope === 'all' ? 'Everything is on; you can switch individual markets off later.' : 'Nothing is on until you turn markets on in league settings.'}</small>
      </div>
      {mode === 'exchange' && (
        <label className="field row"><Toggle on={house} onChange={setHouse} label="House liquidity" /><span>House market maker quotes ±2¢ around Polymarket so books are never empty</span></label>
      )}
      <button className="ledge-btn" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create league'}</button>
    </form>
  )
}

function JoinLeague({ code: initial }: { code?: string }) {
  const { refreshMe, setLeagueId, toast, user, openAuth } = useApp()
  const [code, setCode] = useState(initial ?? '')
  const [preview, setPreview] = useState<{ name: string; mode: LeagueMode; owner: string; members: number; startingBalance: number } | null>(null)
  useEffect(() => {
    if (code.length >= 6) api<typeof preview>(`/api/leagues/invite/${code}`).then(setPreview).catch(() => setPreview(null))
  }, [code])
  const join = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return openAuth('signup')
    try {
      const l = await api<LeagueT>('/api/leagues/join', { method: 'POST', body: { inviteCode: code } })
      await refreshMe()
      setLeagueId(l.id)
      toast(`Joined ${l.name}`)
      navigate('/')
    } catch (err) { toast((err as Error).message, 'error') }
  }
  return (
    <form className="card form-card" onSubmit={join}>
      <h2>Join a league</h2>
      <label className="field"><span>Invite code</span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={12} /></label>
      {preview && (
        <div className="invite-preview">
          <b>{preview.name}</b> <ModeBadge mode={preview.mode} />
          <span className="muted">by {preview.owner} · {preview.members} members · {usd(preview.startingBalance, 0)} start</span>
        </div>
      )}
      <button className="ledge-btn" disabled={code.length < 4}>{user ? 'Join league' : 'Sign up to join'}</button>
    </form>
  )
}

function MarketManager({ league }: { league: LeagueT }) {
  const { refreshLeague, toast } = useApp()
  const [q, setQ] = useState('')
  const [tag, setTag] = useState<string>(league.marketScope === 'curated' ? 'trending' : 'trending')
  const [onlyOn, setOnlyOn] = useState(league.marketScope === 'curated')
  const [open, setOpen] = useState<string | null>(null)
  const [limit, setLimit] = useState(30)
  const { data, setData } = useEvents(qs({ league: league.id, q, tag: tag === 'trending' ? undefined : tag, limit, all: onlyOn ? undefined : 1 }), [league.enabledEvents.length, league.disabledMarkets.length, league.marketScope])
  const set = async (kind: 'events' | 'markets', id: string, on: boolean) => {
    try {
      await toggleMarket(league, kind, id, on)
      await refreshLeague()
      // optimistic: reflect immediately while refetch happens
      setData((d) => d && {
        ...d,
        events: d.events.map((e) => kind === 'events' && e.id === id
          ? { ...e, enabled: on, markets: e.markets.map((m) => ({ ...m, enabled: on })) }
          : { ...e, markets: e.markets.map((m) => (kind === 'markets' && m.id === id ? { ...m, enabled: on } : m)) }),
      })
    } catch (e) { toast((e as Error).message, 'error') }
  }
  const setScope = async (scope: 'all' | 'curated') => {
    await api(`/api/leagues/${league.id}`, { method: 'PATCH', body: { marketScope: scope } })
    await refreshLeague()
    setOnlyOn(false)
  }
  return (
    <section className="card settings-card" id="markets">
      <div className="settings-head">
        <h3>Markets</h3>
        <span className="grow" />
        <div className="seg">
          <button className={league.marketScope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>All on</button>
          <button className={league.marketScope === 'curated' ? 'active' : ''} onClick={() => setScope('curated')}>Hand-picked</button>
        </div>
      </div>
      <p className="muted small">
        {league.marketScope === 'all'
          ? `Every Polymarket market is tradable. ${league.disabledMarkets.length} outcome market${league.disabledMarkets.length === 1 ? '' : 's'} switched off.`
          : `Only events you switch on are tradable. ${league.enabledEvents.length} event${league.enabledEvents.length === 1 ? '' : 's'} on.`}
      </p>
      <div className="toolbar">
        <label className="search small-search"><Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find markets to turn on or off" /></label>
        <label className="check"><input type="checkbox" checked={onlyOn} onChange={(e) => setOnlyOn(e.target.checked)} /> Only show on</label>
      </div>
      <div className="chips-row">
        {CATEGORIES.filter((c) => !['|', 'league', 'breaking'].includes(c.slug)).map((c) => (
          <button key={c.slug} className={tag === c.slug ? 'active' : ''} onClick={() => setTag(c.slug)}>{c.label}</button>
        ))}
      </div>
      {!data ? <Spinner /> : !data.events.length ? <p className="muted">No events match.</p> : (
        <ul className="mm-list">
          {data.events.map((e) => {
            const onCount = e.markets.filter((m) => m.enabled).length
            const on = e.enabled && onCount > 0
            return (
              <li key={e.id} className={on ? '' : 'off'}>
                <div className="mm-row">
                  <Img src={e.icon} size={36} />
                  <button className="mm-title" onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <span className="ellipsis">{e.title}</span>
                    <small className="muted">{compactUsd(e.volume)} Vol. · {e.markets.length > 1 ? `${onCount}/${e.markets.length} outcomes on` : pct(e.markets[0]?.price ?? 0)}</small>
                  </button>
                  {e.markets.length > 1 && <button className="icon-btn" onClick={() => setOpen(open === e.id ? null : e.id)} aria-label="Show outcomes"><Icon name={open === e.id ? 'chevronDown' : 'chevronRight'} size={16} /></button>}
                  <Toggle on={on} onChange={(v) => set('events', e.id, v)} label={`Turn ${e.title} ${on ? 'off' : 'on'}`} />
                </div>
                {open === e.id && e.markets.length > 1 && (
                  <ul className="mm-sub">
                    {e.markets.map((m) => (
                      <li key={m.id}>
                        <span className="grow ellipsis">{m.title}</span>
                        <span className="muted">{pct(m.price)}</span>
                        <Toggle on={m.enabled} onChange={(v) => set('markets', m.id, v)} label={`Turn ${m.title} ${m.enabled ? 'off' : 'on'}`} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {data && data.total > data.events.length && <div className="center"><button className="pill" onClick={() => setLimit(limit + 30)}>Show more</button></div>}
    </section>
  )
}

function Members({ league }: { league: LeagueT }) {
  const { user, refreshLeague, toast } = useApp()
  const [menu, setMenu] = useState<string | null>(null)
  const me = league.myRole
  const rank = { member: 0, admin: 1, owner: 2 } as const
  const act = async (path: string, method: 'PATCH' | 'DELETE' | 'POST', body: object | undefined, done: string) => {
    setMenu(null)
    try {
      await api(path, { method, body })
      await refreshLeague()
      toast(done)
    } catch (e) { toast((e as Error).message, 'error') }
  }
  return (
    <section className="card settings-card">
      <div className="settings-head"><h3>Members ({league.members.length})</h3></div>
      <ul className="members">
        {league.members.map((m) => {
          const canManage = me && m.id !== user?.id && rank[me] > rank[m.role]
          return (
            <li key={m.id}>
              <Avatar user={m} size={32} />
              <span className="grow"><b>{m.displayName}</b> <small className="muted">@{m.username}</small></span>
              {m.role !== 'member' && <span className={`tag role-${m.role}`}>{m.role === 'owner' ? 'Owner' : 'Admin'}</span>}
              {canManage && (
                <span className="menu-wrap">
                  <button className="icon-btn" aria-label={`Manage ${m.displayName}`} onClick={() => setMenu(menu === m.id ? null : m.id)}><Icon name="more" size={18} /></button>
                  {menu === m.id && (
                    <div className="menu-pop" onMouseLeave={() => setMenu(null)}>
                      {me === 'owner' && m.role === 'member' && <button onClick={() => act(`/api/leagues/${league.id}/members/${m.id}`, 'PATCH', { role: 'admin' }, `${m.displayName} is now an admin`)}>Make admin</button>}
                      {me === 'owner' && m.role === 'admin' && <button onClick={() => act(`/api/leagues/${league.id}/members/${m.id}`, 'PATCH', { role: 'member' }, `${m.displayName} is now a member`)}>Remove admin</button>}
                      {me === 'owner' && <button onClick={() => { if (confirm(`Hand ownership of ${league.name} to ${m.displayName}? You will become an admin.`)) void act(`/api/leagues/${league.id}/transfer`, 'POST', { userId: m.id }, `${m.displayName} now owns the league`) }}>Transfer ownership</button>}
                      <button className="danger" onClick={() => { if (confirm(`Remove ${m.displayName}? Their open orders are cancelled and positions cleared.`)) void act(`/api/leagues/${league.id}/members/${m.id}`, 'DELETE', undefined, `Removed ${m.displayName}`) }}>Remove from league</button>
                    </div>
                  )}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function DangerZone({ league }: { league: LeagueT }) {
  const { refreshMe, refreshLeague, toast } = useApp()
  const [action, setAction] = useState<'reset' | 'delete' | null>(null)
  const [typed, setTyped] = useState('')
  const owner = league.myRole === 'owner'
  const leave = async () => {
    const alone = league.members.length <= 1
    if (owner && !alone) return toast('Transfer ownership to someone else first, or delete the league', 'error')
    if (!confirm(alone && owner ? `You are the only member, so leaving deletes ${league.name}. Continue?` : `Leave ${league.name}? Your orders are cancelled and positions cleared.`)) return
    try {
      await api(`/api/leagues/${league.id}/leave`, { method: 'POST' })
      await refreshMe()
      toast(`Left ${league.name}`)
      navigate('/league')
    } catch (e) { toast((e as Error).message, 'error') }
  }
  const confirmAction = async () => {
    try {
      if (action === 'reset') {
        await api(`/api/leagues/${league.id}/reset`, { method: 'POST', body: { confirm: typed } })
        await refreshLeague()
        await refreshMe()
        toast(`Season ${league.season + 1} started`)
      } else {
        await api(`/api/leagues/${league.id}`, { method: 'DELETE', body: { confirm: typed } })
        await refreshMe()
        toast(`Deleted ${league.name}`)
        navigate('/league')
      }
      setAction(null)
      setTyped('')
    } catch (e) { toast((e as Error).message, 'error') }
  }
  return (
    <section className="card settings-card danger-zone">
      <h3>{owner ? 'Danger zone' : 'Leave league'}</h3>
      <div className="dz-row">
        <div><b>Leave league</b><small className="muted">Cancels your orders and clears your positions here.</small></div>
        <button className="btn btn-outline btn-sm" onClick={leave}>Leave</button>
      </div>
      {owner && (
        <>
          <div className="dz-row">
            <div><b>Start a new season</b><small className="muted">Season {league.season} → {league.season + 1}. Cancels every order, clears positions and trades, resets everyone to {usd(league.startingBalance, 0)}.</small></div>
            <button className="btn btn-outline btn-sm" onClick={() => { setAction('reset'); setTyped('') }}>New season</button>
          </div>
          <div className="dz-row">
            <div><b>Delete league</b><small className="muted">Permanently removes the league, its members, trades and bots.</small></div>
            <button className="btn btn-danger btn-sm" onClick={() => { setAction('delete'); setTyped('') }}>Delete</button>
          </div>
        </>
      )}
      {action && (
        <div className="dz-confirm">
          <label className="field"><span>Type <b>{league.name}</b> to {action === 'reset' ? 'start a new season' : 'delete the league'}</span>
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={league.name} />
          </label>
          <div className="row-gap">
            <button className="btn btn-ghost btn-sm" onClick={() => setAction(null)}>Cancel</button>
            <button className="btn btn-danger btn-sm" disabled={typed.trim() !== league.name} onClick={confirmAction}>{action === 'reset' ? 'Start new season' : 'Delete forever'}</button>
          </div>
        </div>
      )}
    </section>
  )
}

function LeagueSettings({ league }: { league: LeagueT }) {
  const { refreshLeague, refreshMe, toast } = useApp()
  const canAdmin = league.myRole === 'owner' || league.myRole === 'admin'
  const [name, setName] = useState(league.name)
  const [desc, setDesc] = useState(league.description ?? '')
  const [balance, setBalance] = useState(String(league.startingBalance))
  useEffect(() => { setName(league.name); setDesc(league.description ?? ''); setBalance(String(league.startingBalance)) }, [league.name, league.description, league.startingBalance])
  const inviteUrl = `${location.origin}${import.meta.env.BASE_URL}join/${league.inviteCode}`
  const patch = async (body: object) => {
    try {
      await api(`/api/leagues/${league.id}`, { method: 'PATCH', body })
      await refreshLeague()
      await refreshMe()
      toast('Saved')
    } catch (e) { toast((e as Error).message, 'error') }
  }
  const dirty = name !== league.name || desc !== (league.description ?? '') || Number(balance) !== league.startingBalance
  return (
    <>
      <section className="card settings-card league-hero">
        <div className="settings-head">
          <h2>{league.name}</h2> <ModeBadge mode={league.mode} />
          <span className="tag">Season {league.season}</span>
          {league.myRole && league.myRole !== 'member' && <span className={`tag role-${league.myRole}`}>You’re {league.myRole === 'owner' ? 'the owner' : 'an admin'}</span>}
        </div>
        {league.description && <p className="league-desc">{league.description}</p>}
        <p className="muted">
          {league.mode === 'mirror'
            ? 'Mirror mode: orders fill against the live Polymarket order book.'
            : 'Exchange mode: members trade with each other on the league’s own order book.'}{' '}
          Starting balance {usd(league.startingBalance, 0)}. Markets resolve exactly as Polymarket resolves them.
        </p>
        <div className="invite">
          <div><span className="muted small">Invite code</span><b className="code">{league.inviteCode}</b></div>
          <button className="btn btn-outline btn-sm" onClick={() => { void navigator.clipboard?.writeText(inviteUrl); toast('Invite link copied') }}><Icon name="copy" size={16} /> Copy invite link</button>
          {canAdmin && <button className="btn btn-ghost btn-sm" onClick={() => patch({ regenerateInvite: true })}>New code</button>}
        </div>
      </section>

      {canAdmin && (
        <section className="card settings-card">
          <h3>Settings</h3>
          <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></label>
          <label className="field"><span>Description</span><textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={280} placeholder="House rules, prizes, trash talk…" /></label>
          <label className="field"><span>Starting balance (fantasy $)</span>
            <input inputMode="numeric" value={balance} onChange={(e) => setBalance(e.target.value.replace(/\D/g, ''))} />
            <small className="muted">Applies to people who join from now on and to the next season.</small>
          </label>
          <div><button className="btn btn-primary btn-sm" disabled={!dirty || !name.trim()} onClick={() => patch({ name, description: desc, startingBalance: Number(balance) })}>Save changes</button></div>
          {league.mode === 'exchange' && (
            <label className="field row"><Toggle on={league.houseLiquidity} onChange={(v) => patch({ houseLiquidity: v })} label="House liquidity" />
              <span>House market maker: quotes 250 shares ±2¢ around the Polymarket price on markets people are looking at</span></label>
          )}
        </section>
      )}

      {canAdmin && <MarketManager league={league} />}
      <Members league={league} />
      <DangerZone league={league} />
    </>
  )
}

export function LeaguePage() {
  const { query } = useLocation()
  const { user, leagues, league, leagueId, setLeagueId, openAuth, ready } = useApp()
  const [mode, setMode] = useState<'view' | 'new' | 'join'>(query.get('new') ? 'new' : query.get('join') ? 'join' : 'view')
  useEffect(() => setMode(query.get('new') ? 'new' : query.get('join') ? 'join' : 'view'), [query])
  useTitle('League')
  useEffect(() => {
    if (location.hash === '#markets') setTimeout(() => document.getElementById('markets')?.scrollIntoView({ behavior: 'smooth' }), 400)
  }, [league?.id])
  if (!ready) return <div className="wrap page"><Spinner /></div>
  if (!user) {
    return <div className="wrap page"><Empty title="Leagues are private games with your friends">
      <button className="btn btn-primary" onClick={() => openAuth('signup')}>Sign up to start</button>
    </Empty></div>
  }
  const effective = !leagues.length && mode === 'view' ? 'new' : mode
  return (
    <div className="wrap page league-page">
      <div className="league-nav">
        {leagues.map((l) => (
          <button key={l.id} className={`pill ${l.id === leagueId && effective === 'view' ? 'active' : ''}`} onClick={() => { setLeagueId(l.id); navigate('/league') }}>
            {l.name} <ModeBadge mode={l.mode} />
          </button>
        ))}
        <button className={`pill ${effective === 'new' ? 'active' : ''}`} onClick={() => navigate('/league?new=1')}><Icon name="plus" size={16} /> Create</button>
        <button className={`pill ${effective === 'join' ? 'active' : ''}`} onClick={() => navigate('/league?join=1')}><Icon name="users" size={16} /> Join</button>
      </div>
      {effective === 'new' && <CreateLeague onDone={() => setMode('view')} />}
      {effective === 'join' && <JoinLeague />}
      {effective === 'view' && (league ? <LeagueSettings league={league} /> : <Spinner />)}
      {effective === 'view' && league && (
        <p className="muted small center">Want bots in this league? <Link to="/developers">Connect an agent or upload a script</Link>.</p>
      )}
    </div>
  )
}

export function JoinPage({ code }: { code: string }) {
  useTitle('Join league')
  return <div className="wrap page league-page"><JoinLeague code={code} /></div>
}
