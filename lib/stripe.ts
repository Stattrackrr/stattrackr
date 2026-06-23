import Stripe from 'stripe';

// Lazy initialization - only on server
let stripeInstance: Stripe | null = null;

export const getStripe = () => {
  if (typeof window !== 'undefined') {
    throw new Error('Stripe should only be used on the server side');
  }
  
  if (!stripeInstance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }
    
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-10-29.clover',
      typescript: true,
    });
  }
  
  return stripeInstance;
};

// For backwards compatibility
export const stripe = new Proxy({} as Stripe, {
  get: (target, prop) => {
    const stripeInstance = getStripe();
    return (stripeInstance as any)[prop];
  }
});

// Price IDs for your subscription tiers (from Stripe Dashboard)
// These can be imported on client side
export const PRICE_IDS = {
  pro: {
    monthly: 'price_1TlWpPF0aO6V0EHjEZcvzlEE',        // $20.00 AUD/month
    semiannual: 'price_1TlWpoF0aO6V0EHjO81pOBgV',  // $100.00 AUD (6 months)
    annual: 'price_1TlWq3F0aO6V0EHji75auKmP',          // $180.00 AUD/year
  },
} as const;

export type PlanTier = 'free' | 'pro';
export type BillingCycle = keyof typeof PRICE_IDS.pro;
