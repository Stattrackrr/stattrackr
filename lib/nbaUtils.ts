/**
 * NBA utility functions
 * Centralized utilities for NBA-specific logic
 */

/**
 * Get the current NBA season year
 * NBA season starts around October 15th
 * If we're in October 15+ or any month after, use current year
 * Otherwise use previous year
 */
export function currentNbaSeason(): number {
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const day = now.getDate();
  
  // NBA season starts around October 15th (month 9 is October in 0-based indexing)
  if (month === 9 && day >= 15) {
    // October 15th or later - new season starting
    return now.getFullYear();
  }
  
  // November through September (next year) - use current or previous year
  return month >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * Parse minutes string (MM:SS) to decimal minutes
 */
export function parseMinutes(minStr: string): number {
  if (!minStr || minStr === '0:00') return 0;
  const parts = minStr.split(':');
  const minutes = Number.isFinite(Number(parts[0])) ? Number(parts[0]) : 0;
  const seconds = parts[1] && Number.isFinite(Number(parts[1])) ? Number(parts[1]) : 0;
  return minutes + (seconds / 60);
}

/**
 * Format decimal minutes to MM:SS string
 */
export function formatMinutes(decimalMinutes: number): string {
  const minutes = Math.floor(decimalMinutes);
  const seconds = Math.round((decimalMinutes - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Check if a date is in the current NBA season
 */
export function isCurrentSeason(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  const gameMonth = d.getMonth();
  const gameYear = d.getFullYear();
  const currentSeason = currentNbaSeason();
  
  // Games from Oct-Dec belong to that year's season
  // Games from Jan-Sep belong to previous year's season
  const gameSeason = gameMonth >= 9 ? gameYear : gameYear - 1;
  
  return gameSeason === currentSeason;
}

/**
 * Get season year for a specific date
 */
export function getSeasonForDate(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = d.getMonth();
  const year = d.getFullYear();
  
  // Oct-Dec belong to that year's season
  // Jan-Sep belong to previous year's season
  return month >= 9 ? year : year - 1;
}

/**
 * Format season as string (e.g., "2024-25")
 */
export function formatSeason(seasonYear: number): string {
  const nextYear = (seasonYear + 1).toString().slice(-2);
  return `${seasonYear}-${nextYear}`;
}
