/**
 * Check a specific user's trial status
 * Usage: node scripts/check-user-trial-status.js <email>
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

const email = process.argv[2] || 'duartepunting@gmail.com';

async function checkUserTrialStatus() {
  console.log(`🔍 Checking trial status for: ${email}\n`);

  // Get user profile
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, email, has_used_trial, trial_used_at, stripe_customer_id, stripe_subscription_id')
    .eq('email', email)
    .single();

  if (error) {
    console.error('❌ Error fetching profile:', error);
    return;
  }

  if (!profile) {
    console.error('❌ User not found');
    return;
  }

  console.log('Database Status:');
  console.log(`  Email: ${profile.email}`);
  console.log(`  Has Used Trial: ${profile.has_used_trial ? '✅ YES' : '❌ NO'}`);
  console.log(`  Trial Used At: ${profile.trial_used_at || 'N/A'}`);
  console.log(`  Stripe Customer ID: ${profile.stripe_customer_id || 'None'}`);
  console.log(`  Stripe Subscription ID: ${profile.stripe_subscription_id || 'None'}`);
  console.log('');

  // Check Stripe
  if (profile.stripe_customer_id) {
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        status: 'all',
        limit: 100,
      });

      console.log('Stripe Status:');
      console.log(`  Total Subscriptions: ${subscriptions.data.length}`);
      
      const hasTrialInHistory = subscriptions.data.some(sub => 
        sub.trial_start !== null && sub.trial_end !== null
      );
      
      console.log(`  Has Trial in History: ${hasTrialInHistory ? '✅ YES' : '❌ NO'}`);
      
      if (subscriptions.data.length > 0) {
        console.log('\n  Recent Subscriptions:');
        subscriptions.data.slice(0, 3).forEach((sub, i) => {
          const trialStart = sub.trial_start ? new Date(sub.trial_start * 1000).toLocaleDateString() : 'N/A';
          const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toLocaleDateString() : 'N/A';
          console.log(`    ${i + 1}. Status: ${sub.status}, Trial: ${sub.trial_start ? `${trialStart} - ${trialEnd}` : 'None'}`);
        });
      }
    } catch (error) {
      console.error('❌ Error checking Stripe:', error.message);
    }
  }

  // Simulate checkout logic
  console.log('\nCheckout Logic Simulation:');
  let hasUsedTrial = profile.has_used_trial || false;
  console.log(`  1. Initial check (DB): ${hasUsedTrial ? '❌ NO TRIAL' : '✅ TRIAL ALLOWED'}`);

  if (!hasUsedTrial && profile.stripe_customer_id) {
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        status: 'all',
        limit: 100,
      });

      const hasPreviousTrial = subscriptions.data.some(sub => 
        sub.trial_start !== null && sub.trial_end !== null
      );

      if (hasPreviousTrial) {
        hasUsedTrial = true;
        console.log(`  2. Stripe check found trial: ❌ NO TRIAL`);
      } else {
        console.log(`  2. Stripe check: ✅ TRIAL ALLOWED`);
      }
    } catch (error) {
      console.log(`  2. Stripe check error: ${error.message}`);
    }
  }

  console.log(`\n  Final Decision: ${hasUsedTrial ? '❌ NO TRIAL' : '✅ TRIAL ALLOWED'}`);
  
  if (!hasUsedTrial && profile.has_used_trial) {
    console.log('\n⚠️  WARNING: Database says trial used, but logic would allow trial!');
    console.log('  This suggests the checkout logic has a bug.');
  }
}

checkUserTrialStatus().catch(console.error);


