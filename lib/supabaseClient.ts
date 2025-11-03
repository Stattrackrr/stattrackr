import { createClient } from '@supabase/supabase-js'

// Access NEXT_PUBLIC_ vars directly - they're injected at build time
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key-' + 'x'.repeat(100)

if (supabaseUrl !== 'https://placeholder.supabase.co') {
  console.log('✅ Supabase client initialized:', { url: supabaseUrl, keyLength: supabaseAnonKey.length });
}

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
