// Currency symbol mapping
export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  AUD: '$',
  GBP: '£',
  EUR: '€',
};

// Exchange rates (base: USD)
// These should ideally be fetched from an API, but using static rates for now
export const EXCHANGE_RATES: Record<string, number> = {
  USD: 1.0,
  AUD: 1.52,  // 1 USD = 1.52 AUD
  GBP: 0.79,  // 1 USD = 0.79 GBP
  EUR: 0.92,  // 1 USD = 0.92 EUR
};

// Convert currency
export function convertCurrency(amount: number, fromCurrency: string, toCurrency: string): number {
  if (fromCurrency === toCurrency) return amount;
  
  // Convert to USD first (if not already USD)
  const amountInUSD = amount / (EXCHANGE_RATES[fromCurrency] || 1);
  
  // Convert from USD to target currency
  const convertedAmount = amountInUSD * (EXCHANGE_RATES[toCurrency] || 1);
  
  return convertedAmount;
}

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
