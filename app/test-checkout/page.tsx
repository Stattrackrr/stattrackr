"use client";

import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function TestCheckout() {
  const router = useRouter();

  const simulateFirstTime = async () => {
    await supabase.auth.updateUser({
      data: {
        subscription_status: "inactive",
        first_name: "Marcus",
        last_name: "Duarte",
        username: "marcus duarte",
        // Remove payment info
        billing_address: undefined,
        payment_method: undefined,
        payment_expiry: undefined,
        invoices: undefined
      }
    });
    alert("✅ Simulated first-time user! Go to /subscription");
    router.push('/subscription');
  };

  const restoreTestData = async () => {
    await supabase.auth.updateUser({
      data: {
        subscription_status: "active",
        subscription_plan: "StatTrackr Monthly",
        next_billing_date: "7 December 2025",
        first_name: "Marcus",
        last_name: "Duarte",
        username: "marcus duarte",
        billing_address: "Los Angeles, CA, USA",
        payment_method: "Visa •••• 9150",
        payment_expiry: "11/2027",
        invoices: [
          { date: "7 Nov 2025", amount: "$9.99", status: "Paid", plan: "StatTrackr Monthly" }
        ]
      }
    });
    alert("✅ Restored test data! Go to /subscription");
    router.push('/subscription');
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Test First-Time Checkout</h1>
        
        <div className="space-y-4">
          <button
            onClick={simulateFirstTime}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg"
          >
            Simulate First-Time User (No Payment Info)
          </button>

          <button
            onClick={restoreTestData}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-lg"
          >
            Restore Test Data (Existing Customer)
          </button>

          <button
            onClick={() => router.push('/subscription')}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-lg"
          >
            View Subscription Page
          </button>
        </div>

        <p className="text-sm text-gray-500 mt-8">
          Delete this test page at: app/test-checkout/page.tsx
        </p>
      </div>
    </div>
  );
}
