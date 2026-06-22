import { useEffect } from 'react';
import { readOddsFormatPreference, type OddsDisplayFormat } from '@/lib/currencyUtils';

export interface UseOddsFormatParams {
  setOddsFormat: (format: OddsDisplayFormat) => void;
}

/** Hydrate odds format from localStorage; defaults to decimal when unset. */
export function useOddsFormat({
  setOddsFormat,
}: UseOddsFormatParams) {
  useEffect(() => {
    setOddsFormat(readOddsFormatPreference());
  }, [setOddsFormat]);
}


