/**
 * Test script to verify free trial prevention logic
 * 
 * This script tests:
 * 1. New user gets trial
 * 2. User who has used trial doesn't get another one
 * 3. Database and Stripe checks work correctly
 * 
 * Usage:
 * 1. Make sure you've run the migration: migrations/add_trial_tracking.sql
 * 2. Set up your environment variables
 * 3. Run: npx tsx scripts/test-trial-check.ts
 */

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Load environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!supabaseUrl || !supabaseServiceKey || !stripeSecretKey) {
  console.error('❌ Missing required environment variables');
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-12-18.acacia' });

async function testTrialCheck() {
  console.log('🧪 Testing Free Trial Prevention Logic\n');

  // Test 1: Check if migration was run
  console.log('Test 1: Checking if migration was run...');
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('has_used_trial, trial_used_at')
      .limit(1);
    
    if (error) {
      if (error.message.includes('column') && error.message.includes('has_used_trial')) {
        console.error('❌ Migration not run! Please run migrations/add_trial_tracking.sql first');
        return;
      }
      throw error;
    }
    console.log('✅ Migration appears to be run (has_used_trial column exists)\n');
  } catch (error: any) {
    console.error('❌ Error checking migration:', error.message);
    return;
  }

  // Test 2: Find a test user (or create instructions)
  console.log('Test 2: Checking user profiles...');
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, email, has_used_trial, trial_used_at, stripe_customer_id, stripe_subscription_id')
    .limit(10);

  if (profilesError) {
    console.error('❌ Error fetching profiles:', profilesError);
    return;
  }

  if (!profiles || profiles.length === 0) {
    console.log('⚠️  No profiles found. Create a test user first.');
    return;
  }

  console.log(`\nFound ${profiles.length} user(s):\n`);
  profiles.forEach((profile: any, index: number) => {
    console.log(`User ${index + 1}:`);
    console.log(`  Email: ${profile.email || 'N/A'}`);
    console.log(`  Has Used Trial: ${profile.has_used_trial ? '✅ Yes' : '❌ No'}`);
    console.log(`  Trial Used At: ${profile.trial_used_at || 'N/A'}`);
    console.log(`  Stripe Customer ID: ${profile.stripe_customer_id || 'None'}`);
    console.log(`  Stripe Subscription ID: ${profile.stripe_subscription_id || 'None'}`);
    console.log('');
  });

  // Test 3: Check Stripe subscription history for users with Stripe customer IDs
  console.log('Test 3: Checking Stripe subscription history...\n');
  for (const profile of profiles) {
    if (!profile.stripe_customer_id) {
      continue;
    }

    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        status: 'all',
        limit: 100,
      });

      const hasTrialInHistory = subscriptions.data.some(sub => 
        sub.trial_start !== null && sub.trial_end !== null
      );

      console.log(`User: ${profile.email || profile.id}`);
      console.log(`  Stripe Customer: ${profile.stripe_customer_id}`);
      console.log(`  Total Subscriptions: ${subscriptions.data.length}`);
      console.log(`  Has Trial in History: ${hasTrialInHistory ? '✅ Yes' : '❌ No'}`);
      console.log(`  Database has_used_trial: ${profile.has_used_trial ? '✅ Yes' : '❌ No'}`);
      
      if (hasTrialInHistory && !profile.has_used_trial) {
        console.log(`  ⚠️  MISMATCH: Stripe shows trial but database doesn't!`);
        console.log(`     This will be fixed automatically on next checkout attempt.`);
      } else if (!hasTrialInHistory && profile.has_used_trial) {
        console.log(`  ⚠️  MISMATCH: Database shows trial used but Stripe doesn't!`);
      } else {
        console.log(`  ✅ Status matches between Stripe and database`);
      }
      console.log('');
    } catch (error: any) {
      console.error(`  ❌ Error checking Stripe for ${profile.email}:`, error.message);
    }
  }

  // Test 4: Simulate checkout logic
  console.log('Test 4: Simulating checkout logic...\n');
  const testProfile = profiles.find((p: any) => p.stripe_customer_id) || profiles[0];
  
  if (!testProfile) {
    console.log('⚠️  No user with Stripe customer ID found. Cannot test checkout logic.');
    return;
  }

  console.log(`Testing with user: ${testProfile.email || testProfile.id}`);
  
  let hasUsedTrial = testProfile.has_used_trial || false;
  console.log(`  Initial has_used_trial from DB: ${hasUsedTrial}`);

  if (!hasUsedTrial && testProfile.stripe_customer_id) {
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: testProfile.stripe_customer_id,
        status: 'all',
        limit: 100,
      });

      const hasPreviousTrial = subscriptions.data.some(sub => 
        sub.trial_start !== null && sub.trial_end !== null
      );

      console.log(`  Stripe subscription history check: ${hasPreviousTrial ? 'Found trial' : 'No trial found'}`);
      
      if (hasPreviousTrial) {
        hasUsedTrial = true;
        console.log(`  ✅ Would update database to mark trial as used`);
      }
    } catch (error: any) {
      console.error(`  ❌ Error checking Stripe:`, error.message);
    }
  }

  console.log(`\n  Final decision: ${hasUsedTrial ? '❌ NO TRIAL' : '✅ TRIAL ALLOWED'}`);
  console.log(`  This user ${hasUsedTrial ? 'would NOT' : 'WOULD'} get a 7-day free trial\n`);

  console.log('✅ Test complete!');
  console.log('\nNext steps:');
  console.log('1. If migration not run, run: migrations/add_trial_tracking.sql');
  console.log('2. Test actual checkout flow through the UI');
  console.log('3. Verify that users who have used trial don\'t get another one');
}

testTrialCheck().catch(console.error);

