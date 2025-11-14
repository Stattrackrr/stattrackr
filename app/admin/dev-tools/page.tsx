"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function DevToolsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    loadUserData();
  }, []);

  async function loadUserData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
        
        const { data: profileData, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        
        console.log('Profile data:', profileData);
        console.log('Profile error:', error);
        console.log('Error code:', error?.code);
        console.log('Error message:', error?.message);
        console.log('Error details:', JSON.stringify(error, null, 2));
        
        if (error) {
          console.error('Error fetching profile:', error);
          alert('Profile fetch error: ' + (error?.message || 'Unknown error. Check if profiles table exists and has proper RLS policies.'));
          // Profile might not exist, create it
          if (error.code === 'PGRST116' || !profileData) {
            console.log('Profile does not exist, creating one...');
            const { data: newProfile, error: createError } = await supabase
              .from('profiles')
              .insert({
                id: user.id,
                subscription_tier: 'free',
                subscription_status: null,
              } as any)
              .select()
              .single();
            
            if (createError) {
              console.error('Error creating profile:', createError);
            } else {
              setProfile(newProfile);
            }
          }
        } else {
          setProfile(profileData);
        }
      } else {
        router.push('/');
      }
    } catch (error) {
      console.error('Error loading user:', error);
    } finally {
      setLoading(false);
    }
  }

  async function toggleProStatus() {
    setUpdating(true);
    try {
      const isPro = profile?.subscription_status === 'active' && profile?.subscription_tier === 'pro';
      
      const updates = isPro
        ? {
            // Remove Pro
            subscription_status: null,
            subscription_tier: 'free',
            subscription_billing_cycle: null,
            subscription_current_period_end: null,
          }
        : {
            // Add Pro
            subscription_status: 'active',
            subscription_tier: 'pro',
            subscription_billing_cycle: 'monthly',
            subscription_current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          };

      console.log('Updating profile with:', updates);
      console.log('User ID:', user.id);

      const { data, error } = await supabase
        .from('profiles')
        .update(updates as any)
        .eq('id', user.id)
        .select();

      console.log('Update response:', { data, error });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        throw new Error('No profile found to update. Profile might not exist in database.');
      }

      // Reload data
      await loadUserData();
      alert(isPro ? '✅ Pro status removed' : '✅ Pro status activated!');
    } catch (error: any) {
      console.error('Error updating profile:', error);
      alert('Error: ' + (error.message || JSON.stringify(error)));
    } finally {
      setUpdating(false);
    }
  }

  async function setTrialing() {
    setUpdating(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          subscription_status: 'trialing',
          subscription_tier: 'pro',
          subscription_billing_cycle: 'monthly',
          subscription_current_period_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        } as any)
        .eq('id', user.id);

      if (error) throw error;

      await loadUserData();
      alert('✅ Trial status set (7 days)!');
    } catch (error: any) {
      console.error('Error updating profile:', error);
      alert('Error: ' + error.message);
    } finally {
      setUpdating(false);
    }
  }

  async function syncStripeSubscription() {
    setUpdating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      const response = await fetch('/api/sync-subscription', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sync subscription');
      }

      await loadUserData();
      alert('✅ Subscription synced from Stripe!');
    } catch (error: any) {
      console.error('Error syncing subscription:', error);
      alert('Error: ' + error.message);
    } finally {
      setUpdating(false);
    }
  }

  async function findAndLinkStripeCustomer() {
    setUpdating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      const response = await fetch('/api/find-stripe-customer', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to find Stripe customer');
      }

      await loadUserData();
      alert('✅ Stripe customer linked! Customer ID: ' + data.customerId);
    } catch (error: any) {
      console.error('Error finding Stripe customer:', error);
      alert('Error: ' + error.message);
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div>Loading...</div>
      </div>
    );
  }

  const isPro = profile?.subscription_status === 'active' && profile?.subscription_tier === 'pro';
  const isTrialing = profile?.subscription_status === 'trialing';

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">🛠️ Dev Tools</h1>
          <button
            onClick={() => router.push('/subscription')}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            View Subscription Page
          </button>
        </div>

        {/* Current Status */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Current Status</h2>
          <div className="space-y-2 text-gray-300">
            <p><span className="font-semibold">User ID:</span> {user?.id}</p>
            <p><span className="font-semibold">Email:</span> {user?.email}</p>
            <p>
              <span className="font-semibold">Tier:</span>{' '}
              <span className={isPro || isTrialing ? 'text-green-400' : 'text-gray-400'}>
                {profile?.subscription_tier || 'free'}
              </span>
            </p>
            <p>
              <span className="font-semibold">Status:</span>{' '}
              <span className={isPro || isTrialing ? 'text-green-400' : 'text-gray-400'}>
                {profile?.subscription_status || 'none'}
              </span>
            </p>
            {profile?.subscription_billing_cycle && (
              <p><span className="font-semibold">Billing:</span> {profile.subscription_billing_cycle}</p>
            )}
            {profile?.subscription_current_period_end && (
              <p>
                <span className="font-semibold">Expires:</span>{' '}
                {new Date(profile.subscription_current_period_end).toLocaleDateString()}
              </p>
            )}
            {profile?.stripe_customer_id && (
              <p><span className="font-semibold">Stripe Customer:</span> {profile.stripe_customer_id}</p>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <button
              onClick={toggleProStatus}
              disabled={updating}
              className={`w-full px-6 py-3 rounded-lg font-semibold transition-colors ${
                isPro
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-green-600 hover:bg-green-700'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {updating ? 'Updating...' : isPro ? '❌ Remove Pro Status' : '✅ Activate Pro Status'}
            </button>

            <button
              onClick={setTrialing}
              disabled={updating}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updating ? 'Updating...' : '🎯 Set Trial Status (7 days)'}
            </button>

            <button
              onClick={findAndLinkStripeCustomer}
              disabled={updating}
              className="w-full px-6 py-3 bg-yellow-600 hover:bg-yellow-700 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updating ? 'Finding...' : '🔍 Find & Link Stripe Customer'}
            </button>

            <button
              onClick={syncStripeSubscription}
              disabled={updating}
              className="w-full px-6 py-3 bg-orange-600 hover:bg-orange-700 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updating ? 'Syncing...' : '🔄 Sync from Stripe'}
            </button>

            <button
              onClick={() => router.push('/nba/research/dashboard')}
              className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold transition-colors"
            >
              🏀 Go to Dashboard
            </button>

            <button
              onClick={() => router.push('/journal')}
              className="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-semibold transition-colors"
            >
              📔 Go to Journal
            </button>
          </div>
        </div>

        {/* Warning */}
        <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-4">
          <p className="text-yellow-400 text-sm">
            ⚠️ <span className="font-semibold">Development Tool:</span> This page is for testing only. 
            Changes are made directly to your database profile.
          </p>
        </div>
      </div>
    </div>
  );
}
