# Testing Free Trial Prevention Fix

This guide will help you test that users can no longer get multiple free trials.

## Prerequisites

1. **Run the database migration first:**
   - Go to your Supabase SQL Editor
   - Copy and paste the contents of `migrations/add_trial_tracking.sql`
   - Execute it

## Test Scenarios

### Test 1: New User Gets Trial ✅

1. Create a new test account (or use an account that has never subscribed)
2. Go to `/pricing` page
3. Click "Start Free Trial" on any plan
4. Complete the Stripe checkout
5. **Expected:** User should get a 7-day free trial
6. **Verify in database:**
   ```sql
   SELECT email, has_used_trial, trial_used_at 
   FROM profiles 
   WHERE email = 'test@example.com';
   ```
   - `has_used_trial` should be `true`
   - `trial_used_at` should have a timestamp

### Test 2: User Who Used Trial Doesn't Get Another ❌

1. Use the same account from Test 1 (or any account that has `has_used_trial = true`)
2. Cancel the subscription (if active) via Stripe dashboard or customer portal
3. Go to `/pricing` page again
4. Click "Start Free Trial" on any plan
5. Complete the Stripe checkout
6. **Expected:** User should NOT get a 7-day free trial - they should be charged immediately
7. **Verify in Stripe:**
   - Check the subscription in Stripe dashboard
   - It should NOT have a trial period
   - The subscription should start charging immediately

### Test 3: Check API Response

You can also test the API directly to see if it correctly identifies trial status:

```bash
# Get your auth token first (from browser dev tools after logging in)
# Then test the checkout endpoint
curl -X POST http://localhost:3000/api/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{
    "priceId": "price_1SPPbkF0aO6V0EHjOXoydTwT",
    "billingCycle": "monthly"
  }'
```

Check the response - if `has_trial: "false"` in metadata, the user won't get a trial.

## Manual Database Checks

### Check if migration ran:
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'profiles' 
  AND column_name IN ('has_used_trial', 'trial_used_at');
```

Both columns should exist.

### Check users who have used trials:
```sql
SELECT 
  email, 
  has_used_trial, 
  trial_used_at,
  stripe_customer_id,
  stripe_subscription_id
FROM profiles 
WHERE has_used_trial = true;
```

### Check users who haven't used trials:
```sql
SELECT 
  email, 
  has_used_trial, 
  stripe_customer_id
FROM profiles 
WHERE has_used_trial = false OR has_used_trial IS NULL;
```

## Testing with Stripe Test Mode

1. Make sure you're using Stripe test mode keys
2. Use test card: `4242 4242 4242 4242`
3. Any future expiry date and CVC
4. Check Stripe dashboard to verify:
   - First subscription: Has trial period
   - Second subscription (after canceling first): No trial period

## Expected Behavior Summary

| User Status | Trial Allowed? | Notes |
|------------|----------------|-------|
| New user, never subscribed | ✅ Yes | Gets 7-day trial |
| User with `has_used_trial = true` | ❌ No | Charged immediately |
| User with previous Stripe subscription (trial) | ❌ No | Detected from Stripe history |
| User who canceled but used trial | ❌ No | Trial already marked as used |

## Troubleshooting

### Issue: User still gets trial even after using one

**Check:**
1. Is `has_used_trial` set to `true` in database?
2. Does the Stripe customer have a subscription history with a trial?
3. Check server logs for the checkout API call - it should log whether trial is allowed

**Fix:**
- Manually update the database:
  ```sql
  UPDATE profiles 
  SET has_used_trial = true, 
      trial_used_at = NOW() 
  WHERE email = 'user@example.com';
  ```

### Issue: New user doesn't get trial

**Check:**
1. Is `has_used_trial` `false` or `NULL` in database?
2. Does the Stripe customer have any previous subscriptions?
3. Check the checkout API response - look for `has_trial: "true"` in metadata

## Verification Checklist

- [ ] Migration has been run
- [ ] New users get 7-day trial
- [ ] Users who used trial don't get another
- [ ] Database `has_used_trial` field is updated correctly
- [ ] Stripe subscription history is checked as backup
- [ ] Webhook marks trial as used when subscription created

