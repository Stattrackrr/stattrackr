// Player-related utility functions

// Get current NBA season year
export function currentNbaSeason(): number {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed: 0=Jan, 9=Oct, 11=Dec
  const day = now.getDate();
  
  // NBA season starts around October 15th and runs through June
  // Season year is the year it starts (e.g., 2024-25 season = 2024)
  
  // If we're in October (month 9) and before the 15th, use previous year
  if (month === 9 && day < 15) {
    return now.getFullYear() - 1;
  }
  
  // If we're in October 15+ or November/December, use current year
  if (month >= 9) {
    return now.getFullYear();
  }
  
  // If we're in January-September, use previous year
  return now.getFullYear() - 1;
}

// Helper function for parsing minutes
export function parseMinutes(minStr: string): number {
  if (!minStr || minStr === '0:00') return 0;
  const [m, s] = minStr.split(':').map(Number);
  return (Number.isFinite(m) ? m : 0) + ((Number.isFinite(s) ? s : 0) / 60);
}

