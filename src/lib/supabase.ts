import { createClient } from '@supabase/supabase-js'
import type { RuntimePersistenceMode } from './types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey)
export const runtimePersistenceMode: RuntimePersistenceMode = hasSupabaseEnv ? 'supabase' : 'local'

export const supabase = hasSupabaseEnv
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

export function describeRuntimeMode() {
  return runtimePersistenceMode === 'supabase'
    ? 'Supabase-backed runtime ready'
    : 'Local runtime fallback active until Supabase credentials are added'
}
