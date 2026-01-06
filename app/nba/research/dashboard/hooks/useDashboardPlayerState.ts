'use client';

import { useState } from 'react';
import { NBAPlayer } from '@/lib/nbaPlayers';
import { BallDontLieStats, AdvancedStats, BdlSearchResult } from '../types';

export function useDashboardPlayerState() {
  const [selectedPlayer, setSelectedPlayer] = useState<NBAPlayer | null>(null);
  const [resolvedPlayerId, setResolvedPlayerId] = useState<string | null>(null);
  const [playerStats, setPlayerStats] = useState<BallDontLieStats[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [coreDataReady, setCoreDataReady] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Advanced stats state
  const [advancedStats, setAdvancedStats] = useState<AdvancedStats | null>(null);
  const [advancedStatsLoading, setAdvancedStatsLoading] = useState(false);
  const [advancedStatsError, setAdvancedStatsError] = useState<string | null>(null);
  const [advancedStatsPerGame, setAdvancedStatsPerGame] = useState<Record<number, { pace?: number; usage_percentage?: number }>>({});

  // DvP ranks state
  const [dvpRanksPerGame, setDvpRanksPerGame] = useState<Record<string, number | null>>({});

  // Shot distance stats state
  const [shotDistanceData, setShotDistanceData] = useState<any | null>(null);
  const [shotDistanceLoading, setShotDistanceLoading] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<BdlSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  return {
    // Player selection
    selectedPlayer,
    setSelectedPlayer,
    resolvedPlayerId,
    setResolvedPlayerId,
    playerStats,
    setPlayerStats,
    isLoading,
    setIsLoading,
    coreDataReady,
    setCoreDataReady,
    apiError,
    setApiError,
    // Advanced stats
    advancedStats,
    setAdvancedStats,
    advancedStatsLoading,
    setAdvancedStatsLoading,
    advancedStatsError,
    setAdvancedStatsError,
    advancedStatsPerGame,
    setAdvancedStatsPerGame,
    // DvP ranks
    dvpRanksPerGame,
    setDvpRanksPerGame,
    // Shot distance
    shotDistanceData,
    setShotDistanceData,
    shotDistanceLoading,
    setShotDistanceLoading,
    // Search
    searchQuery,
    setSearchQuery,
    showDropdown,
    setShowDropdown,
    searchBusy,
    setSearchBusy,
    searchResults,
    setSearchResults,
    searchError,
    setSearchError,
    isMobileSearchOpen,
    setIsMobileSearchOpen,
  };
}

