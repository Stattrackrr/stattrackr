import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: 'sb-auth-token',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
})

// Create a session-only client for non-remember-me logins
export const supabaseSessionOnly = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true, // Still persist session, but in sessionStorage
    storageKey: 'sb-session-token',
    storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
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
