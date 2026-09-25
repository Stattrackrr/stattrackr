import { supabase } from '@/lib/supabaseClient';

export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function authErrorMessage(error: { message?: string } | null | undefined): string {
  const message = error?.message || '';
  if (message.includes('captcha')) {
    return 'Captcha is enabled in Supabase. Please disable it in Authentication → Settings → Security.';
  }
  if (message.includes('Invalid login credentials')) {
    return 'Invalid email or password. Please check and try again.';
  }
  if (message.includes('Email not confirmed')) {
    return 'Please verify your email before signing in. Check your inbox for the verification code.';
  }
  if (message.includes('User already registered') || message.toLowerCase().includes('already')) {
    return 'Email already in use. Please sign in instead.';
  }
  return message ? `Error: ${message}` : 'Something went wrong.';
}

/** Same account check used by the home popup and the signup page. */
export async function emailAccountExists(email: string): Promise<boolean> {
  const res = await fetch('/api/auth/email-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: normalizeAuthEmail(email) }),
  });
  const json = (await res.json().catch(() => ({}))) as { exists?: boolean; error?: string };
  if (!res.ok) throw new Error(json.error || 'Could not check that email.');
  return json.exists === true;
}

/** Same password sign-in used by the login page. */
export async function signInWithEmailPassword(email: string, password: string, remember: boolean) {
  const { error } = await supabase.auth.signInWithPassword({
    email: normalizeAuthEmail(email),
    password,
  });
  if (error) throw error;
  if (remember) localStorage.setItem('stattrackr_remember_me', 'true');
  else localStorage.removeItem('stattrackr_remember_me');
}
