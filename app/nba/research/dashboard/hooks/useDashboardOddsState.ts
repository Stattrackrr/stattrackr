'use client';

import { useState } from 'react';
import { OddsSnapshot, BookRow } from '@/lib/odds';

export interface LineMovementData {
  openingLine: { line: number; bookmaker: string; timestamp: string; overOdds?: number; underOdds?: number } | null;
  currentLine: { line: number; bookmaker: string; timestamp: string; overOdds?: number; underOdds?: number } | null;
  impliedOdds: number | null;
  overImpliedProb?: number | null;
  underImpliedProb?: number | null;
  isOverFavorable: boolean | null;
  lineMovement: Array<{ bookmaker: string; line: number; change: number; timestamp: string }>;
}

export function useDashboardOddsState() {
  // Betting lines per stat (independent) - will be populated by odds API
  const [bettingLines, setBettingLines] = useState<Record<string, number>>({});

  // Independent bookmaker lines (not linked to the chart betting line)
  const [bookOpeningLine, setBookOpeningLine] = useState<number | null>(null);
  const [bookCurrentLine, setBookCurrentLine] = useState<number | null>(null);

  // Odds API placeholders (no fetch yet)
  const [oddsSnapshots, setOddsSnapshots] = useState<OddsSnapshot[]>([]);
  const marketKey = 'player_points';
  
  // Line movement data from API
  const [lineMovementData, setLineMovementData] = useState<LineMovementData | null>(null);
  const [lineMovementLoading, setLineMovementLoading] = useState(false);

  // Odds display format
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>('american');

  // Real odds data state
  const [realOddsData, setRealOddsData] = useState<BookRow[]>([]);
  const [oddsLoading, setOddsLoading] = useState(false);
  const [oddsError, setOddsError] = useState<string | null>(null);

  return {
    // Betting lines
    bettingLines,
    setBettingLines,
    bookOpeningLine,
    setBookOpeningLine,
    bookCurrentLine,
    setBookCurrentLine,
    // Odds snapshots
    oddsSnapshots,
    setOddsSnapshots,
    marketKey,
    // Line movement
    lineMovementData,
    setLineMovementData,
    lineMovementLoading,
    setLineMovementLoading,
    // Odds format
    oddsFormat,
    setOddsFormat,
    // Real odds
    realOddsData,
    setRealOddsData,
    oddsLoading,
    setOddsLoading,
    oddsError,
    setOddsError,
  };
}

