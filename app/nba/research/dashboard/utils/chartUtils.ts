import { CHART_CONFIG } from '../constants';

// Direct DOM updater for betting line position (no React re-renders)
export const updateBettingLinePosition = (yAxisConfig: any, bettingLine: number, hasSecondAxis?: boolean) => {
  const doUpdate = (el: HTMLElement) => {
    if (!yAxisConfig?.domain) return;

    const [minY, maxY] = yAxisConfig.domain;
    const range = maxY - minY;

    // Update container positioning
    const container = document.getElementById('betting-line-container') as HTMLElement | null;
    if (container && typeof window !== 'undefined') {
      // Mobile: always use full width (y-axis is hidden on mobile)
      if (window.innerWidth < 640) {
        // On mobile, use small margins for full width
        container.style.left = '2px';
        container.style.right = '2px';
      } else {
        // Desktop: adjust right margin based on second axis
        const defaultRightMargin = CHART_CONFIG.margin.right + 10;
        const secondAxisRightMargin = 70; // Extra space beyond chart's 10px margin to stop before y-axis numbers
        const rightMargin = hasSecondAxis ? secondAxisRightMargin : defaultRightMargin;
        container.style.right = `${rightMargin}px`;
      }
    }

    const clampedLine = Math.max(minY, Math.min(bettingLine, maxY));

    // Use actual bars range when available to prevent visual offset from axis padding
    let effectiveMin = minY;
    let effectiveMax = maxY;
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      if (typeof yAxisConfig.dataMin === 'number') {
        effectiveMin = Math.min(minY, yAxisConfig.dataMin);
      }
      if (typeof yAxisConfig.dataMax === 'number') {
        effectiveMax = Math.max(maxY, yAxisConfig.dataMax);
      }
    }
    const effectiveRange = effectiveMax - effectiveMin;
    let percentage = effectiveRange > 0 ? ((clampedLine - effectiveMin) / effectiveRange) * 100 : 50;

    // Clamp for safety
    if (!Number.isFinite(percentage)) percentage = 50;
    percentage = Math.max(0, Math.min(100, percentage));

    el.style.bottom = `${percentage}%`;
  };

  const el = document.getElementById('betting-line-fast');
  if (el) {
    doUpdate(el as HTMLElement);
  } else {
    // If the line isn't mounted yet (e.g., after timeframe/stat remount), try again shortly
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        const el2 = document.getElementById('betting-line-fast');
        if (el2) doUpdate(el2 as HTMLElement);
      });
      setTimeout(() => {
        const el3 = document.getElementById('betting-line-fast');
        if (el3) doUpdate(el3 as HTMLElement);
      }, 50);
    }
  }
};

