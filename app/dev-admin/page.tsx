"use client";

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function DevAdminPage() {
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const grantPremium = async () => {
    setLoading(true);
    setStatus('Granting premium access...');
    
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: {
          subscription_status: 'active',
          subscription_plan: 'pro',
          trial_ends_at: null,
          next_billing_date: '2026-12-31'
        }
      });

      if (error) {
        setStatus(`Error: ${error.message}`);
      } else {
        setStatus('✅ Premium access granted! Reloading...');
        setTimeout(() => {
          window.location.href = '/nba/research/dashboard';
        }, 1500);
      }
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const revokePremium = async () => {
    setLoading(true);
    setStatus('Revoking premium access...');
    
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: {
          subscription_status: 'inactive',
          subscription_plan: 'free',
          trial_ends_at: null,
          next_billing_date: null
        }
      });

      if (error) {
        setStatus(`Error: ${error.message}`);
      } else {
        setStatus('✅ Premium revoked! Reloading...');
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const checkStatus = async () => {
    setLoading(true);
    setStatus('Checking subscription status...');
    
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      
      if (error || !user) {
        setStatus('Error: Not logged in');
        return;
      }

      const metadata = user.user_metadata || {};
      setStatus(`
Current Status:
- Subscription Status: ${metadata.subscription_status || 'none'}
- Plan: ${metadata.subscription_plan || 'none'}
- Trial Ends: ${metadata.trial_ends_at || 'none'}
- Next Billing: ${metadata.next_billing_date || 'none'}
      `);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
          🛠️ Dev Admin Panel
        </h1>
        
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 space-y-4">
          <div className="space-y-3">
            <button
              onClick={grantPremium}
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              {loading ? 'Processing...' : '✅ Grant Premium Access'}
            </button>
            
            <button
              onClick={revokePremium}
              disabled={loading}
              className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              {loading ? 'Processing...' : '❌ Revoke Premium Access'}
            </button>
            
            <button
              onClick={checkStatus}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              {loading ? 'Processing...' : '🔍 Check Current Status'}
            </button>
          </div>

          {status && (
            <div className="mt-6 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <pre className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                {status}
              </pre>
            </div>
          )}
        </div>

        <div className="mt-6 text-center">
          <a
            href="/nba/research/dashboard"
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            → Go to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
