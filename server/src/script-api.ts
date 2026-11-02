import { getMember } from './engine.ts'
import { MIN_INTERVAL_SEC } from './scripts.ts'
import { db, markDirty, scriptLogs } from './state.ts'
import type { Script } from './types.ts'
import { fail, id, now } from './util.ts'

const MAX_SCRIPTS_PER_USER = 10

const view = (s: Script) => ({ ...s, logs: undefined })

export function listScripts(userId: string, leagueId?: string) {
  return [...db.scripts.values()]
    .filter((s) => s.userId === userId && (!leagueId || s.leagueId === leagueId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(view)
}

function check(code: string | undefined, intervalSec: number | undefined) {
  if (code !== undefined && (typeof code !== 'string' || code.length > 100_000)) fail(400, 'code must be a string under 100KB')
  if (intervalSec !== undefined && !(Number(intervalSec) >= MIN_INTERVAL_SEC)) fail(400, `interval must be at least ${MIN_INTERVAL_SEC}s`)
}

export function createScript(userId: string, input: { leagueId?: string; name: string; code: string; intervalSec?: number; enabled?: boolean }) {
  if (!input.leagueId) fail(400, 'leagueId required')
  getMember(input.leagueId!, userId)
  check(input.code, input.intervalSec)
  if (listScripts(userId).length >= MAX_SCRIPTS_PER_USER) fail(400, `Limit of ${MAX_SCRIPTS_PER_USER} scripts per user`)
  const s: Script = {
    id: id('scr'),
    userId,
    leagueId: input.leagueId!,
    name: String(input.name || 'Untitled bot').slice(0, 60),
    code: input.code,
    enabled: input.enabled ?? false,
    intervalSec: Math.round(Number(input.intervalSec ?? 60)),
    createdAt: now(),
    updatedAt: now(),
    lastRunAt: null,
    lastError: null,
    runs: 0,
    store: {},
  }
  db.scripts.set(s.id, s)
  markDirty()
  return view(s)
}

export function updateScript(userId: string, scriptId: string, patch: Partial<Pick<Script, 'name' | 'code' | 'intervalSec' | 'enabled'>> & { resetStore?: boolean }) {
  const s = db.scripts.get(scriptId)
  if (!s || s.userId !== userId) fail(404, 'Script not found')
  check(patch.code, patch.intervalSec)
  if (patch.name !== undefined) s!.name = String(patch.name).slice(0, 60)
  if (patch.code !== undefined) s!.code = patch.code
  if (patch.intervalSec !== undefined) s!.intervalSec = Math.round(Number(patch.intervalSec))
  if (patch.enabled !== undefined) {
    s!.enabled = Boolean(patch.enabled)
    if (s!.enabled) s!.lastError = null
  }
  if (patch.resetStore) s!.store = {}
  s!.updatedAt = now()
  markDirty()
  return view(s!)
}

export function deleteScript(userId: string, scriptId: string) {
  const s = db.scripts.get(scriptId)
  if (!s || s.userId !== userId) fail(404, 'Script not found')
  db.scripts.delete(scriptId)
  scriptLogs.delete(scriptId)
  markDirty()
  return { deleted: true }
}

export function scriptLogsFor(userId: string, scriptId: string) {
  const s = db.scripts.get(scriptId)
  if (!s || s.userId !== userId) fail(404, 'Script not found')
  return scriptLogs.get(scriptId) ?? []
}
