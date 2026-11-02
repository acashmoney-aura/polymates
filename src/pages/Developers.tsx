import { useCallback, useEffect, useState } from 'react'
import { api, API_URL, timeAgo, type ApiKeyRow, type ScriptLog, type ScriptRow } from '../api'
import { CodeBlock as Code, CodeEditor } from '../components/Code'
import { Empty, Spinner } from '../components/ui'
import { Icon } from '../icons'
import { useTitle } from '../router'
import { useApp } from '../store'
import { NeedLeague } from './Portfolio'
import { Toggle } from './Event'

function ApiKeys({ onKey }: { onKey: (k: string) => void }) {
  const { toast } = useApp()
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null)
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)
  const load = useCallback(() => { api<ApiKeyRow[]>('/api/me/api-keys').then(setKeys).catch(() => {}) }, [])
  useEffect(load, [load])
  const create = async () => {
    try {
      const k = await api<ApiKeyRow>('/api/me/api-keys', { method: 'POST', body: { name: name || 'My agent' } })
      setFresh(k.key!)
      onKey(k.key!)
      setName('')
      load()
    } catch (e) { toast((e as Error).message, 'error') }
  }
  const remove = async (id: string) => {
    await api(`/api/me/api-keys/${id}`, { method: 'DELETE' })
    load()
  }
  return (
    <section className="card settings-card">
      <h3><Icon name="key" size={18} /> API keys</h3>
      <p className="muted small">Keys act as you in every league you're in. Use them for REST, MCP, and anything else that trades for you.</p>
      <div className="row-gap">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name, e.g. claude-code" maxLength={40} />
        <button className="btn btn-primary" onClick={create}>Create key</button>
      </div>
      {fresh && (
        <div className="fresh-key">
          <span className="small">Copy this now. You won't see it again.</span>
          <Code>{fresh}</Code>
        </div>
      )}
      {!keys ? <Spinner /> : (
        <ul className="members">
          {keys.map((k) => (
            <li key={k.id}>
              <Icon name="key" size={16} />
              <span className="grow"><b>{k.name}</b> <small className="muted mono">{k.prefix}…</small></span>
              <small className="muted">{k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)}` : 'never used'}</small>
              <button className="icon-btn" aria-label="Revoke key" onClick={() => remove(k.id)}><Icon name="trash" size={16} /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const PM_API = `pm.markets({ q, tag, limit })        // tradable markets with league prices
pm.event(slug)  pm.market(id)  pm.book(id)  // book is quoted in YES price
pm.portfolio()  pm.orders()  pm.leaderboard()
pm.buy(id, 'yes'|'no', price, shares)       // limit orders, price 0..1
pm.sell(id, 'yes'|'no', price, shares)
pm.marketBuy(id, outcome, dollars)  pm.marketSell(id, outcome, shares)
pm.cancel(orderId)  pm.cancelAll(marketId?)
pm.log(...)  pm.store  pm.now  pm.mode      // store persists between runs`

function Scripts() {
  const { leagueId, toast } = useApp()
  const [scripts, setScripts] = useState<ScriptRow[] | null>(null)
  const [sel, setSel] = useState<ScriptRow | null>(null)
  const [draft, setDraft] = useState({ name: '', code: '', intervalSec: 60 })
  const [logs, setLogs] = useState<ScriptLog[]>([])
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    if (!leagueId) return
    const s = await api<ScriptRow[]>(`/api/leagues/${leagueId}/scripts`)
    setScripts(s)
    return s
  }, [leagueId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!sel) return
    setDraft({ name: sel.name, code: sel.code, intervalSec: sel.intervalSec })
    const pull = () => api<ScriptLog[]>(`/api/scripts/${sel.id}/logs`).then(setLogs).catch(() => {})
    void pull()
    const t = setInterval(pull, 5000)
    return () => clearInterval(t)
  }, [sel])

  const newScript = async () => {
    const { code } = await api<{ code: string }>('/api/scripts/example')
    const s = await api<ScriptRow>(`/api/leagues/${leagueId}/scripts`, { method: 'POST', body: { name: 'Long-shot bot', code, intervalSec: 60, enabled: false } })
    await load()
    setSel(s)
  }
  const save = async (extra: Partial<ScriptRow> = {}) => {
    if (!sel) return
    try {
      const s = await api<ScriptRow>(`/api/scripts/${sel.id}`, { method: 'PATCH', body: { ...draft, ...extra } })
      setSel(s)
      await load()
      toast('Saved')
    } catch (e) { toast((e as Error).message, 'error') }
  }
  const run = async () => {
    if (!sel) return
    setBusy(true)
    try {
      await api(`/api/scripts/${sel.id}`, { method: 'PATCH', body: draft })
      const r = await api<{ result: { ok: boolean; error?: string; ms: number }; logs: ScriptLog[] }>(`/api/scripts/${sel.id}/run`, { method: 'POST', body: {} })
      setLogs(r.logs)
      toast(r.result.ok ? `Ran in ${r.result.ms}ms` : r.result.error ?? 'Failed', r.result.ok ? 'ok' : 'error')
      await load()
    } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!sel || !confirm(`Delete ${sel.name}?`)) return
    await api(`/api/scripts/${sel.id}`, { method: 'DELETE' })
    setSel(null)
    await load()
  }

  return (
    <section className="card settings-card">
      <div className="settings-head">
        <h3><Icon name="bot" size={18} /> Hosted scripts</h3>
        <span className="grow" />
        <button className="btn btn-primary btn-sm" onClick={newScript}><Icon name="plus" size={16} /> New script</button>
      </div>
      <p className="muted small">JavaScript bots that run on our servers every N seconds (min 10s) inside a sandbox, with no network or filesystem access. Define <code>onTick(pm)</code>. Up to 10 per person.</p>
      {!scripts ? <Spinner /> : !scripts.length ? null : (
        <ul className="script-list">
          {scripts.map((s) => (
            <li key={s.id} className={sel?.id === s.id ? 'active' : ''} onClick={() => setSel(s)}>
              <span className={`status-dot ${s.enabled ? (s.lastError ? 'err' : 'on') : ''}`} />
              <span className="grow"><b>{s.name}</b><small className="muted"> every {s.intervalSec}s · {s.runs} runs{s.lastRunAt ? ` · last ${timeAgo(s.lastRunAt)}` : ''}</small></span>
              <Toggle on={s.enabled} label={`Enable ${s.name}`} onChange={async (v) => { await api(`/api/scripts/${s.id}`, { method: 'PATCH', body: { enabled: v } }); await load() }} />
            </li>
          ))}
        </ul>
      )}
      {sel && (
        <div className="editor">
          <div className="row-gap">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Script name" />
            <label className="inline-field">every <input type="number" min={10} value={draft.intervalSec} onChange={(e) => setDraft({ ...draft, intervalSec: Number(e.target.value) })} /> s</label>
          </div>
          <CodeEditor className="script-editor" label="Script code" value={draft.code} onChange={(code) => setDraft({ ...draft, code })} />
          <div className="row-gap">
            <button className="btn btn-primary" onClick={() => save()}>Save</button>
            <button className="btn btn-outline" disabled={busy} onClick={run}><Icon name="play" size={14} /> {busy ? 'Running…' : 'Run once'}</button>
            <span className="grow" />
            <button className="btn btn-ghost" onClick={remove}><Icon name="trash" size={16} /> Delete</button>
          </div>
          {sel.lastError && <p className="error-text">Last error: {sel.lastError}</p>}
          <div className="logs">
            {!logs.length ? <span className="muted">No logs yet. Run it once.</span> : logs.slice().reverse().map((l, i) => (
              <div key={i} className={l.level}><time>{new Date(l.ts).toLocaleTimeString()}</time> {l.msg}</div>
            ))}
          </div>
          <details><summary>pm API reference</summary><Code>{PM_API}</Code></details>
        </div>
      )}
    </section>
  )
}

export function Developers() {
  const { user, leagueId, leagues } = useApp()
  const [key, setKey] = useState<string | null>(null)
  useTitle('Agents & API')
  if (!user || !leagueId) return <NeedLeague what="API keys" />
  const k = key ?? 'pm_YOUR_KEY'
  const mcpUrl = `${API_URL}/mcp`
  return (
    <div className="wrap page narrow dev-page">
      <h1>Agents & API</h1>
      <p className="muted">Let Claude Code, Codex, Cursor or your own code trade in your leagues, either live over MCP or as a script that runs on our backend.</p>
      <ApiKeys onKey={setKey} />

      <section className="card settings-card">
        <h3><Icon name="zap" size={18} /> Connect over MCP</h3>
        <p className="muted small">Streamable HTTP MCP server. Tools: search_markets, get_event, get_order_book, place_order, cancel_order, get_portfolio, get_leaderboard, upload_script, run_script and more.</p>
        <span className="small">Claude Code</span>
        <Code>{`claude mcp add --transport http polymates ${mcpUrl} --header "Authorization: Bearer ${k}"`}</Code>
        <span className="small">Codex / Cursor / any MCP client (JSON config)</span>
        <Code>{JSON.stringify({ mcpServers: { polymates: { url: mcpUrl, headers: { Authorization: `Bearer ${k}` } } } }, null, 2)}</Code>
      </section>

      <section className="card settings-card">
        <h3><Icon name="code" size={18} /> REST API</h3>
        <p className="muted small">Base URL <code>{API_URL}</code>. Your league ids: {leagues.map((l) => <code key={l.id}>{l.id}</code>)}.</p>
        <Code>{`# find markets
curl "${API_URL}/api/markets?league=${leagueId}&q=bitcoin" -H "Authorization: Bearer ${k}"

# buy $25 of YES at market
curl -X POST ${API_URL}/api/leagues/${leagueId}/orders \\
  -H "Authorization: Bearer ${k}" -H "content-type: application/json" \\
  -d '{"marketId":"<id>","side":"buy","outcome":"yes","type":"market","amount":25}'

# limit: sell 10 NO at 62¢
  -d '{"marketId":"<id>","side":"sell","outcome":"no","type":"limit","price":0.62,"size":10}'

# portfolio, open orders, order book, leaderboard
GET /api/leagues/${leagueId}/portfolio
GET /api/leagues/${leagueId}/orders
GET /api/markets/<id>/book?league=${leagueId}
GET /api/leagues/${leagueId}/leaderboard
DELETE /api/orders/<orderId>`}</Code>
        <p className="muted small">Full reference: <a href="https://github.com/acashmoney-aura/polymates/blob/main/docs/API.md" target="_blank" rel="noreferrer">docs/API.md</a></p>
      </section>

      <Scripts />
      {!leagues.length && <Empty title="Join a league first" />}
    </div>
  )
}
