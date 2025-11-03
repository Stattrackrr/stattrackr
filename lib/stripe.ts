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
    monthly: 'price_1SPPbkF0aO6V0EHjOXoydTwT',        // $9.99/month
    semiannual: 'price_1SPPdVF0aO6V0EHj3DM4hFqS',  // $49.99 (6 months)
    annual: 'price_1SPPdvF0aO6V0EHjJAj8l0nO',          // $89.99/year
  },
} as const;

export type PlanTier = 'free' | 'pro';
export type BillingCycle = keyof typeof PRICE_IDS.pro;
