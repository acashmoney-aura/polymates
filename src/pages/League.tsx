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

function LeagueSettings({ league }: { league: LeagueT }) {
  const { user, refreshLeague, refreshMe, toast } = useApp()
  const isOwner = league.ownerId === user?.id
  const [name, setName] = useState(league.name)
  useEffect(() => setName(league.name), [league.name])
  const inviteUrl = `${location.origin}${import.meta.env.BASE_URL}join/${league.inviteCode}`
  const patch = async (body: object) => {
    try {
      await api(`/api/leagues/${league.id}`, { method: 'PATCH', body })
      await refreshLeague()
      await refreshMe()
      toast('Saved')
    } catch (e) { toast((e as Error).message, 'error') }
  }
  return (
    <>
      <section className="card settings-card">
        <div className="settings-head">
          <h2>{league.name}</h2> <ModeBadge mode={league.mode} />
        </div>
        <p className="muted">
          {league.mode === 'mirror'
            ? 'Mirror mode: orders fill against the live Polymarket order book.'
            : 'Exchange mode: members trade with each other on the league’s own order book.'}{' '}
          Starting balance {usd(league.startingBalance, 0)}. Markets resolve exactly as Polymarket resolves them.
        </p>
        <div className="invite">
          <div><span className="muted small">Invite code</span><b className="code">{league.inviteCode}</b></div>
          <button className="btn btn-outline btn-sm" onClick={() => { void navigator.clipboard?.writeText(inviteUrl); toast('Invite link copied') }}><Icon name="copy" size={16} /> Copy invite link</button>
          {isOwner && <button className="btn btn-ghost btn-sm" onClick={() => patch({ regenerateInvite: true })}>New code</button>}
        </div>
      </section>

      {isOwner && (
        <section className="card settings-card">
          <h3>Settings</h3>
          <label className="field"><span>Name</span>
            <div className="row-gap"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /><button className="btn btn-outline" onClick={() => patch({ name })}>Save</button></div>
          </label>
          {league.mode === 'exchange' && (
            <label className="field row"><Toggle on={league.houseLiquidity} onChange={(v) => patch({ houseLiquidity: v })} label="House liquidity" />
              <span>House market maker: quotes 250 shares ±2¢ around the Polymarket price on markets people are looking at</span></label>
          )}
        </section>
      )}

      {isOwner && <MarketManager league={league} />}

      <section className="card settings-card">
        <h3>Members ({league.members.length})</h3>
        <ul className="members">
          {league.members.map((m) => (
            <li key={m.id}><Avatar user={m} size={32} /><span className="grow"><b>{m.displayName}</b> <small className="muted">@{m.username}</small></span>{m.role === 'owner' && <span className="tag">Owner</span>}</li>
          ))}
        </ul>
      </section>
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
