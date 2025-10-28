// Currency symbol mapping
export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  AUD: '$',
  GBP: '£',
  EUR: '€',
};

// Get currency symbol
export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] || '$';
}

// Convert decimal odds to American odds
export function decimalToAmerican(decimal: number): string {
  if (decimal >= 2.0) {
    return `+${Math.round((decimal - 1) * 100)}`;
  } else {
    return `-${Math.round(100 / (decimal - 1))}`;
  }
}

// Convert American odds to decimal odds
export function americanToDecimal(american: number): number {
  if (american > 0) {
    return (american / 100) + 1;
  } else {
    return (100 / Math.abs(american)) + 1;
  }
}

// Format odds based on user preference
export function formatOdds(decimal: number, format: 'american' | 'decimal'): string {
  if (format === 'american') {
    return decimalToAmerican(decimal);
  }
  return decimal.toFixed(2);
}
