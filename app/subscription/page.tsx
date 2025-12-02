"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

/**
 * Subscription page - redirects directly to Stripe Customer Portal
 */
export default function SubscriptionPage() {
  const router = useRouter();

  useEffect(() => {
    // Always redirect to Stripe portal
    const redirectToPortal = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          router.push('/login?redirect=/subscription');
          return;
        }

        const response = await fetch('/api/portal-client', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
        });

        const data = await response.json();
        
        if (data.url) {
          window.location.href = data.url;
        } else {
          // If no portal URL (no customer yet), redirect to home
          router.push('/home');
        }
      } catch (error) {
        console.error('Error redirecting to portal:', error);
        router.push('/home');
      }
    };

    redirectToPortal();
  }, [router]);

  // Show loading while redirecting
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Redirecting to subscription management...</p>
      </div>
    </div>
  );
}
