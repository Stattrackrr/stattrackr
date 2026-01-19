"use client";

import { useState, useEffect, Suspense } from "react";
import { supabase } from "@/lib/supabaseClient";
import Navigation from "@/components/navigation";
import { User } from "@supabase/supabase-js";
import { useSearchParams, useRouter } from "next/navigation";

function AccountSettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Profile form state
  const [username, setUsername] = useState("");
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
        setUsername(user.user_metadata?.username || "");
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
      const { error: authError } = await supabase.auth.updateUser({
        email,
        data: {
          username: username,
          first_name: firstName,
          last_name: lastName,
          phone: phone,
        }
      });

      if (authError) throw authError;

      // Sync to profiles table so first_name, last_name, username, phone show in Supabase Table Editor
      const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- profiles not in supabase Database type yet
      await (supabase as any).from('profiles').update({
        email: email || null,
        full_name: fullName,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        username: username.trim() || null,
        phone: phone.trim() || null,
        updated_at: new Date().toISOString(),
      }).eq('id', user.id);
      
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

        {/* Quick Link to Subscription */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/subscription')}
            className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium flex items-center gap-2"
          >
            Manage Subscription
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Profile Section */}
          <div className={cardClass}>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-6">
              Profile Information
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={inputClass}
                  placeholder="Enter your username"
                />
              </div>
              
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
      </div>
    </div>
  );
}

export default function AccountSettings() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[var(--brand-bg)] text-[var(--brand-fg)]">
        <Navigation />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="text-center">Loading...</div>
        </div>
      </div>
    }>
      <AccountSettingsContent />
    </Suspense>
  );
}
