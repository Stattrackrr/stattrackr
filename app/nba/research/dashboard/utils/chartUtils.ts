// Chart utility functions
export function updateBettingLinePosition(line: number, yAxisConfig: { domain: [number, number]; ticks: number[] }) {
  const container = document.getElementById('betting-line-container');
  const lineEl = document.getElementById('betting-line-fast');
  if (!container || !lineEl) return;

  const minY = yAxisConfig.domain[0];
  const maxY = yAxisConfig.domain[1];
  const clampedLine = Math.max(minY, Math.min(line, maxY));

  const height = container.offsetHeight;
  const range = maxY - minY;
  const percent = range > 0 ? ((clampedLine - minY) / range) : 0.5;
  const bottom = percent * height;

  lineEl.style.bottom = `${bottom}px`;
}

// Unified tooltip style so bars and pie use the same hover look
export function getUnifiedTooltipStyle(isDarkMode: boolean) {
  return {
    backgroundColor: isDarkMode ? '#4b5563' : '#9ca3af', // match chart hover bg - grey in light mode
    color: isDarkMode ? '#FFFFFF' : '#000000', // white text in dark mode, black text in light mode
    border: '1px solid #9ca3af',
    borderRadius: '8px',
    padding: '12px',
    fontSize: '14px',
    fontWeight: '500',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
  };
}
