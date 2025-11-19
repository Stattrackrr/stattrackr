export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL environment variable is required');
}
if (!supabaseServiceKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
}
if (!stripeSecretKey) {
  throw new Error('STRIPE_SECRET_KEY environment variable is required');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2025-10-29.clover',
});

export async function POST(req: NextRequest) {
  try {
    // Get user from Authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Search for customer in Stripe by email
    const customers = await stripe.customers.list({
      email: user.email,
      limit: 1,
    });

    if (customers.data.length === 0) {
      return NextResponse.json({ 
        error: 'No Stripe customer found with your email. Complete a checkout first.' 
      }, { status: 404 });
    }

    const customer = customers.data[0];

    // Update profile with customer ID
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        stripe_customer_id: customer.id,
      })
      .eq('id', user.id);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      message: 'Stripe customer linked successfully',
      customerId: customer.id,
    });
  } catch (error: any) {
    console.error('Find Stripe customer error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to find Stripe customer' },
      { status: 500 }
    );
  }
}
