'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useTheme } from '@/contexts/ThemeContext';

export default function ProfileSettings() {
  const router = useRouter();
  const { isDark } = useTheme();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [activeTab, setActiveTab] = useState<'profile' | 'subscription'>('profile');
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/');
        return;
      }
      console.log('User loaded:', user);
      console.log('First name:', user.user_metadata?.first_name);
      console.log('Last name:', user.user_metadata?.last_name);
      setUser(user);
      setEmail(user.email || '');
      setUsername(user.user_metadata?.username || '');
      setFirstName(user.user_metadata?.first_name || '');
      setLastName(user.user_metadata?.last_name || '');
      setLoading(false);
    };
    getUser();
  }, [router]);

  const handleUpdateProfile = async () => {
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          username: username,
          first_name: firstName,
          last_name: lastName,
        },
      });
      if (error) throw error;
      alert('Profile updated successfully');
    } catch (error: any) {
      alert('Error updating profile: ' + error.message);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      alert('Password must be at least 6 characters');
      return;
    }
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;
      setShowPasswordChange(false);
      setNewPassword('');
      setConfirmPassword('');
      alert('Password changed successfully');
    } catch (error: any) {
      alert('Error changing password: ' + error.message);
    }
  };

  const handleBackClick = () => {
    router.back();
  };

  if (loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-slate-900' : 'bg-white'}`}>
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${isDark ? 'bg-slate-900' : 'bg-gray-50'}`}>
      <div className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={handleBackClick}
            className={`p-2 rounded-lg transition-colors ${
              isDark
                ? 'bg-slate-800 hover:bg-slate-700 text-white'
                : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
            }`}
          >
            ← Back
          </button>
          <h1 className={`text-3xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Settings
          </h1>
        </div>

        {/* Main Container with Side Panels */}
        <div className="flex gap-6">
          {/* Side Panel Navigation */}
          <div className={`w-48 rounded-lg shadow-lg overflow-hidden flex flex-col ${isDark ? 'bg-slate-800' : 'bg-white'}`}>
            <nav className="flex flex-col flex-1">
              <button
                onClick={() => setActiveTab('profile')}
                className={`px-6 py-4 text-left font-medium transition-colors ${
                  activeTab === 'profile'
                    ? isDark
                      ? 'bg-purple-600 text-white'
                      : 'bg-purple-100 text-purple-700'
                    : isDark
                    ? 'text-gray-300 hover:bg-slate-700'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                PROFILE
              </button>
              <button
                onClick={() => setActiveTab('subscription')}
                className={`px-6 py-4 text-left font-medium transition-colors border-t ${
                  activeTab === 'subscription'
                    ? isDark
                      ? 'bg-purple-600 text-white'
                      : 'bg-purple-100 text-purple-700'
                    : isDark
                    ? 'text-gray-300 hover:bg-slate-700 border-slate-700'
                    : 'text-gray-700 hover:bg-gray-100 border-gray-200'
                }`}
                style={{ borderTopColor: isDark ? '#475569' : '#e5e7eb' }}
              >
                SUBSCRIPTION
              </button>
            </nav>
            {/* Sign Out Button at Bottom */}
            <div className="border-t" style={{ borderColor: isDark ? '#475569' : '#e5e7eb' }}>
              <button
                onClick={async () => {
                  if (confirm('Are you sure you want to sign out?')) {
                    await supabase.auth.signOut();
                    router.push('/');
                  }
                }}
                className="w-full px-6 py-3 text-left font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 rounded-lg shadow-lg" style={{
            backgroundColor: isDark ? '#1e293b' : '#ffffff'
          }}>
            <div className="p-8">
              {/* PROFILE TAB */}
              {activeTab === 'profile' && (
                <div>
                  <h2 className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    Profile Information
                  </h2>
                  <div className="space-y-6">
                    {/* Username */}
                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        Username
                      </label>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className={`w-full px-4 py-2 rounded-lg border ${
                          isDark
                            ? 'bg-slate-600 text-white border-slate-500'
                            : 'bg-white text-gray-900 border-gray-300'
                        }`}
                      />
                    </div>

                    {/* First Name */}
                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        First Name
                      </label>
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className={`w-full px-4 py-2 rounded-lg border ${
                          isDark
                            ? 'bg-slate-600 text-white border-slate-500'
                            : 'bg-white text-gray-900 border-gray-300'
                        }`}
                      />
                    </div>

                    {/* Last Name */}
                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        Last Name
                      </label>
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className={`w-full px-4 py-2 rounded-lg border ${
                          isDark
                            ? 'bg-slate-600 text-white border-slate-500'
                            : 'bg-white text-gray-900 border-gray-300'
                        }`}
                      />
                    </div>

                    {/* Email */}
                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        Email Address
                      </label>
                      <div className={`px-4 py-2 rounded-lg ${isDark ? 'bg-slate-700' : 'bg-gray-100'}`}>
                        <p className={`${isDark ? 'text-gray-200' : 'text-gray-600'}`}>{email}</p>
                      </div>
                    </div>

                    {/* Change Password Section */}
                    <div className="border-t" style={{ borderColor: isDark ? '#475569' : '#e5e7eb' }}>
                      <div className="pt-6">
                        {!showPasswordChange ? (
                          <button
                            onClick={() => setShowPasswordChange(true)}
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                          >
                            Change Password
                          </button>
                        ) : (
                          <div className="space-y-4">
                            <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                              Change Password
                            </h3>
                            <div>
                              <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                New Password
                              </label>
                              <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className={`w-full px-4 py-2 rounded-lg ${
                                  isDark
                                    ? 'bg-slate-600 text-white border border-slate-500'
                                    : 'bg-white text-gray-900 border border-gray-300'
                                }`}
                              />
                            </div>
                            <div>
                              <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                Confirm Password
                              </label>
                              <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className={`w-full px-4 py-2 rounded-lg ${
                                  isDark
                                    ? 'bg-slate-600 text-white border border-slate-500'
                                    : 'bg-white text-gray-900 border border-gray-300'
                                }`}
                              />
                            </div>
                            <div className="flex gap-3 pt-2">
                              <button
                                onClick={handleChangePassword}
                                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                              >
                                Update Password
                              </button>
                              <button
                                onClick={() => {
                                  setShowPasswordChange(false);
                                  setNewPassword('');
                                  setConfirmPassword('');
                                }}
                                className={`px-6 py-2 rounded-lg transition-colors font-medium ${
                                  isDark
                                    ? 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                                    : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                                }`}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Save Changes Button */}
                    <div className="flex gap-3 pt-4">
                      <button
                        onClick={handleUpdateProfile}
                        className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
                      >
                        Save Changes
                      </button>
                    </div>

                  </div>
                </div>
              )}

              {/* SUBSCRIPTION TAB */}
              {activeTab === 'subscription' && (
                <div>
                  <h2 className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    Subscription
                  </h2>
                  <div className={`p-6 rounded-lg border-2 border-dashed ${
                    isDark
                      ? 'border-slate-600 bg-slate-800'
                      : 'border-gray-300 bg-gray-50'
                  }`}>
                    <p className={`text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      Subscription information coming soon
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
