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
  const [success, setSuccess] = useState("");
  const [googleAvailable, setGoogleAvailable] = useState(true);
  const [showCheckEmail, setShowCheckEmail] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("");
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [forgotPasswordSuccess, setForgotPasswordSuccess] = useState(false);
  const [forgotPasswordError, setForgotPasswordError] = useState("");
  const [isResetRedirect, setIsResetRedirect] = useState(false);

  // If password reset link landed here (Supabase may redirect to Site URL), read hash and send to update-password
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash?.replace(/^#/, "") || "";
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type");
    if ((type === "recovery" || accessToken) && accessToken && refreshToken) {
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(() => {
        router.replace("/auth/update-password");
      });
      return;
    }
  }, [router]);

  // Check if user is already logged in and get redirect param
  useEffect(() => {
    // Get redirect parameter from URL
    const searchParams = new URLSearchParams(window.location.search);
    const redirect = searchParams.get('redirect');
    if (redirect) {
      // Maintain compatibility with any existing stored redirect by clearing it
      localStorage.setItem('stattrackr_login_redirect', redirect);
      if (redirect === "/auth/update-password") setIsResetRedirect(true);
    }
    // Open in sign-up mode when ?signup=1
    if (searchParams.get('signup') === '1') setIsSignUp(true);
    // Show success message after password reset
    if (searchParams.get('reset') === 'success') {
      setSuccess('Your password has been updated. You can sign in now.');
      setError('');
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
    setSuccess("");

    try {
      if (isSignUp) {
        const res = await fetch("/api/auth/signup-with-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            username: username || null,
            firstName: firstName || null,
            lastName: lastName || null,
            phone: phone || null,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.error || "Sign up failed");
        }
        setShowCheckEmail(true);
        setPendingEmail(email);
        setSuccess("");
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
        setError("Please verify your email before signing in. Check your inbox for the verification code.");
      } else if (error.message.includes('User already registered')) {
        setError("Email already in use. Please try a different email or sign in instead.");
      } else {
        setError(`Error: ${error.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async (emailToResend: string) => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/auth/resend-email-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailToResend }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to resend code.");
      setSuccess("Verification email sent. Check your inbox.");
    } catch (e: any) {
      setError(e?.message || "Failed to resend verification email.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (emailToVerify: string, code: string, remember: boolean = false) => {
    const cleaned = code.replace(/\D/g, "");
    if (cleaned.length !== 6) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/auth/verify-email-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailToVerify,
          code: cleaned,
          origin: typeof window !== "undefined" ? window.location.origin : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Invalid or expired code. Request a new one.");
        return;
      }
      if (data.redirectUrl) {
        if (remember) localStorage.setItem("stattrackr_remember_me", "true");
        else localStorage.removeItem("stattrackr_remember_me");
        window.location.href = data.redirectUrl;
        return;
      }
      if (data.signInRequired) {
        setError("");
        setSuccess(data.message || "Email verified. Please sign in.");
        setShowCheckEmail(false);
        setPendingEmail("");
        setVerificationCode("");
      }
    } catch (e: any) {
      setError(e?.message || "Invalid or expired code. Request a new one.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    setError("");
    try {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${baseUrl}${HOME_ROUTE}` }
      });
      if (error) throw error;
      localStorage.setItem('stattrackr_google_login', 'true');
    } catch (error: any) {
      if (error.message?.includes('provider is not enabled')) {
        setGoogleAvailable(false);
        setError("Google sign-in is not configured yet. Please use email/password.");
      } else setError(error.message || "Google sign in failed");
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotPasswordLoading(true);
    setForgotPasswordError("");
    setForgotPasswordSuccess(false);
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { error } = await supabase.auth.resetPasswordForEmail(forgotPasswordEmail.trim(), {
        redirectTo: `${origin}/auth/update-password`,
      });
      if (error) throw error;
      setForgotPasswordSuccess(true);
    } catch (err: any) {
      setForgotPasswordError(err?.message || "Failed to send reset link. Please try again.");
    } finally {
      setForgotPasswordLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050d1a] flex items-center justify-center p-4">
      {/* Back Button */}
      <button
        onClick={() => router.push(HOME_ROUTE)}
        className="fixed top-6 left-6 flex items-center gap-2 text-gray-300 hover:text-white transition-colors z-50"
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
            <p className="text-xl text-gray-400 mb-8">
              Advanced NBA research and analytics platform
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="bg-[#0a1929] rounded-xl p-6 border border-gray-800">
              <TrendingUp className="w-8 h-8 text-purple-400 mb-3" />
              <h3 className="font-semibold mb-2 text-gray-100">Performance Analytics</h3>
              <p className="text-sm text-gray-500">Track performance metrics, success rates, and trends</p>
            </div>
            
            <div className="bg-[#0a1929] rounded-xl p-6 border border-gray-800">
              <BarChart3 className="w-8 h-8 text-purple-400 mb-3" />
              <h3 className="font-semibold mb-2 text-gray-100">NBA Player Statistics</h3>
              <p className="text-sm text-gray-500">Research player performance and game statistics</p>
            </div>
            
            <div className="bg-[#0a1929] rounded-xl p-6 border border-gray-800">
              <PieChart className="w-8 h-8 text-purple-400 mb-3" />
              <h3 className="font-semibold mb-2 text-gray-100">Statistical Analysis</h3>
              <p className="text-sm text-gray-500">Analyze by category and identify trends</p>
            </div>
            
            <div className="bg-[#0a1929] rounded-xl p-6 border border-gray-800">
              <Database className="w-8 h-8 text-purple-400 mb-3" />
              <h3 className="font-semibold mb-2 text-gray-100">Insights & Journal</h3>
              <p className="text-sm text-gray-500">Track P&L, calendar, and automated insights</p>
            </div>
          </div>
        </div>

        {/* Right Side - Login Form */}
        <div className="w-full max-w-md mx-auto lg:mx-0">
          <div className="bg-[#0a1929] rounded-2xl border border-gray-800 shadow-2xl p-8">
            
            {/* Mobile Header */}
            <div className="lg:hidden text-center mb-8">
              <div className="flex justify-center mb-4">
                <StatTrackrLogoWithText 
                  logoSize="w-14 h-14" 
                  textSize="text-2xl"
                  isDark={true}
                />
              </div>
              <p className="text-gray-500">Advanced NBA research and analytics</p>
            </div>

            {/* Form Header */}
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">
                {showForgotPassword ? "Reset password" : isSignUp ? "Create Account" : "Welcome Back"}
              </h2>
              <p className="text-gray-500">
                {showForgotPassword ? "Enter your email and we'll send you a reset link" : isSignUp ? "Start tracking your performance" : "Sign in to continue"}
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-950/50 border border-red-900/50 text-red-400 text-sm">
                {error}
                {error.includes("verify your email") && (
                  <div className="mt-3 space-y-3">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="Enter 6-digit code"
                      className="w-full h-10 px-3 bg-[#050d1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm"
                    />
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        type="button"
                        onClick={() => handleVerifyOtp(email, verificationCode, rememberMe)}
                        disabled={loading || verificationCode.replace(/\D/g, "").length !== 6}
                        className="flex-1 py-2 px-4 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                      >
                        {loading ? "Verifying…" : "Verify code"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResendVerification(email)}
                        disabled={loading}
                        className="py-2 px-4 text-purple-400 hover:text-purple-300 text-sm font-medium disabled:opacity-50"
                      >
                        Resend code
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="mb-6 p-4 rounded-xl bg-emerald-950/50 border border-emerald-900/50 text-emerald-400 text-sm">
                {success}
              </div>
            )}

            {/* Reset link sent here — explain how to use the email link */}
            {isResetRedirect && !showForgotPassword && (
              <div className="mb-6 p-4 rounded-xl bg-amber-950/40 border border-amber-800/50 text-amber-200 text-sm">
                <p className="font-medium mb-1">Resetting your password?</p>
                <p>Use the link from your email in <strong>this same browser</strong>—click it, or copy the link and paste it into the address bar above. Don’t open it in a different app or you’ll end up back here.</p>
              </div>
            )}

            {showForgotPassword ? (
              /* Forgot password — request reset link */
              <form onSubmit={handleForgotPassword} className="space-y-6">
                {forgotPasswordSuccess ? (
                  <div className="p-4 rounded-xl bg-emerald-950/50 border border-emerald-900/50 text-emerald-400 text-sm">
                    Check your email for a password reset link. If you don't see it, check your spam folder.
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-2">Email</label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500" />
                        <input
                          type="email"
                          value={forgotPasswordEmail}
                          onChange={(e) => setForgotPasswordEmail(e.target.value)}
                          className="w-full h-12 pl-12 pr-4 bg-[#050d1a] border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 transition-colors"
                          placeholder="Enter your email"
                          required
                        />
                      </div>
                    </div>
                    {forgotPasswordError && (
                      <div className="p-4 rounded-xl bg-red-950/50 border border-red-900/50 text-red-400 text-sm">
                        {forgotPasswordError}
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={forgotPasswordLoading}
                      className="w-full h-12 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {forgotPasswordLoading ? (
                        <div className="flex justify-center">
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        </div>
                      ) : (
                        "Send reset link"
                      )}
                    </button>
                  </>
                )}
                <p className="text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgotPassword(false);
                      setForgotPasswordEmail("");
                      setForgotPasswordError("");
                      setForgotPasswordSuccess(false);
                    }}
                    className="text-purple-400 hover:text-purple-300 font-semibold transition-colors"
                  >
                    Back to sign in
                  </button>
                </p>
              </form>
            ) : showCheckEmail ? (
              /* Check your email — after sign up when confirmation is required (code-based) */
              <div className="space-y-6">
                <div className="p-4 rounded-xl bg-[#050d1a] border border-gray-700">
                  <h3 className="text-lg font-semibold text-white mb-2">Check your email</h3>
                  <p className="text-gray-400 text-sm mb-4">
                    We sent a 6-digit code to <span className="text-white font-medium">{pendingEmail}</span>. Enter it below to activate your account.
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="Enter 6-digit code"
                    className="w-full h-11 px-4 mb-3 bg-[#050d1a] border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50"
                  />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => handleVerifyOtp(pendingEmail, verificationCode, false)}
                      disabled={loading || verificationCode.replace(/\D/g, "").length !== 6}
                      className="flex-1 h-11 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50"
                    >
                      {loading ? "Verifying…" : "Verify"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResendVerification(pendingEmail)}
                      disabled={loading}
                      className="h-11 px-4 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50"
                    >
                      {loading ? "Sending…" : "Resend code"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
            <>
            {/* Auth Form */}
            <form onSubmit={handleAuth} className="space-y-6">
              {/* Sign Up Additional Fields */}
              {isSignUp && (
                <>
                  {/* Username Input */}
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">
                      Username
                    </label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500" />
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full h-12 pl-12 pr-4 bg-[#050d1a] border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 transition-colors"
                        placeholder="Enter your username"
                        required
                      />
                    </div>
                  </div>

                  {/* First Name Input */}
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">
                      First Name
                    </label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500" />
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="w-full h-12 pl-12 pr-4 bg-[#050d1a] border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 transition-colors"
                        placeholder="Enter your first name"
                        required
                      />
                    </div>
                  </div>

                  {/* Last Name Input */}
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">
                      Last Name
                    </label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500" />
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="w-full h-12 pl-12 pr-4 bg-[#050d1a] border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 transition-colors"
                        placeholder="Enter your last name"
                        required
                      />
                    </div>
                  </div>

                  {/* Phone Input (Optional) */}
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">
                      Phone Number <span className="text-gray-500">(Optional)</span>
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500" />
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full h-12 pl-12 pr-4 bg-[#050d1a] border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 transition-colors"
                        placeholder="Enter your phone number"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Email Input */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-12 pl-12 pr-4 bg-[#050d1a] border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 transition-colors"
                    placeholder="Enter your email"
                    required
                  />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-12 pl-12 pr-12 bg-[#050d1a] border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 transition-colors"
                    placeholder="Enter your password"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* Remember Me & Forgot password - Only for Sign In */}
              {!isSignUp && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="rememberMe"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 text-purple-600 bg-[#050d1a] border border-gray-700 rounded focus:ring-purple-500 focus:ring-2"
                    />
                    <label htmlFor="rememberMe" className="ml-3 text-sm text-gray-400">
                      Remember me
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgotPassword(true);
                      setError("");
                      setSuccess("");
                    }}
                    className="text-sm text-purple-400 hover:text-purple-300 font-medium transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

            {/* Divider - show if Google is available */}
            {googleAvailable && (
              <div className="my-6 flex items-center">
                <div className="flex-1 h-px bg-gray-700" />
                <span className="px-4 text-sm text-gray-500">or</span>
                <div className="flex-1 h-px bg-gray-700" />
              </div>
            )}

            {/* Google Sign In */}
            {googleAvailable && (
              <button
                onClick={handleGoogleAuth}
                disabled={loading}
                className="w-full h-12 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
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
            </>
            )}

            {/* Toggle Sign Up / Sign In */}
            <div className="mt-6 text-center">
              <p className="text-gray-500">
                {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(!isSignUp);
                    setError("");
                    setSuccess("");
                    setShowCheckEmail(false);
                    setPendingEmail("");
                    setVerificationCode("");
                    setEmail("");
                    setPassword("");
                    setUsername("");
                    setFirstName("");
                    setLastName("");
                    setPhone("");
                    setRememberMe(false);
                  }}
                  className="text-purple-400 hover:text-purple-300 font-semibold transition-colors"
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
