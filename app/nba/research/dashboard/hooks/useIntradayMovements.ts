'use client';

import { useMemo } from 'react';
import { processIntradayMovements } from '../utils/intradayMovementsUtils';
import { MovementRow } from '../types';

export interface UseIntradayMovementsParams {
  lineMovementData: any;
  oddsSnapshots: any[];
  marketKey: string;
}

export function useIntradayMovements({
  lineMovementData,
  oddsSnapshots,
  marketKey,
}: UseIntradayMovementsParams) {
  // Build intraday movement rows from line movement data
  const intradayMovements = useMemo(() => {
    return processIntradayMovements(lineMovementData, oddsSnapshots, marketKey);
  }, [lineMovementData, oddsSnapshots, marketKey]);

  return {
    intradayMovements,
  };
}

