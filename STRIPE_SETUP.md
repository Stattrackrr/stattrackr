# Stripe Integration Setup Guide

## ✅ What's Been Done

### 1. Stripe Configuration
- ✅ Installed `@stripe/stripe-js` and `stripe` packages
- ✅ Created `lib/stripe.ts` with Stripe client and price IDs
- ✅ Added Stripe price IDs for Pro plan (monthly, semiannual, annual)
- ✅ Environment variables added to `.env.local`

### 2. API Routes
- ✅ Created `/api/checkout` - Creates Stripe Checkout sessions
- ✅ Created `/api/webhooks/stripe` - Handles Stripe webhook events

### 3. Database Schema
- ✅ Created migration file `migrations/add_stripe_columns.sql`
- Adds Stripe-related columns to profiles table:
  - `stripe_customer_id`
  - `stripe_subscription_id`
  - `subscription_status`
  - `subscription_tier`
  - `subscription_billing_cycle`
  - `subscription_current_period_end`

### 4. Subscription Page
- ✅ Completely rewritten `/app/subscription/page.tsx`
- Shows billing cycle selection for new users
- Redirects to Stripe Checkout
- Shows subscription details for active subscribers

## 🚀 Next Steps

### 1. Run Database Migration
Go to your Supabase dashboard SQL Editor and run:
```sql
-- Copy and paste the contents of migrations/add_stripe_columns.sql
```

### 2. Update Environment Variables
Make sure your `.env.local` has your actual Stripe keys:
```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...  # We'll get this after webhook setup
```

### 3. Test Checkout Flow
1. Start your dev server: `npm run dev`
2. Go to `/subscription`
3. Select a billing cycle
4. Click "Continue to Checkout"
5. You should be redirected to Stripe Checkout

### 4. Set Up Webhooks (After Deploy or for Local Testing)

#### Option A: Local Testing with Stripe CLI
```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# Copy the webhook signing secret that appears
```

#### Option B: Production Webhook
1. Deploy your app
2. Go to Stripe Dashboard → Developers → Webhooks
3. Click "Add endpoint"
4. URL: `https://yourdomain.com/api/webhooks/stripe`
5. Select these events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
6. Copy the webhook signing secret
7. Add to `.env.local`: `STRIPE_WEBHOOK_SECRET=whsec_...`

### 5. Test with Stripe Test Cards
Use these test cards in Stripe Checkout:
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Any future expiry date and CVC

## 📋 Webhook Flow

When a user completes checkout:
1. Stripe redirects to `/subscription?success=true`
2. Stripe sends webhook to `/api/webhooks/stripe`
3. Webhook handler updates profiles table with subscription data
4. User sees their active subscription on `/subscription` page

## 🔐 Security Notes

- Never store actual card details in your database
- All payment data handled by Stripe
- Webhook signatures verified for security
- User profiles use RLS (Row Level Security)

## 🛠️ Troubleshooting

### Checkout not working?
- Check browser console for errors
- Verify API keys are correct
- Ensure profiles table exists with Stripe columns

### Webhook not firing?
- Check Stripe Dashboard → Developers → Webhooks → Logs
- Verify webhook URL is accessible
- Check webhook secret matches your .env

### Subscription not showing?
- Manually test webhook events in Stripe Dashboard
- Check profiles table has data after checkout
- Verify user is authenticated

## 📞 Support
For Stripe-specific issues, check:
- [Stripe Documentation](https://stripe.com/docs)
- [Stripe Testing](https://stripe.com/docs/testing)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
