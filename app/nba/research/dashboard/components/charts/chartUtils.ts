// Chart utility functions

export const updateBettingLinePosition = (yAxisConfig: any, bettingLine: number) => {
  const doUpdate = (el: HTMLElement) => {
    if (!yAxisConfig?.domain) return;

    const [minY, maxY] = yAxisConfig.domain;

    // Mobile-only: fit overlay to actual bar bounds for exact alignment
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      const container = document.getElementById('betting-line-container') as HTMLElement | null;
      const parent = container?.parentElement as HTMLElement | null;
      const bars = Array.from(document.querySelectorAll('[data-bar-index]')) as HTMLElement[];
      if (container && parent && bars.length) {
        const parentRect = parent.getBoundingClientRect();
        let minLeft = Infinity;
        let maxRight = -Infinity;

        for (const b of bars) {
          const r = b.getBoundingClientRect();
          minLeft = Math.min(minLeft, r.left - parentRect.left);
          maxRight = Math.max(maxRight, r.right - parentRect.left);
        }

        if (Number.isFinite(minLeft)) container.style.left = `${Math.max(0, minLeft)}px`;
        if (Number.isFinite(maxRight)) container.style.right = `${Math.max(0, parentRect.width - maxRight)}px`;
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




