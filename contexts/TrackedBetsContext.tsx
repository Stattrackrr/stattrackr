"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface TrackedBet {
  id: string;
  selection: string;
  stake: number;
  odds: number;
  sport: string;
  playerName?: string;
  stat?: string;
  line?: number;
  bookmaker?: string | null;
  isCustom?: boolean;
  gameStatus?: 'scheduled' | 'live' | 'completed';
  result?: 'pending' | 'win' | 'loss';
  gameDate?: string;
  actualValue?: number;
  actualPts?: number;
  actualReb?: number;
  actualAst?: number;
  actualStl?: number;
  actualBlk?: number;
  actualFg3m?: number;
  team?: string;
  opponent?: string;
}

interface TrackedBetsContextType {
  trackedBets: TrackedBet[];
  addTrackedBet: (bet: TrackedBet) => void;
  removeTrackedBet: (id: string) => void;
  clearAllTrackedBets: () => void;
  refreshTrackedBets: () => void;
}

const TrackedBetsContext = createContext<TrackedBetsContextType | undefined>(undefined);

export function TrackedBetsProvider({ children }: { children: ReactNode }) {
  const [trackedBets, setTrackedBets] = useState<TrackedBet[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load from localStorage after hydration
  useEffect(() => {
    const stored = localStorage.getItem('trackedBets');
    if (stored) {
      try {
        setTrackedBets(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse stored tracked bets:', e);
      }
    }
    setIsHydrated(true);
  }, []);

  // Persist to localStorage whenever trackedBets changes (after hydration)
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem('trackedBets', JSON.stringify(trackedBets));
      console.log('Persisted tracked bets to localStorage:', trackedBets);
    }
  }, [trackedBets, isHydrated]);

  const addTrackedBet = (bet: TrackedBet) => {
    console.log('addTrackedBet called with:', bet);
    
    // Always read fresh from localStorage to avoid stale state across tabs
    const stored = localStorage.getItem('trackedBets');
    let currentBets: TrackedBet[] = [];
    if (stored) {
      try {
        currentBets = JSON.parse(stored);
        console.log('Read from localStorage before add:', currentBets);
      } catch (e) {
        console.error('Failed to parse localStorage:', e);
      }
    }
    
    // Prevent duplicates
    if (currentBets.some(b => b.id === bet.id)) {
      console.log('Duplicate bet detected, not adding');
      return;
    }
    
    // Add new bet
    const newBets = [...currentBets, bet];
    console.log('New tracked bets to save:', newBets);
    
    // Update both localStorage and state
    localStorage.setItem('trackedBets', JSON.stringify(newBets));
    console.log('Saved to localStorage');
    setTrackedBets(newBets);
  };

  const removeTrackedBet = (id: string) => {
    // Always read fresh from localStorage
    const stored = localStorage.getItem('trackedBets');
    let currentBets: TrackedBet[] = [];
    if (stored) {
      try {
        currentBets = JSON.parse(stored);
      } catch (e) {
        console.error('Failed to parse localStorage:', e);
      }
    }
    
    const newBets = currentBets.filter(bet => bet.id !== id);
    console.log('Removed bet:', id, 'Remaining:', newBets);
    
    // Update both localStorage and state
    localStorage.setItem('trackedBets', JSON.stringify(newBets));
    setTrackedBets(newBets);
  };

  const clearAllTrackedBets = () => {
    setTrackedBets([]);
    // Update localStorage immediately
    if (isHydrated) {
      localStorage.setItem('trackedBets', JSON.stringify([]));
      console.log('Cleared all tracked bets from localStorage');
    }
  };

  const refreshTrackedBets = () => {
    console.log('Refreshing tracked bets from localStorage');
    const stored = localStorage.getItem('trackedBets');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        console.log('Loaded from localStorage:', parsed);
        setTrackedBets(parsed);
      } catch (e) {
        console.error('Failed to parse stored tracked bets:', e);
      }
    } else {
      console.log('No tracked bets in localStorage');
      setTrackedBets([]);
    }
  };

  return (
    <TrackedBetsContext.Provider value={{ trackedBets, addTrackedBet, removeTrackedBet, clearAllTrackedBets, refreshTrackedBets }}>
      {children}
    </TrackedBetsContext.Provider>
  );
}

export function useTrackedBets() {
  const context = useContext(TrackedBetsContext);
  if (context === undefined) {
    throw new Error('useTrackedBets must be used within a TrackedBetsProvider');
  }
  return context;
}
