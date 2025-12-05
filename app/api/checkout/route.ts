export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStripe, PRICE_IDS } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    // Get the authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized - Missing token' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    const supabase = await createClient();
    
    // Get authenticated user from token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { priceId, billingCycle } = body;

    // Validate price ID
    const validPriceIds = Object.values(PRICE_IDS.pro);
    if (!validPriceIds.includes(priceId)) {
      return NextResponse.json(
        { error: 'Invalid price ID' },
        { status: 400 }
      );
    }

    // Get or create Stripe customer
    let customerId: string;
    const stripe = getStripe();
    
    // Check if user already has a Stripe customer ID and trial status
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_customer_id, has_used_trial')
      .eq('id', user.id)
      .single();
    
    if (profileError && profileError.code !== 'PGRST116') {
      // PGRST116 is "not found" which is OK, but log other errors
      console.error('[Checkout] Error fetching profile:', profileError);
    }

    if (profile?.stripe_customer_id) {
      customerId = profile.stripe_customer_id;
    } else {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
        },
      });
      
      customerId = customer.id;
      
      // Save customer ID to database
      await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    // Check if user has already used their free trial
    // IMPORTANT: Check database FIRST - this is the source of truth
    // If database says trial was used, don't allow another one regardless of Stripe customer ID
    let hasUsedTrial = profile?.has_used_trial === true;
    
    // If database says trial was used, skip Stripe check entirely
    if (hasUsedTrial) {
      console.log(`[Checkout] User ${user.id} (${user.email}) has already used trial per database - blocking another trial`);
    } else {
      // Also check Stripe customer's subscription history as a backup
      // This catches cases where the database might be out of sync
      // But also check ALL customers with this email to catch cases where user has multiple customer IDs
      if (customerId) {
        try {
          // First check the current customer's subscription history
          const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'all',
            limit: 100,
          });
          
          // Check if any previous subscription had a trial period
          let hasPreviousTrial = subscriptions.data.some(sub => {
            return sub.trial_start !== null && sub.trial_end !== null;
          });
          
          // Also check if there are other customers with the same email that have trial history
          // This catches cases where user created a new customer ID
          if (!hasPreviousTrial && user.email) {
            try {
              const customers = await stripe.customers.list({
                email: user.email,
                limit: 100,
              });
              
              // Check subscription history for all customers with this email
              for (const customer of customers.data) {
                if (customer.id === customerId) continue; // Already checked
                
                const otherSubscriptions = await stripe.subscriptions.list({
                  customer: customer.id,
                  status: 'all',
                  limit: 100,
                });
                
                const otherHasTrial = otherSubscriptions.data.some(sub => {
                  return sub.trial_start !== null && sub.trial_end !== null;
                });
                
                if (otherHasTrial) {
                  hasPreviousTrial = true;
                  console.log(`[Checkout] Found trial in another customer (${customer.id}) for email ${user.email}`);
                  break;
                }
              }
            } catch (error) {
              console.error('Error checking other customers:', error);
              // Continue if this fails
            }
          }
          
          if (hasPreviousTrial) {
            hasUsedTrial = true;
            // Update database to reflect this
            await supabase
              .from('profiles')
              .update({ 
                has_used_trial: true,
                trial_used_at: new Date().toISOString()
              })
              .eq('id', user.id);
            console.log(`[Checkout] User ${user.id} (${user.email}) has trial in Stripe history - blocking trial and updating database`);
          }
        } catch (error) {
          console.error('Error checking Stripe subscription history:', error);
          // Continue with database check if Stripe check fails
        }
      }
    }

    // Build subscription data - only include trial if user hasn't used it
    const subscriptionData: any = {};
    if (!hasUsedTrial) {
      subscriptionData.trial_period_days = 7;
      subscriptionData.trial_settings = {
        end_behavior: {
          missing_payment_method: 'cancel',
        },
      };
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      subscription_data: subscriptionData,
      success_url: `${request.headers.get('origin')}/nba/research/dashboard?success=true`,
      cancel_url: `${request.headers.get('origin')}/home`,
      metadata: {
        user_id: user.id,
        billing_cycle: billingCycle,
        has_trial: (!hasUsedTrial).toString(),
      },
      // Allow customers to go back and change their selection
      allow_promotion_codes: true,
    });

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
