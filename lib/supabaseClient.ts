import { createClient } from '@supabase/supabase-js'

// Access NEXT_PUBLIC_ vars directly - they're injected at build time
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key-' + 'x'.repeat(100)

const isBrowser = typeof window !== 'undefined'
const TAB_NAMESPACE_SESSION_KEY = 'stattrackr_tab_namespace'
const TAB_NAMESPACE_LIST_KEY = 'stattrackr_tab_namespaces'
const MAX_TAB_SESSIONS = 10
const PERSISTENT_STORAGE_KEY = 'sb-auth-token'
const SESSION_STORAGE_KEY = 'sb-session-token'

type StorageAdapter = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

const createNamespacedStorage = (storage: Storage, namespace: string): StorageAdapter => ({
  getItem: (key: string) => storage.getItem(`${namespace}:${key}`),
  setItem: (key: string, value: string) => storage.setItem(`${namespace}:${key}`, value),
  removeItem: (key: string) => storage.removeItem(`${namespace}:${key}`),
})

const cleanupNamespace = (namespace: string) => {
  if (!isBrowser) return
  window.localStorage.removeItem(`${namespace}:${PERSISTENT_STORAGE_KEY}`)
  window.localStorage.removeItem(`${namespace}:${SESSION_STORAGE_KEY}`)
}

const getRegisteredNamespaces = (): string[] => {
  if (!isBrowser) return []
  const raw = window.localStorage.getItem(TAB_NAMESPACE_LIST_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === 'string')
    }
  } catch {
    // ignore
  }
  return []
}

const persistNamespaces = (namespaces: string[]) => {
  if (!isBrowser) return
  window.localStorage.setItem(TAB_NAMESPACE_LIST_KEY, JSON.stringify(namespaces))
}

const registerNamespace = (namespace: string): string[] => {
  if (!isBrowser) return []
  const namespaces = getRegisteredNamespaces()
  if (!namespaces.includes(namespace)) {
    namespaces.push(namespace)
  }
  while (namespaces.length > MAX_TAB_SESSIONS) {
    const removed = namespaces.shift()
    if (removed) {
      cleanupNamespace(removed)
    }
  }
  persistNamespaces(namespaces)
  return namespaces
}

const ensureTabNamespace = (): string => {
  if (!isBrowser) return 'server'
  let namespace = window.sessionStorage.getItem(TAB_NAMESPACE_SESSION_KEY)
  if (!namespace) {
    const randomId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    namespace = `tab-${randomId}`
    window.sessionStorage.setItem(TAB_NAMESPACE_SESSION_KEY, namespace)
  }
  registerNamespace(namespace)
  return namespace
}

const tabNamespace = ensureTabNamespace()
const registeredNamespaces = registerNamespace(tabNamespace)

const copySessionFromNamespace = (source: string, target: string) => {
  if (!isBrowser || source === target) return
  const persistent = window.localStorage.getItem(`${source}:${PERSISTENT_STORAGE_KEY}`)
  const sessionOnly = window.localStorage.getItem(`${source}:${SESSION_STORAGE_KEY}`)
  if (persistent !== null && !window.localStorage.getItem(`${target}:${PERSISTENT_STORAGE_KEY}`)) {
    window.localStorage.setItem(`${target}:${PERSISTENT_STORAGE_KEY}`, persistent)
  }
  if (sessionOnly !== null && !window.localStorage.getItem(`${target}:${SESSION_STORAGE_KEY}`)) {
    window.localStorage.setItem(`${target}:${SESSION_STORAGE_KEY}`, sessionOnly)
  }
}

if (isBrowser) {
  const existingPersistent = window.localStorage.getItem(`${tabNamespace}:${PERSISTENT_STORAGE_KEY}`)
  const existingSession = window.localStorage.getItem(`${tabNamespace}:${SESSION_STORAGE_KEY}`)
  if (!existingPersistent && !existingSession) {
    const candidateNamespaces = registeredNamespaces.filter(ns => ns !== tabNamespace)
    const sourceNamespace = candidateNamespaces[candidateNamespaces.length - 1]
    if (sourceNamespace) {
      copySessionFromNamespace(sourceNamespace, tabNamespace)
    }
  }
}

const persistentStorage = isBrowser
  ? createNamespacedStorage(window.localStorage, tabNamespace)
  : undefined

const sessionOnlyStorage = isBrowser
  ? createNamespacedStorage(window.sessionStorage, tabNamespace)
  : undefined

if (supabaseUrl !== 'https://placeholder.supabase.co') {
  console.log('✅ Supabase client initialized:', {
    url: supabaseUrl,
    keyLength: supabaseAnonKey.length,
    namespace: isBrowser ? tabNamespace : 'server',
  });
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: PERSISTENT_STORAGE_KEY,
    storage: persistentStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

// Create a session-only client for non-remember-me logins (per-tab isolation)
export const supabaseSessionOnly = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: SESSION_STORAGE_KEY,
    storage: sessionOnlyStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

// Types for the database schema
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      bets: {
        Row: {
          id: string
          user_id: string
          date: string
          sport: string
          market: string | null
          selection: string
          stake: number
          currency: string
          odds: number
          result: 'win' | 'loss' | 'void'
          created_at: string
          player_id?: string | null
          player_name?: string | null
          team?: string | null
          opponent?: string | null
          stat_type?: string | null
          line?: number | null
          over_under?: 'over' | 'under' | null
          actual_value?: number | null
          game_date?: string | null
          status?: 'pending' | 'settled' | null
        }
        Insert: {
          id?: string
          user_id: string
          date: string
          sport: string
          market?: string | null
          selection: string
          stake: number
          currency: string
          odds: number
          result: 'win' | 'loss' | 'void'
          created_at?: string
          player_id?: string | null
          player_name?: string | null
          team?: string | null
          opponent?: string | null
          stat_type?: string | null
          line?: number | null
          over_under?: 'over' | 'under' | null
          actual_value?: number | null
          game_date?: string | null
          status?: 'pending' | 'settled' | null
        }
        Update: {
          id?: string
          user_id?: string
          date?: string
          sport?: string
          market?: string | null
          selection?: string
          stake?: number
          currency?: string
          odds?: number
          result?: 'win' | 'loss' | 'void'
          created_at?: string
          player_id?: string | null
          player_name?: string | null
          team?: string | null
          opponent?: string | null
          stat_type?: string | null
          line?: number | null
          over_under?: 'over' | 'under' | null
          actual_value?: number | null
          game_date?: string | null
          status?: 'pending' | 'settled' | null
        }
      }
      tracked_props: {
        Row: {
          id: string
          user_id: string
          player_id: string
          player_name: string
          team: string
          stat_type: string
          line: number
          over_under: 'over' | 'under'
          game_date: string
          opponent: string | null
          status: 'pending' | 'hit' | 'missed' | 'void'
          actual_value: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          player_id: string
          player_name: string
          team: string
          stat_type: string
          line: number
          over_under: 'over' | 'under'
          game_date: string
          opponent?: string | null
          status?: 'pending' | 'hit' | 'missed' | 'void'
          actual_value?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          player_id?: string
          player_name?: string
          team?: string
          stat_type?: string
          line?: number
          over_under?: 'over' | 'under'
          game_date?: string
          opponent?: string | null
          status?: 'pending' | 'hit' | 'missed' | 'void'
          actual_value?: number | null
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
