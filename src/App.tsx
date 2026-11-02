import { lazy, Suspense, useState } from 'react'
import { api, type User } from './api'
import { Header, MobileNav } from './components/Header'
import { Modal, Spinner } from './components/ui'
import { GoogleButton } from './components/GoogleButton'
import { Icon, Logo } from './icons'
import { Developers } from './pages/Developers'
import { Lab } from './pages/Lab'
import { PerpAssetPage, PerpsPage } from './pages/Perps'
import { EventPage, SheetHost } from './pages/Event'
import { Home, SearchPage } from './pages/Home'
import { JoinPage, LeaguePage } from './pages/League'
import { Leaderboard } from './pages/Leaderboard'
import { ActivityPage, Portfolio } from './pages/Portfolio'
import { Link, useLocation, useTitle } from './router'
import { AppProvider, useApp } from './store'

// map path data is ~150KB, so the elections pages load on demand
const ElectionsPage = lazy(() => import('./pages/Elections').then((m) => ({ default: m.ElectionsPage })))
const MidtermsPage = lazy(() => import('./pages/Elections').then((m) => ({ default: m.MidtermsPage })))

function AuthModal() {
  const { authModal, openAuth, login } = useApp()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!authModal) return null
  const signup = authModal === 'signup'
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ token: string; user: User }>(`/api/auth/${signup ? 'signup' : 'login'}`, {
        method: 'POST', body: { username, password, displayName: displayName || undefined },
      })
      await login(res.token, res.user)
      setPassword('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal onClose={() => openAuth(null)} className="auth">
      <div className="auth-logo"><Logo /></div>
      <h2>{signup ? 'Create your account' : 'Welcome back'}</h2>
      <p className="muted small">Fantasy dollars only. No deposits, no withdrawals, no real money.</p>
      <GoogleButton
        text={signup ? 'signup_with' : 'signin_with'}
        onSignedIn={(token, user) => void login(token, user)}
        onError={setError}
      />
      <form onSubmit={submit} className="auth-form">
        <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoComplete="username" autoCapitalize="none" />
        {signup && <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name (optional)" />}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete={signup ? 'new-password' : 'current-password'} />
        {error && <p className="error-text">{error}</p>}
        <button className="ledge-btn" disabled={busy || !username || !password}>{busy ? '…' : signup ? 'Sign Up' : 'Log In'}</button>
      </form>
      <p className="small center">
        {signup ? 'Already have an account? ' : 'New here? '}
        <button className="link-btn" onClick={() => { setError(null); openAuth(signup ? 'login' : 'signup') }}>{signup ? 'Log in' : 'Sign up'}</button>
      </p>
    </Modal>
  )
}

function Toasts() {
  const { toasts } = useApp()
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}><Icon name={t.kind === 'ok' ? 'check' : 'info'} size={16} /> {t.text}</div>)}
    </div>
  )
}

function MorePage() {
  const { user, logout, openAuth, league } = useApp()
  useTitle('More')
  const items = [
    { to: '/league', label: league ? `League: ${league.name}` : 'Leagues', icon: 'users' as const },
    { to: '/activity', label: 'League activity', icon: 'activity' as const },
    { to: '/lab', label: 'Quant Lab', icon: 'zap' as const },
    { to: '/perps', label: 'Perps', icon: 'trending' as const },
    { to: '/elections', label: 'Elections', icon: 'globe' as const },
    { to: '/developers', label: 'Agents & API', icon: 'bot' as const },
    { to: '/?tag=league', label: 'League markets', icon: 'swap' as const },
  ]
  return (
    <div className="wrap page narrow">
      <ul className="more-list">
        {items.map((i) => <li key={i.to}><Link to={i.to}><Icon name={i.icon} /> <span className="grow">{i.label}</span><Icon name="chevronRight" size={16} /></Link></li>)}
        <li>{user
          ? <button onClick={logout}><Icon name="logout" /> <span className="grow">Log out</span></button>
          : <button onClick={() => openAuth('login')}><Icon name="logout" /> <span className="grow">Log in</span></button>}</li>
      </ul>
    </div>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <div>
          <Link to="/" className="brand"><Logo /><span>Polymates</span></Link>
          <p className="muted small">Prediction markets with your friends. Markets and resolutions mirror Polymarket. Fantasy dollars only, with no cash value.</p>
        </div>
        <div className="footer-links">
          <Link to="/leaderboard">Leaderboard</Link>
          <Link to="/league">Leagues</Link>
          <Link to="/developers">Agents & API</Link>
          <a href="https://github.com/acashmoney-aura/polymates" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </div>
      <div className="wrap footer-legal muted">Not affiliated with Polymarket. Market data © Polymarket, shown for entertainment.</div>
    </footer>
  )
}

function RoutedMain() {
  const { path } = useLocation()
  return <main key={path} className="route-fade"><Routes /></main>
}

function Routes() {
  const { path } = useLocation()
  if (path.startsWith('/event/')) return <EventPage key={path} slug={decodeURIComponent(path.slice(7))} />
  if (path.startsWith('/join/')) return <JoinPage code={path.slice(6)} />
  if (path.startsWith('/perps/')) return <PerpAssetPage key={path} symbol={decodeURIComponent(path.slice(7))} />
  switch (path) {
    case '/portfolio': return <Portfolio />
    case '/leaderboard': return <Leaderboard />
    case '/league': return <LeaguePage />
    case '/developers': return <Developers />
    case '/activity': return <ActivityPage />
    case '/search': return <SearchPage />
    case '/more': return <MorePage />
    case '/lab': return <Lab />
    case '/perps': return <PerpsPage />
    case '/elections': return <Suspense fallback={<div className="wrap page center"><Spinner /></div>}><ElectionsPage /></Suspense>
    case '/midterms':
    case '/elections/midterms': return <Suspense fallback={<div className="wrap page center"><Spinner /></div>}><MidtermsPage /></Suspense>
    default: return <Home />
  }
}

export default function App() {
  return (
    <AppProvider>
      <Header />
      <RoutedMain />
      <Footer />
      <MobileNav />
      <AuthModal />
      <SheetHost />
      <Toasts />
    </AppProvider>
  )
}
