"use client";

import { supabase, supabaseSessionOnly } from "@/lib/supabaseClient";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, TrendingUp, BarChart3, PieChart, Database, User, Phone } from "lucide-react";
import { StatTrackrLogoWithText } from "@/components/StatTrackrLogo";

const HOME_ROUTE = "/home";

export default function LoginPage() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [googleAvailable, setGoogleAvailable] = useState(true);

  // Check if user is already logged in and get redirect param
  useEffect(() => {
    // Get redirect parameter from URL
    const searchParams = new URLSearchParams(window.location.search);
    const redirect = searchParams.get('redirect');
    if (redirect) {
      // Maintain compatibility with any existing stored redirect by clearing it
      localStorage.setItem('stattrackr_login_redirect', redirect);
    }

    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Check for stored redirect from OAuth flow
        if (localStorage.getItem('stattrackr_login_redirect')) {
          localStorage.removeItem('stattrackr_login_redirect');
        }
        router.replace(HOME_ROUTE);
      }
    };
    checkUser();
  }, [router]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (isSignUp) {
        // Use production domain if available, otherwise use current origin
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
        
        // Sign up the user
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
            options: {
              emailRedirectTo: `${baseUrl}/dashboard`,
              data: {
                username: username,
                first_name: firstName,
                last_name: lastName,
                phone: phone || null,
              }
            }
        });
        if (signUpError) throw signUpError;
        
        // Automatically sign in the user after successful signup (email verification disabled)
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        
        // Store remember me preference for future use
        if (rememberMe) {
          localStorage.setItem('stattrackr_remember_me', 'true');
        } else {
          localStorage.removeItem('stattrackr_remember_me');
        }
        
        // Redirect to home immediately
        router.replace(HOME_ROUTE);
      } else {
        // Always use persistent session for reliable login
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        
        // Store remember me preference for future use
        if (rememberMe) {
          localStorage.setItem('stattrackr_remember_me', 'true');
        } else {
          localStorage.removeItem('stattrackr_remember_me');
        }
        
        // Always send newly authenticated users to home
        router.replace(HOME_ROUTE);
      }
    } catch (error: any) {
      // Better error handling  
      console.log('Auth error:', error); // For debugging
      if (error.message.includes('captcha')) {
        setError("Captcha is enabled in Supabase. Please disable it in Authentication → Settings → Security.");
      } else if (error.message.includes('Invalid login credentials')) {
        setError("Invalid email or password. Please check and try again.");
      } else if (error.message.includes('Email not confirmed')) {
        // If email verification is disabled but this error appears, try to sign in directly
        try {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (!signInError) {
            // Successfully signed in, redirect
            if (rememberMe) {
              localStorage.setItem('stattrackr_remember_me', 'true');
            } else {
              localStorage.removeItem('stattrackr_remember_me');
            }
            router.replace(HOME_ROUTE);
            return;
          }
        } catch (retryError) {
          // If retry fails, show the original error
        }
        setError("Account exists but email verification is required. Please check your email.");
      } else if (error.message.includes('User already registered')) {
        setError("Email already in use. Please try a different email or sign in instead.");
      } else {
        setError(`Error: ${error.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    setError("");
    
    try {
      // Use production domain if available, otherwise use current origin
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
      
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${baseUrl}${HOME_ROUTE}`,
          // Google OAuth will use persistent sessions by default
          // We'll handle remember me logic after redirect
        }
      });
      if (error) throw error;
      
      // Store that this was a Google login for session management
      localStorage.setItem('stattrackr_google_login', 'true');
    } catch (error: any) {
      if (error.message.includes('provider is not enabled')) {
        setGoogleAvailable(false);
        setError("Google sign-in is not configured yet. Please use email/password.");
      } else {
        setError(error.message || "Google sign in failed");
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#050f1f] via-[#0b1d3a] to-[#1e3a8a] flex items-center justify-center p-4">
      {/* Back Button */}
      <button
        onClick={() => router.push(HOME_ROUTE)}
        className="fixed top-6 left-6 flex items-center gap-2 text-white hover:text-emerald-400 transition-colors z-50"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        <span className="font-medium">Back to Home</span>
      </button>
      
      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-8 items-center">
        
        {/* Left Side - Branding & Features */}
        <div className="hidden lg:block space-y-8 text-white">
          <div>
            <StatTrackrLogoWithText 
              logoSize="w-16 h-16" 
              textSize="text-4xl" 
              className="mb-4"
              isDark={true}
            />
            <p className="text-xl text-slate-300 mb-8">
              Advanced NBA Sports Analytics & Data Analysis Platform
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <TrendingUp className="w-8 h-8 text-emerald-400 mb-3" />
              <h3 className="font-semibold mb-2">Performance Analytics</h3>
              <p className="text-sm text-slate-400">Track performance metrics, success rates, and trends with detailed charts</p>
            </div>
            
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <BarChart3 className="w-8 h-8 text-blue-400 mb-3" />
              <h3 className="font-semibold mb-2">NBA Player Statistics</h3>
              <p className="text-sm text-slate-400">Research NBA player performance and game statistics</p>
            </div>
            
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <PieChart className="w-8 h-8 text-purple-400 mb-3" />
              <h3 className="font-semibold mb-2">Statistical Analysis</h3>
              <p className="text-sm text-slate-400">Analyze performance by category and identify trends</p>
            </div>
            
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <Database className="w-8 h-8 text-orange-400 mb-3" />
              <h3 className="font-semibold mb-2">Expert Insights Database</h3>
              <p className="text-sm text-slate-400">Access curated analysis with historical performance data</p>
            </div>
          </div>
        </div>

        {/* Right Side - Login Form */}
        <div className="w-full max-w-md mx-auto lg:mx-0">
          <div className="bg-[#0b1d3a] backdrop-blur-sm rounded-3xl border border-white/10 shadow-2xl p-8">
            
            {/* Mobile Header */}
            <div className="lg:hidden text-center mb-8">
              <div className="flex justify-center mb-4">
                <StatTrackrLogoWithText 
                  logoSize="w-14 h-14" 
                  textSize="text-2xl"
                  isDark={true}
                />
              </div>
              <p className="text-slate-400">Track results. Master your game.</p>
            </div>

            {/* Form Header */}
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">
                {isSignUp ? "Create Account" : "Welcome Back"}
              </h2>
              <p className="text-slate-400">
                {isSignUp ? "Start tracking your betting performance" : "Sign in to your dashboard"}
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Auth Form */}
            <form onSubmit={handleAuth} className="space-y-6">
              {/* Sign Up Additional Fields */}
              {isSignUp && (
                <>
                  {/* Username Input */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Username
                    </label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full h-12 pl-12 pr-4 bg-black/20 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-colors"
                        placeholder="Enter your username"
                        required
                      />
                    </div>
                  </div>

                  {/* First Name Input */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      First Name
                    </label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="w-full h-12 pl-12 pr-4 bg-black/20 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-colors"
                        placeholder="Enter your first name"
                        required
                      />
                    </div>
                  </div>

                  {/* Last Name Input */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Last Name
                    </label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="w-full h-12 pl-12 pr-4 bg-black/20 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-colors"
                        placeholder="Enter your last name"
                        required
                      />
                    </div>
                  </div>

                  {/* Phone Input (Optional) */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Phone Number <span className="text-slate-500">(Optional)</span>
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full h-12 pl-12 pr-4 bg-black/20 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-colors"
                        placeholder="Enter your phone number"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Email Input */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-12 pl-12 pr-4 bg-black/20 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-colors"
                    placeholder="Enter your email"
                    required
                  />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-12 pl-12 pr-12 bg-black/20 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-colors"
                    placeholder="Enter your password"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* Remember Me Checkbox - Only for Sign In */}
              {!isSignUp && (
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="rememberMe"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 bg-black/20 border border-white/10 rounded focus:ring-emerald-500 focus:ring-2"
                  />
                  <label htmlFor="rememberMe" className="ml-3 text-sm text-slate-300">
                    Remember me
                  </label>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-semibold rounded-xl shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <div className="flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    {isSignUp ? "Creating Account..." : "Signing In..."}
                  </div>
                ) : (
                  isSignUp ? "Create Account" : "Sign In"
                )}
              </button>
            </form>

            {/* Divider - Only show if Google is available */}
            {googleAvailable && (
              <div className="my-6 flex items-center">
                <div className="flex-1 h-px bg-white/10" />
                <span className="px-4 text-sm text-slate-400">or</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>
            )}

            {/* Google Sign In - Only show if available */}
            {googleAvailable && (
              <button
                onClick={handleGoogleAuth}
                disabled={loading}
                className="w-full h-12 bg-white hover:bg-gray-50 text-gray-900 font-semibold rounded-xl shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>
            )}

            {/* Toggle Sign Up / Sign In */}
            <div className="mt-6 text-center">
              <p className="text-slate-400">
                {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(!isSignUp);
                    setError("");
                    // Clear form fields when switching modes
                    setEmail("");
                    setPassword("");
                    setUsername("");
                    setFirstName("");
                    setLastName("");
                    setPhone("");
                    setRememberMe(false);
                  }}
                  className="text-emerald-400 hover:text-emerald-300 font-semibold transition-colors"
                >
                  {isSignUp ? "Sign In" : "Sign Up"}
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
