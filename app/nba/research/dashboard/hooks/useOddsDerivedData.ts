'use client';

import { useMemo } from 'react';
import { filterByMarket, deriveOpeningCurrentMovement, OddsSnapshot } from '@/lib/odds';
import { calculateSelectedBookmakerData } from '../utils/bookmakerUtils';
import { calculatePrimaryMarketLine } from '../utils/primaryMarketLineUtils';
import { calculateImpliedOdds } from '../utils/calculatedImpliedOddsUtils';
import { BookRow } from '../types';

export interface UseOddsDerivedDataParams {
  oddsSnapshots: OddsSnapshot[];
  marketKey: string;
  intradayMovements: any;
  realOddsData: BookRow[];
  selectedStat: string;
}

export function useOddsDerivedData({
  oddsSnapshots,
  marketKey,
  intradayMovements,
  realOddsData,
  selectedStat,
}: UseOddsDerivedDataParams) {
  const derivedOdds = useMemo(() => {
    // Derive opening/current directly from odds snapshots.
    const filtered = filterByMarket(oddsSnapshots, marketKey);
    return deriveOpeningCurrentMovement(filtered);
  }, [oddsSnapshots, marketKey]);

  // Keep intraday movements as already-processed rows.
  const intradayMovementsFinal = useMemo(() => {
    return intradayMovements;
  }, [intradayMovements]);

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

