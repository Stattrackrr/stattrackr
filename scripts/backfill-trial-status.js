/**
 * Backfill script to update has_used_trial for existing users
 * who have trial subscriptions in Stripe but database doesn't reflect it
 * 
 * Usage: node scripts/backfill-trial-status.js
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

async function backfillTrialStatus() {
  console.log('🔄 Backfilling trial status for existing users...\n');

  // Get all users with Stripe customer IDs
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email, has_used_trial, stripe_customer_id')
    .not('stripe_customer_id', 'is', null);

  if (error) {
    console.error('❌ Error fetching profiles:', error);
    return;
  }

  if (!profiles || profiles.length === 0) {
    console.log('⚠️  No users with Stripe customer IDs found.');
    return;
  }

  console.log(`Found ${profiles.length} user(s) with Stripe customer IDs\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const profile of profiles) {
    try {
      // Skip if already marked as used
      if (profile.has_used_trial) {
        console.log(`⏭️  Skipping ${profile.email || profile.id} - already marked as used`);
        skipped++;
        continue;
      }

      // Check Stripe subscription history
      const subscriptions = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        status: 'all',
        limit: 100,
      });

      const hasTrialInHistory = subscriptions.data.some(sub => 
        sub.trial_start !== null && sub.trial_end !== null
      );

      if (hasTrialInHistory) {
        // Update database
        const { error: updateError } = await supabase
          .from('profiles')
          .update({
            has_used_trial: true,
            trial_used_at: new Date().toISOString(),
          })
          .eq('id', profile.id);

        if (updateError) {
          console.error(`❌ Error updating ${profile.email || profile.id}:`, updateError.message);
          errors++;
        } else {
          console.log(`✅ Updated ${profile.email || profile.id} - marked trial as used`);
          updated++;
        }
      } else {
        console.log(`⏭️  Skipping ${profile.email || profile.id} - no trial in Stripe history`);
        skipped++;
      }
    } catch (error) {
      console.error(`❌ Error processing ${profile.email || profile.id}:`, error.message);
      errors++;
    }
  }

  console.log('\n📊 Summary:');
  console.log(`  ✅ Updated: ${updated}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log(`  ❌ Errors: ${errors}`);
  console.log('\n✅ Backfill complete!');
}

backfillTrialStatus().catch(console.error);

