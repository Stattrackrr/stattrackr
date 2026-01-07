'use client';

import { useEffect, useRef } from 'react';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { LINE_MOVEMENT_ENABLED } from '../constants';

export interface LineMovementData {
  openingLine: { line: number; bookmaker: string; timestamp: string; overOdds?: number; underOdds?: number } | null;
  currentLine: { line: number; bookmaker: string; timestamp: string; overOdds?: number; underOdds?: number } | null;
  impliedOdds: number | null;
  overImpliedProb?: number | null;
  underImpliedProb?: number | null;
  isOverFavorable: boolean | null;
  lineMovement: Array<{ bookmaker: string; line: number; change: number; timestamp: string }>;
}

export interface UseLineMovementParams {
  propsMode: 'player' | 'team';
  selectedPlayer: { id: number; full?: string; firstName?: string; lastName?: string } | null;
  selectedTeam: string;
  opponentTeam: string;
  selectedStat: string;
  todaysGames: any[];
  setLineMovementData: (data: LineMovementData | null) => void;
  setLineMovementLoading: (loading: boolean) => void;
}

export function useLineMovement({
  propsMode,
  selectedPlayer,
  selectedTeam,
  opponentTeam,
  selectedStat,
  todaysGames,
  setLineMovementData,
  setLineMovementLoading,
}: UseLineMovementParams) {
  const lastLineMovementRequestRef = useRef<{ key: string; fetchedAt: number } | null>(null);
  const lineMovementInFlightRef = useRef(false);

  useEffect(() => {
    if (!LINE_MOVEMENT_ENABLED) {
      setLineMovementLoading(false);
      setLineMovementData(null);
      return;
    }
    const fetchLineMovement = async () => {
      console.log('📊 Line Movement Fetch Check:', { propsMode, selectedPlayer: selectedPlayer?.full, selectedTeam, opponentTeam, selectedStat });
      
      // Only fetch for player mode
      if (propsMode !== 'player' || !selectedPlayer || !selectedTeam || !opponentTeam || opponentTeam === '' || opponentTeam === 'N/A') {
        console.log('⏭️ Skipping line movement fetch - missing requirements');
        setLineMovementData(null);
        setLineMovementLoading(false);
        return;
      }
      
      const playerName = selectedPlayer.full || `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim();
      
      // Get the game date from todaysGames if available
      const teamA = normalizeAbbr(selectedTeam);
      const teamB = normalizeAbbr(opponentTeam);
      const game = todaysGames.find((g: any) => {
        const home = normalizeAbbr(g?.home_team?.abbreviation || '');
        const away = normalizeAbbr(g?.visitor_team?.abbreviation || '');
        return (home === teamA && away === teamB) || (home === teamB && away === teamA);
      });
      
      // Extract game date or use today's date
      const gameDate = game?.date ? new Date(game.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      
      const requestKey = JSON.stringify({
        mode: propsMode,
        playerId: selectedPlayer.id,
        team: selectedTeam,
        opponent: opponentTeam,
        stat: selectedStat,
        gameDate,
      });

      const nowTs = Date.now();
      const TTL_MS = 5 * 60 * 1000; // 5 minutes
      if (
        lastLineMovementRequestRef.current &&
        lastLineMovementRequestRef.current.key === requestKey &&
        nowTs - lastLineMovementRequestRef.current.fetchedAt < TTL_MS
      ) {
        console.log('⏭️ Skipping duplicate line movement fetch', requestKey);
        return;
      }

      if (lineMovementInFlightRef.current) {
        console.log('⏳ Line movement fetch already in-flight, skipping new request');
        return;
      }

      lastLineMovementRequestRef.current = { key: requestKey, fetchedAt: nowTs };
      lineMovementInFlightRef.current = true;

      console.log(`🎯 Fetching line movement for: ${playerName} (date: ${gameDate}, stat: ${selectedStat})`);
      
      setLineMovementLoading(true);
      try {
        const url = `/api/odds/line-movement?player=${encodeURIComponent(playerName)}&stat=${encodeURIComponent(selectedStat)}&date=${gameDate}`;
        console.log('🔗 Fetching:', url);
        const response = await fetch(url);
        if (!response.ok) {
          console.warn('❌ Line movement fetch failed:', response.status);
          setLineMovementData(null);
          return;
        }
        const result = await response.json();
        console.log('✅ Line movement data received:', result);
        // Extract the nested data object from the API response
        setLineMovementData(result.hasOdds ? (result.data as LineMovementData) : null);
      } catch (error) {
        console.error('Error fetching line movement:', error);
        setLineMovementData(null);
        lastLineMovementRequestRef.current = null;
      } finally {
        setLineMovementLoading(false);
        lineMovementInFlightRef.current = false;
        if (lastLineMovementRequestRef.current) {
          lastLineMovementRequestRef.current = {
            key: requestKey,
            fetchedAt: Date.now(),
          };
        }
      }
    };
    
    fetchLineMovement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsMode, selectedPlayer?.id, selectedPlayer?.full, selectedTeam, opponentTeam, selectedStat, todaysGames]);
}

