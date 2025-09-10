"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import Navigation from "@/components/navigation";
import { User } from "@supabase/supabase-js";

export default function AccountSettings() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"profile" | "subscription">("profile");
  
  // Profile form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  
  useEffect(() => {
    loadUserData();
  }, []);

  async function loadUserData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
        setEmail(user.email || "");
        setFirstName(user.user_metadata?.first_name || "");
        setLastName(user.user_metadata?.last_name || "");
        setPhone(user.user_metadata?.phone || "");
      }
    } catch (error) {
      console.error("Error loading user:", error);
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    if (!user) return;
    
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        email,
        data: {
          first_name: firstName,
          last_name: lastName,
          phone: phone,
        }
      });

      if (error) throw error;
      
      alert("Profile updated successfully!");
      await loadUserData(); // Reload to get updated data
    } catch (error) {
      console.error("Error updating profile:", error);
      alert("Failed to update profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--brand-bg)] text-[var(--brand-fg)]">
        <Navigation />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="text-center">Loading...</div>
        </div>
      </div>
    );
  }

  const tabButtonClass = (isActive: boolean) =>
    `px-6 py-3 text-sm font-medium rounded-lg transition-colors ${
      isActive 
        ? "bg-emerald-600 text-white" 
        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
    }`;

  const inputClass = "w-full px-4 py-3 rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white dark:focus:border-emerald-400";
  const labelClass = "block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2";
  const cardClass = "bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700";

  return (
    <div className="min-h-screen bg-[var(--brand-bg)] text-[var(--brand-fg)]">
      <Navigation />
      
      <div className="max-w-4xl mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Account Settings</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2">
            Manage your profile information and subscription
          </p>
        </header>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-8">
          <button
            onClick={() => setActiveTab("profile")}
            className={tabButtonClass(activeTab === "profile")}
          >
            Profile
          </button>
          <button
            onClick={() => setActiveTab("subscription")}
            className={tabButtonClass(activeTab === "subscription")}
          >
            Subscription
          </button>
        </div>

        {/* Profile Tab */}
        {activeTab === "profile" && (
          <div className={cardClass}>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-6">
              Profile Information
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>First Name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className={inputClass}
                  placeholder="Enter your first name"
                />
              </div>
              
              <div>
                <label className={labelClass}>Last Name</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className={inputClass}
                  placeholder="Enter your last name"
                />
              </div>
              
              <div>
                <label className={labelClass}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="Enter your email"
                />
              </div>
              
              <div>
                <label className={labelClass}>Phone Number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputClass}
                  placeholder="Enter your phone number"
                />
              </div>
            </div>
            
            <div className="flex justify-end mt-8">
              <button
                onClick={saveProfile}
                disabled={saving}
                className="px-6 py-3 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        )}

        {/* Subscription Tab */}
        {activeTab === "subscription" && (
          <div className={cardClass}>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-6">
              Subscription
            </h2>
            
            {user?.user_metadata?.subscription_status === "active" ? (
              <div>
                <div className="flex items-center justify-between p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg mb-6">
                  <div>
                    <h3 className="font-semibold text-emerald-800 dark:text-emerald-200">
                      Active Subscription
                    </h3>
                    <p className="text-sm text-emerald-600 dark:text-emerald-300">
                      {user?.user_metadata?.subscription_plan || "Premium Plan"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-emerald-600 dark:text-emerald-300">
                      Next billing: {user?.user_metadata?.next_billing_date || "N/A"}
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-3">
                  <button className="px-4 py-2 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                    Manage Subscription
                  </button>
                  <button className="px-4 py-2 text-sm text-red-600 hover:text-red-700 transition-colors">
                    Cancel Subscription
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                  No Active Subscription
                </h3>
                <p className="text-slate-600 dark:text-slate-400 mb-6">
                  Upgrade to unlock premium features and unlimited access.
                </p>
                <button className="px-6 py-3 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 transition-colors">
                  View Plans
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
