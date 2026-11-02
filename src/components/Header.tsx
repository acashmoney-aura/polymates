import { useEffect, useRef, useState } from 'react'
import { usd } from '../api'
import { Icon, Logo, type IconName } from '../icons'
import { Link, navigate, useLocation } from '../router'
import { useApp } from '../store'
import { AnimatedNumber } from './Motion'
import { Avatar, ModeBadge } from './ui'

export const CATEGORIES: { slug: string; label: string; icon?: IconName }[] = [
  { slug: 'trending', label: 'Trending', icon: 'trending' },
  { slug: 'breaking', label: 'Breaking' },
  { slug: 'new', label: 'New' },
  { slug: 'league', label: 'League' },
  { slug: '|', label: '' },
  { slug: 'politics', label: 'Politics' },
  { slug: 'sports', label: 'Sports' },
  { slug: 'crypto', label: 'Crypto' },
  { slug: 'esports', label: 'Esports' },
  { slug: 'finance', label: 'Finance' },
  { slug: 'geopolitics', label: 'Geopolitics' },
  { slug: 'tech', label: 'Tech' },
  { slug: 'pop-culture', label: 'Culture' },
  { slug: 'economy', label: 'Economy' },
  { slug: 'weather', label: 'Weather' },
  { slug: 'elections', label: 'Elections' },
  { slug: 'mentions', label: 'Mentions' },
  { slug: 'world', label: 'World' },
]

function useOutside(onOut: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOut()
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onOut])
  return ref
}

function LeagueSwitcher() {
  const { leagues, leagueId, setLeagueId, user, openAuth } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useOutside(() => setOpen(false))
  const cur = leagues.find((l) => l.id === leagueId)
  return (
    <div className="league-switch" ref={ref}>
      <button className="league-switch-btn" onClick={() => (user ? setOpen(!open) : openAuth('signup'))}>
        <span className="ls-name">{cur ? cur.name : user ? 'Join a league' : 'Leagues'}</span>
        {cur && <ModeBadge mode={cur.mode} />}
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="menu">
          {leagues.map((l) => (
            <button key={l.id} className={`menu-item ${l.id === leagueId ? 'active' : ''}`}
              onClick={() => { setLeagueId(l.id); setOpen(false) }}>
              <span className="grow ellipsis">{l.name}</span>
              <ModeBadge mode={l.mode} />
            </button>
          ))}
          {leagues.length > 0 && <div className="menu-sep" />}
          <button className="menu-item" onClick={() => { navigate('/league?new=1'); setOpen(false) }}>
            <Icon name="plus" size={16} /> Create league
          </button>
          <button className="menu-item" onClick={() => { navigate('/league?join=1'); setOpen(false) }}>
            <Icon name="users" size={16} /> Join with invite code
          </button>
        </div>
      )}
    </div>
  )
}

function UserMenu() {
  const { user, logout, league } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useOutside(() => setOpen(false))
  if (!user) return null
  const go = (to: string) => () => { navigate(to); setOpen(false) }
  return (
    <div className="user-menu" ref={ref}>
      <button className="avatar-btn" onClick={() => setOpen(!open)} aria-label="Account menu">
        <Avatar user={user} size={32} />
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="menu menu-right">
          <div className="menu-head">
            <Avatar user={user} size={36} />
            <div><b>{user.displayName}</b><span>@{user.username}</span></div>
          </div>
          <div className="menu-sep" />
          <button className="menu-item" onClick={go('/portfolio')}><Icon name="wallet" size={16} /> Portfolio</button>
          <button className="menu-item" onClick={go('/leaderboard')}><Icon name="trophy" size={16} /> Leaderboard</button>
          <button className="menu-item" onClick={go('/activity')}><Icon name="activity" size={16} /> Activity</button>
          <button className="menu-item" onClick={go('/league')}><Icon name="settings" size={16} /> {league?.ownerId === user.id ? 'League settings' : 'League'}</button>
          <button className="menu-item" onClick={go('/lab')}><Icon name="zap" size={16} /> Quant Lab</button>
          <button className="menu-item" onClick={go('/developers')}><Icon name="bot" size={16} /> Agents & API</button>
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => { logout(); setOpen(false) }}><Icon name="logout" size={16} /> Log out</button>
        </div>
      )}
    </div>
  )
}

export function Header() {
  const { user, openAuth, portfolio, leagueId } = useApp()
  const { path, query } = useLocation()
  const [q, setQ] = useState(query.get('q') ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const tag = path === '/' ? (query.get('tag') ?? 'trending') : path.startsWith('/elections') || path === '/midterms' ? 'elections' : ''

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    navigate(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : '/')
  }

  return (
    <header className="header">
      <div className="header-row wrap">
        <Link to="/" className="brand"><Logo /><span>Polymates</span></Link>
        <span className="brand-sep" />
        <LeagueSwitcher />
        <form className="search" onSubmit={submit} role="search">
          <Icon name="search" size={18} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search polymarkets..." aria-label="Search markets" />
          <kbd>/</kbd>
        </form>
        <div className="header-right">
          {user && portfolio && leagueId ? (
            <>
              <Link to="/portfolio" className="hdr-stat"><span>Portfolio</span><b className="yes-accent"><AnimatedNumber value={portfolio.value} format={(n) => usd(n)} /></b></Link>
              <Link to="/portfolio" className="hdr-stat hide-sm"><span>Cash</span><b className="yes-accent"><AnimatedNumber value={portfolio.cash} format={(n) => usd(n)} /></b></Link>
            </>
          ) : user ? (
            <Link to="/league?new=1" className="btn btn-primary btn-sm">Create league</Link>
          ) : (
            <>
              <button className="btn btn-outline btn-sm" onClick={() => openAuth('login')}>Log In</button>
              <button className="btn btn-primary btn-sm" onClick={() => openAuth('signup')}>Sign Up</button>
            </>
          )}
          <Link to="/developers" className="icon-btn hide-sm" aria-label="Agents and API" title="Agents & API"><Icon name="bot" /></Link>
          <UserMenu />
        </div>
      </div>
      <nav className="tabs-bar">
        <div className="wrap tabs-scroll">
          {CATEGORIES.map((c) =>
            c.slug === '|' ? <span key="sep" className="tab-sep" /> : (
              <Link key={c.slug} to={c.slug === 'trending' ? '/' : c.slug === 'elections' ? '/elections' : `/?tag=${c.slug}`} className={`tab ${tag === c.slug ? 'active' : ''}`}>
                {c.icon && <Icon name={c.icon} size={16} />}
                {c.label}
              </Link>
            ),
          )}
          <span className="tab-sep" />
          <Link to="/lab" className={`tab tab-lab ${path === '/lab' ? 'active' : ''}`}><Icon name="zap" size={16} />Quant Lab</Link>
        </div>
      </nav>
    </header>
  )
}

export function MobileNav() {
  const { path } = useLocation()
  const items: { to: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
    { to: '/', label: 'Home', icon: 'home', match: (p) => p === '/' },
    { to: '/search', label: 'Search', icon: 'search', match: (p) => p === '/search' },
    { to: '/leaderboard', label: 'Ranks', icon: 'trophy', match: (p) => p === '/leaderboard' },
    { to: '/portfolio', label: 'Portfolio', icon: 'wallet', match: (p) => p === '/portfolio' },
    { to: '/more', label: 'More', icon: 'menu', match: (p) => ['/more', '/league', '/developers', '/activity', '/lab', '/elections', '/elections/midterms'].includes(p) },
  ]
  return (
    <nav className="mobile-nav">
      {items.map((i) => (
        <Link key={i.to} to={i.to} className={i.match(path) ? 'active' : ''}>
          <Icon name={i.icon} size={22} />
          <span>{i.label}</span>
        </Link>
      ))}
    </nav>
  )
}
