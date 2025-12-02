export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

/**
 * Apply a coupon/promo code to an existing active subscription
 * 
 * POST /api/subscription/apply-coupon
 * Body: { couponCode: string }
 */
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get request body
    const body = await request.json();
    const { couponCode } = body;

    if (!couponCode || typeof couponCode !== 'string') {
      return NextResponse.json(
        { error: 'Coupon code is required' },
        { status: 400 }
      );
    }

    // Get user's profile with Stripe subscription ID
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'User profile not found' },
        { status: 404 }
      );
    }

    if (!profile.stripe_subscription_id) {
      return NextResponse.json(
        { error: 'No active subscription found' },
        { status: 400 }
      );
    }

    // Get Stripe instance
    const stripe = getStripe();

    // First, verify the coupon exists and is valid
    let coupon;
    try {
      // Try to retrieve coupon by ID (if it's a coupon ID)
      coupon = await stripe.coupons.retrieve(couponCode);
    } catch (err: any) {
      // If not found by ID, try to find by promotion code
      try {
        const promotionCodes = await stripe.promotionCodes.list({
          code: couponCode,
          limit: 1,
          expand: ['data.coupon'], // Expand coupon object
        });

        if (promotionCodes.data.length === 0) {
          return NextResponse.json(
            { error: 'Invalid coupon code' },
            { status: 400 }
          );
        }

        const promotionCode = promotionCodes.data[0];
        // With expand, coupon should be a Coupon object, but handle both cases
        const couponData = (promotionCode as any).coupon;
        if (typeof couponData === 'string') {
          // If it's still a string ID, retrieve it
          coupon = await stripe.coupons.retrieve(couponData);
        } else if (couponData && typeof couponData === 'object' && couponData.id) {
          // If expanded, use the coupon object directly
          coupon = couponData;
        } else {
          return NextResponse.json(
            { error: 'Invalid coupon code' },
            { status: 400 }
          );
        }
      } catch (promoErr: any) {
        return NextResponse.json(
          { error: 'Invalid coupon code' },
          { status: 400 }
        );
      }
    }

    // Check if coupon is valid
    if (coupon.valid === false) {
      return NextResponse.json(
        { error: 'This coupon is no longer valid' },
        { status: 400 }
      );
    }

    // Apply coupon to subscription
    try {
      // Use discounts array to apply coupon (correct Stripe API format)
      const subscription = await stripe.subscriptions.update(
        profile.stripe_subscription_id,
        {
          discounts: [{
            coupon: coupon.id,
          }],
          proration_behavior: 'always_invoice', // Prorate the discount immediately
        }
      );

      console.log(`✅ Applied coupon ${coupon.id} to subscription ${subscription.id}`);

      // Get discount info from discounts array (plural)
      const activeDiscount = subscription.discounts && subscription.discounts.length > 0 
        ? subscription.discounts[0] 
        : null;

      return NextResponse.json({
        success: true,
        message: 'Coupon applied successfully',
        subscription: {
          id: subscription.id,
          status: subscription.status,
          discount: activeDiscount ? {
            coupon: typeof activeDiscount.coupon === 'string' ? activeDiscount.coupon : activeDiscount.coupon.id,
            percent_off: typeof activeDiscount.coupon === 'string' ? null : activeDiscount.coupon.percent_off,
            amount_off: typeof activeDiscount.coupon === 'string' ? null : activeDiscount.coupon.amount_off,
          } : null,
        },
      });
    } catch (stripeError: any) {
      console.error('Stripe error applying coupon:', stripeError);
      
      if (stripeError.code === 'resource_missing') {
        return NextResponse.json(
          { error: 'Subscription not found' },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { error: stripeError.message || 'Failed to apply coupon' },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error('Error applying coupon:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

