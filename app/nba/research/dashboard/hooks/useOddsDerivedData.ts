'use client';

import { useMemo } from 'react';
import { LINE_MOVEMENT_ENABLED } from '../constants';
import { filterByMarket, deriveOpeningCurrentMovement, OddsSnapshot } from '@/lib/odds';
import { processIntradayMovementsFinal } from '../utils/intradayMovementsFinalUtils';
import { calculateSelectedBookmakerData } from '../utils/bookmakerUtils';
import { calculatePrimaryMarketLine } from '../utils/primaryMarketLineUtils';
import { calculateImpliedOdds } from '../utils/calculatedImpliedOddsUtils';
import { BookRow } from '../types';

export interface LineMovementData {
  openingLine: { line: number; bookmaker: string; timestamp: string; overOdds?: number; underOdds?: number } | null;
  currentLine: { line: number; bookmaker: string; timestamp: string; overOdds?: number; underOdds?: number } | null;
  impliedOdds: number | null;
  overImpliedProb?: number | null;
  underImpliedProb?: number | null;
  isOverFavorable: boolean | null;
  lineMovement: Array<{ bookmaker: string; line: number; change: number; timestamp: string }>;
}

export interface UseOddsDerivedDataParams {
  mergedLineMovementData: LineMovementData | null;
  oddsSnapshots: OddsSnapshot[];
  marketKey: string;
  intradayMovements: any;
  realOddsData: BookRow[];
  selectedStat: string;
}

export function useOddsDerivedData({
  mergedLineMovementData,
  oddsSnapshots,
  marketKey,
  intradayMovements,
  realOddsData,
  selectedStat,
}: UseOddsDerivedDataParams) {
  const derivedOdds = useMemo(() => {
    if (LINE_MOVEMENT_ENABLED && mergedLineMovementData) {
      return {
        openingLine: mergedLineMovementData.openingLine?.line ?? null,
        currentLine: mergedLineMovementData.currentLine?.line ?? null,
      };
    }
    // Fallback to old snapshot logic for team mode
    const filtered = filterByMarket(oddsSnapshots, marketKey);
    return deriveOpeningCurrentMovement(filtered);
  }, [mergedLineMovementData, oddsSnapshots, marketKey]);

  // Update intraday movements to use merged data for accurate current line
  const intradayMovementsFinal = useMemo(() => {
    return processIntradayMovementsFinal({
      mergedLineMovementData,
      realOddsData,
      selectedStat,
      intradayMovements,
      LINE_MOVEMENT_ENABLED,
    });
  }, [mergedLineMovementData, intradayMovements, realOddsData, selectedStat]);

  // Extract FanDuel's line and odds for selected stat
  const selectedBookmakerData = useMemo(() => {
    return calculateSelectedBookmakerData(realOddsData, selectedStat);
  }, [realOddsData, selectedStat]);

  const selectedBookmakerLine = selectedBookmakerData.line;
  const selectedBookmakerName = selectedBookmakerData.name;

  // Calculate primary line from real bookmakers (not alt lines) - used for prediction
  // Uses the most common line value (consensus), not the average
  const primaryMarketLine = useMemo(() => {
    return calculatePrimaryMarketLine({
      realOddsData,
      selectedStat,
    });
  }, [realOddsData, selectedStat]);

  const calculatedImpliedOdds = useMemo(() => {
    return calculateImpliedOdds({
      realOddsData,
      selectedStat,
    });
  }, [realOddsData, selectedStat]);

  return {
    derivedOdds,
    intradayMovementsFinal,
    selectedBookmakerData,
    selectedBookmakerLine,
    selectedBookmakerName,
    primaryMarketLine,
    calculatedImpliedOdds,
  };
}

