import { useEffect } from 'react';

export interface UseOddsFormatParams {
  setOddsFormat: (format: 'american' | 'decimal') => void;
}

/**
 * Custom hook to load odds format from localStorage
 */
export function useOddsFormat({
  setOddsFormat,
}: UseOddsFormatParams) {
  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('oddsFormat') : null;
      if (saved === 'decimal' || saved === 'american') setOddsFormat(saved as any);
    } catch {}
  }, [setOddsFormat]);
}


