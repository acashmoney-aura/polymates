import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

// GitHub Pages serves 404.html for deep links; it stashes the path for us to restore.
const redirected = sessionStorage.getItem('pm_redirect')
if (redirected) {
  sessionStorage.removeItem('pm_redirect')
  history.replaceState(null, '', redirected)
}

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
window.addEventListener('popstate', notify)

const current = () => {
  const path = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname
  return (path || '/') + location.search
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const url = BASE + to
  if (opts.replace) history.replaceState(null, '', url)
  else history.pushState(null, '', url)
  if (!opts.replace && !to.includes('#')) window.scrollTo(0, 0)
  notify()
}

export function useLocation() {
  const loc = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    current,
  )
  const [path, search = ''] = loc.split('?')
  return { path, query: new URLSearchParams(search) }
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={BASE + to}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
      {...rest}
    />
  )
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} | Polymates` : 'Polymates | Prediction markets with your friends'
  }, [title])
}
