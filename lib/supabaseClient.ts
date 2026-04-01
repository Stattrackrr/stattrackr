import { createClient } from '@supabase/supabase-js'

// Access NEXT_PUBLIC_ vars directly - they're injected at build time
// These should always be present - if not, it's a configuration error
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Validate that required env vars are present
// NEXT_PUBLIC_ vars are injected at build time, so this check should pass
if (!supabaseUrl || !supabaseAnonKey) {
  const errorMsg = 'Missing Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY). Please check your configuration.';
  if (typeof window !== 'undefined') {
    console.error(errorMsg);
  }
  // Throw error to fail fast - these are required
  throw new Error(errorMsg);
}

const isBrowser = typeof window !== 'undefined'
const TAB_NAMESPACE_SESSION_KEY = 'stattrackr_tab_namespace'
const TAB_NAMESPACE_LIST_KEY = 'stattrackr_tab_namespaces'
const MAX_TAB_SESSIONS = 10
const PERSISTENT_STORAGE_KEY = 'sb-auth-token'
const SESSION_STORAGE_KEY = 'sb-session-token'
const AFL_PAGE_STATE_KEY = 'aflPageState:v1'
const AFL_PLAYER_LOGS_CACHE_PREFIX = 'aflPlayerLogsCache:'

type StorageAdapter = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const maybeDom = error as DOMException
  return maybeDom.name === 'QuotaExceededError' || maybeDom.code === 22 || maybeDom.code === 1014
}

function bestEffortPruneForAuthWrite(currentNamespace: string, aggressive = false) {
  if (!isBrowser) return

  // First remove auth/session remnants from other tabs.
  const namespaces = getRegisteredNamespaces()
  const stale = namespaces.filter((ns) => ns && ns !== currentNamespace)
  for (const ns of stale) {
    cleanupNamespace(ns)
  }
  try {
    window.localStorage.setItem(TAB_NAMESPACE_LIST_KEY, JSON.stringify([currentNamespace]))
  } catch {
    // ignore
  }

  // Then remove the largest non-critical local AFL caches.
  const keysToRemove: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    if (!key) continue
    if (key.startsWith(AFL_PLAYER_LOGS_CACHE_PREFIX) || key === AFL_PAGE_STATE_KEY) {
      keysToRemove.push(key)
    }
  }
  for (const key of keysToRemove) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }

  // Last-resort fallback: clear session-style UI cache keys if still full.
  if (aggressive) {
    const extraPrefixes = ['nba_filters_', 'journal-']
    const extraKeys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key) continue
      if (extraPrefixes.some((prefix) => key.startsWith(prefix))) extraKeys.push(key)
    }
    for (const key of extraKeys) {
      try {
        window.localStorage.removeItem(key)
      } catch {
        // ignore
      }
    }
  }
}

function setLocalStorageWithQuotaRecovery(namespace: string, key: string, value: string) {
  const targetKey = `${namespace}:${key}`
  try {
    window.localStorage.setItem(targetKey, value)
    return
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error
  }

  bestEffortPruneForAuthWrite(namespace, false)
  try {
    window.localStorage.setItem(targetKey, value)
    return
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error
  }

  bestEffortPruneForAuthWrite(namespace, true)
  window.localStorage.setItem(targetKey, value)
}

const createNamespacedStorage = (storage: Storage, namespace: string, recoverQuota = false): StorageAdapter => ({
  getItem: (key: string) => storage.getItem(`${namespace}:${key}`),
  setItem: (key: string, value: string) => {
    if (recoverQuota && isBrowser && storage === window.localStorage) {
      setLocalStorageWithQuotaRecovery(namespace, key, value)
      return
    }
    storage.setItem(`${namespace}:${key}`, value)
  },
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
  try {
    window.localStorage.setItem(TAB_NAMESPACE_LIST_KEY, JSON.stringify(namespaces))
  } catch {
    // If quota is exceeded here, keep going; auth storage has its own recovery path.
  }
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
    try {
      setLocalStorageWithQuotaRecovery(target, PERSISTENT_STORAGE_KEY, persistent)
    } catch {
      // ignore; target tab can still proceed to login if token copy fails
    }
  }
  if (sessionOnly !== null && !window.localStorage.getItem(`${target}:${SESSION_STORAGE_KEY}`)) {
    try {
      setLocalStorageWithQuotaRecovery(target, SESSION_STORAGE_KEY, sessionOnly)
    } catch {
      // ignore; target tab can still proceed to login if token copy fails
    }
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
  ? createNamespacedStorage(window.localStorage, tabNamespace, true)
  : undefined

const sessionOnlyStorage = isBrowser
  ? createNamespacedStorage(window.sessionStorage, tabNamespace)
  : undefined

if (supabaseUrl !== 'https://placeholder.supabase.co') {
  if (process.env.NODE_ENV === 'development') {
    console.log('✅ Supabase client initialized:', {
      url: supabaseUrl,
      keyLength: supabaseAnonKey.length,
      namespace: isBrowser ? tabNamespace : 'server',
    });
  }
} else if (isBrowser && process.env.NODE_ENV === 'development') {
  console.warn('⚠️ Supabase URL not configured. Please set NEXT_PUBLIC_SUPABASE_URL in your .env.local file.');
}

// Only suppress Supabase auth errors during build phase, not at runtime
// This prevents build failures from known Supabase client initialization issues
// but does not hide runtime errors which are important for debugging
const isBuildPhase = typeof process !== 'undefined' && 
  (process.env.NEXT_PHASE === 'phase-production-build' || 
   process.env.NODE_ENV === 'production' && !process.env.VERCEL);

// Store original console methods at module level for restoration later
let originalConsoleError: typeof console.error | null = null;
let originalConsoleWarn: typeof console.warn | null = null;

if (!isBrowser && isBuildPhase) {
  // Only during build: suppress known Supabase auth errors that occur during static generation
  // These errors are expected when Supabase client initializes during build without a session
  originalConsoleError = console.error;
  originalConsoleWarn = console.warn;
  
  const isKnownSupabaseBuildError = (args: any[]): boolean => {
    const message = args[0]?.toString() || '';
    const errorObj = typeof args[0] === 'object' ? args[0] : null;
    const errorMessage = errorObj?.message || errorObj?.error_description || '';
    
    // Only suppress specific known Supabase build-time errors
    return (
      (message.includes('Invalid Refresh Token') || 
       message.includes('Refresh Token Not Found') ||
       message.includes('AuthApiError')) &&
      (message.includes('build') || errorMessage.includes('build'))
    );
  };

  console.error = (...args: any[]) => {
    if (isKnownSupabaseBuildError(args)) {
      // Only suppress known build-time Supabase errors
      return;
    }
    originalConsoleError!.apply(console, args);
  };
  
  console.warn = (...args: any[]) => {
    if (isKnownSupabaseBuildError(args)) {
      return;
    }
    originalConsoleWarn!.apply(console, args);
  };
}

// Auth config - completely disabled during build/server
const authConfig = isBrowser ? {
  persistSession: true,
  storageKey: PERSISTENT_STORAGE_KEY,
  storage: persistentStorage,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  flowType: 'pkce' as const,
} : {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
  // No storage during build - prevents refresh token errors
  storage: undefined,
};

// Browser singleton on window so all chunks share one client (avoids "Multiple GoTrueClient instances")
const WIN_SUPABASE_KEY = '__STATTACKR_SUPABASE_CLIENT__';

function getBrowserSupabase(): ReturnType<typeof createClient> | null {
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>)[WIN_SUPABASE_KEY]) {
    return (window as unknown as Record<string, unknown>)[WIN_SUPABASE_KEY] as ReturnType<typeof createClient>;
  }
  return null;
}

function setBrowserSupabase(client: ReturnType<typeof createClient>) {
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>)[WIN_SUPABASE_KEY] = client;
  }
}

// Only enable autoRefreshToken in browser - during build/server there's no session to refresh
// Wrap in try-catch to suppress any initialization errors during build
let supabase: ReturnType<typeof createClient>;
try {
  if (isBrowser) {
    const existing = getBrowserSupabase();
    if (existing) {
      supabase = existing;
    } else {
      supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: authConfig,
      });
      setBrowserSupabase(supabase);
      // Set up error handler only for the client we just created (avoid duplicate listeners)
      if (typeof window !== 'undefined') {
        window.addEventListener('unhandledrejection', (event) => {
      const error = event.reason;
      const errorMessage = error?.message || error?.toString() || '';
      
      // Suppress refresh token errors and network errors - they're harmless (user just needs to log in again)
      if (
        errorMessage.includes('Invalid Refresh Token') ||
        errorMessage.includes('Refresh Token Not Found') ||
        errorMessage.includes('refresh') ||
        errorMessage.includes('Failed to fetch') ||
        errorMessage.includes('NetworkError') ||
        errorMessage.includes('Network request failed') ||
        error?.name === 'AuthApiError' ||
        error?.name === 'TypeError'
      ) {
        event.preventDefault(); // Prevent error from showing in console
        // Clear invalid tokens silently
        if (persistentStorage) {
          persistentStorage.removeItem(PERSISTENT_STORAGE_KEY);
        }
        if (sessionOnlyStorage) {
          sessionOnlyStorage.removeItem(SESSION_STORAGE_KEY);
        }
        return;
      }
    });
    
    // Also suppress console errors for auth errors
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      const message = args[0]?.toString() || '';
      const errorObj = typeof args[0] === 'object' ? args[0] : null;
      const errorMessage = errorObj?.message || errorObj?.error_description || '';
      
      // Suppress refresh token errors and network errors in console
      if (
        message.includes('Invalid Refresh Token') ||
        message.includes('Refresh Token Not Found') ||
        message.includes('AuthApiError') ||
        message.includes('Failed to fetch') ||
        message.includes('NetworkError') ||
        message.includes('Network request failed') ||
        errorMessage.includes('refresh') ||
        errorMessage.includes('token') ||
        errorMessage.includes('Failed to fetch') ||
        errorMessage.includes('NetworkError')
      ) {
        // Silently ignore - user just needs to log in again or check network/Supabase config
        return;
      }
      originalConsoleError.apply(console, args);
    };
    
    // Override getSession to handle errors gracefully
    const originalGetSession = supabase.auth.getSession.bind(supabase.auth);
    supabase.auth.getSession = async () => {
      try {
        return await originalGetSession();
      } catch (error: any) {
        // If it's a refresh token error or network error, clear storage and return null session
        if (
          error?.message?.includes('Invalid Refresh Token') ||
          error?.message?.includes('Refresh Token Not Found') ||
          error?.message?.includes('refresh') ||
          error?.message?.includes('Failed to fetch') ||
          error?.message?.includes('NetworkError') ||
          error?.message?.includes('Network request failed')
        ) {
          // Clear all auth storage
          if (persistentStorage) {
            persistentStorage.removeItem(PERSISTENT_STORAGE_KEY);
          }
          if (sessionOnlyStorage) {
            sessionOnlyStorage.removeItem(SESSION_STORAGE_KEY);
          }
          // Return empty session instead of throwing
          return { data: { session: null }, error: null };
        }
        throw error;
      }
    };
      }
    }
  } else {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: authConfig,
    });
  }
} catch (error: any) {
  // During build, create a minimal client that won't cause errors
  if (!isBrowser && (error?.message?.includes('refresh') || error?.message?.includes('token'))) {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: undefined,
      },
      global: {
        fetch: () => Promise.reject(new Error('Supabase not available during build')),
      },
    });
  } else {
    throw error;
  }
}

// Session-only export: same client as supabase to avoid "Multiple GoTrueClient instances" in the same browser context.
// Callers (e.g. useSessionManager) still check both persistent and session storage via the single client's getSession.
function getSupabaseSessionOnly(): ReturnType<typeof createClient> {
  return supabase;
}

const supabaseSessionOnly = supabase;

// Restore console methods after client creation
if (!isBrowser && originalConsoleError && originalConsoleWarn) {
  // Keep error suppression active during build to catch async errors
  // The suppression will remain until the module is fully loaded
  setTimeout(() => {
    console.error = originalConsoleError!;
    console.warn = originalConsoleWarn!;
  }, 0);
}

export { supabase, supabaseSessionOnly, getSupabaseSessionOnly };

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
          bookmaker?: string | null
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
          bookmaker?: string | null
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
