'use client';

import { useEffect, useState } from 'react';

/**
 * Chart line steppers emit `transient-line` for live bookmaker chips without waiting for blur.
 * Parents skip setState while the line input is focused (keeps the chart smooth); selectors
 * subscribe here so odds update immediately on the chip alone.
 */
export function useLiveTransientLine(currentLineValue?: number | null): number | null {
  const [liveLine, setLiveLine] = useState<number | null>(null);

  useEffect(() => {
    const onTransient = (e: Event) => {
      const value = (e as CustomEvent<{ value: number }>).detail?.value;
      if (value == null || !Number.isFinite(value)) return;
      setLiveLine(value);
    };
    window.addEventListener('transient-line', onTransient);
    return () => window.removeEventListener('transient-line', onTransient);
  }, []);

  useEffect(() => {
    if (liveLine == null) return;
    if (
      currentLineValue != null &&
      Number.isFinite(currentLineValue) &&
      Math.abs(currentLineValue - liveLine) < 0.01
    ) {
      setLiveLine(null);
    }
  }, [currentLineValue, liveLine]);

  return liveLine;
}
