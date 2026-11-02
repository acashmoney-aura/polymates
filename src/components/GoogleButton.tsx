import { useEffect, useRef, useState } from 'react'
import { api, type User } from '../api'

interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string; auto_select?: boolean }): void
  renderButton(el: HTMLElement, o: Record<string, unknown>): void
}
declare global { interface Window { google?: { accounts: { id: GoogleId } } } }

let config: Promise<{ googleClientId: string | null }> | null = null
let script: Promise<void> | null = null
const loadScript = () => (script ??= new Promise<void>((resolve, reject) => {
  const s = document.createElement('script')
  s.src = 'https://accounts.google.com/gsi/client'
  s.async = true
  s.onload = () => resolve()
  s.onerror = () => { script = null; reject(new Error('Could not load Google sign-in')) }
  document.head.appendChild(s)
}))

/**
 * "Sign in with Google" via Google Identity Services. Renders nothing when the
 * server has no GOOGLE_CLIENT_ID configured. Posts the ID token to /api/auth/google;
 * when already signed in, the server links Google to the current account instead.
 */
export function GoogleButton({ onSignedIn, onError, text = 'continue_with' }: {
  onSignedIn: (token: string, user: User, created: boolean) => void
  onError: (msg: string) => void
  text?: 'continue_with' | 'signin_with' | 'signup_with'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [clientId, setClientId] = useState<string | null>(null)
  const cb = useRef({ onSignedIn, onError })
  cb.current = { onSignedIn, onError }

  useEffect(() => {
    config ??= api<{ googleClientId: string | null }>('/api/config').catch(() => ({ googleClientId: null }))
    void config.then((c) => setClientId(c.googleClientId))
  }, [])

  useEffect(() => {
    if (!clientId || !ref.current) return
    let cancelled = false
    loadScript().then(() => {
      const gid = window.google?.accounts.id
      if (cancelled || !gid || !ref.current) return
      gid.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          try {
            const r = await api<{ token: string; user: User; created?: boolean }>('/api/auth/google', { method: 'POST', body: { credential } })
            cb.current.onSignedIn(r.token, r.user, Boolean(r.created))
          } catch (e) { cb.current.onError((e as Error).message) }
        },
      })
      gid.renderButton(ref.current, { theme: 'filled_black', size: 'large', shape: 'pill', text, width: Math.min(ref.current.offsetWidth || 320, 400), logo_alignment: 'center' })
    }).catch((e: Error) => cb.current.onError(e.message))
    return () => { cancelled = true }
  }, [clientId, text])

  if (!clientId) return null
  return (
    <>
      <div ref={ref} className="google-btn" />
      <div className="or-divider"><span>or</span></div>
    </>
  )
}
