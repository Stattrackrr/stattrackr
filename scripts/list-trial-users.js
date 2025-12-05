/**
 * List all users who have used their 7-day free trial
 * These users cannot get another free trial
 * 
 * Usage: node scripts/list-trial-users.js
 */

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!supabaseUrl || !supabaseServiceKey || !stripeSecretKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-12-18.acacia' });

async function listTrialUsers() {
  console.log('📋 Users Who Have Used Their 7-Day Free Trial\n');
  console.log('These users CANNOT get another free trial:\n');
  console.log('='.repeat(80));

  // Get all users who have used their trial
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email, has_used_trial, trial_used_at, stripe_customer_id, stripe_subscription_id, subscription_status')
    .eq('has_used_trial', true)
    .order('trial_used_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching profiles:', error);
    return;
  }

  if (!profiles || profiles.length === 0) {
    console.log('No users found who have used their free trial.');
    return;
  }

  console.log(`\nTotal: ${profiles.length} user(s)\n`);

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    
    // Get Stripe subscription info if available
    let subscriptionInfo = '';
    if (profile.stripe_customer_id) {
      try {
        const subscriptions = await stripe.subscriptions.list({
          customer: profile.stripe_customer_id,
          status: 'all',
          limit: 1,
        });

        if (subscriptions.data.length > 0) {
          const sub = subscriptions.data[0];
          const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toLocaleDateString() : 'N/A';
          subscriptionInfo = ` | Trial ended: ${trialEnd}`;
        }
      } catch (error) {
        // Ignore Stripe errors
      }
    }

    const trialDate = profile.trial_used_at 
      ? new Date(profile.trial_used_at).toLocaleDateString()
      : 'Unknown';

    console.log(`${i + 1}. ${profile.email || profile.id}`);
    console.log(`   Trial Used: ${trialDate}${subscriptionInfo}`);
    console.log(`   Current Status: ${profile.subscription_status || 'N/A'}`);
    console.log(`   Stripe Customer: ${profile.stripe_customer_id || 'None'}`);
    console.log('');
  }

  console.log('='.repeat(80));
  console.log(`\n✅ Total: ${profiles.length} user(s) who have used their free trial`);
  console.log('⚠️  These users will NOT get another 7-day free trial if they subscribe again.\n');
}

listTrialUsers().catch(console.error);

