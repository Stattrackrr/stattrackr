import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { checkRateLimit, strictRateLimiter } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAuthClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase is not configured");
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function publicAuthError(message: string): { error: string; status: number } {
  const lower = message.toLowerCase();
  if (
    lower.includes("invalid login credentials") ||
    lower.includes("invalid email or password")
  ) {
    return { error: "Invalid email or password. Please check and try again.", status: 401 };
  }
  if (lower.includes("email not confirmed")) {
    return {
      error: "Please verify your email before signing in. Check your inbox for the verification code.",
      status: 401,
    };
  }
  if (
    lower.includes("load failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("timeout") ||
    lower.includes("522") ||
    lower.includes("<!doctype") ||
    lower.includes("<html") ||
    lower.includes("fetch failed")
  ) {
    return {
      error: "Sign-in is temporarily unavailable. Please wait a minute and try again.",
      status: 503,
    };
  }
  if (message.length > 180 || /<[^>]+>/.test(message)) {
    return {
      error: "Sign-in is temporarily unavailable. Please wait a minute and try again.",
      status: 503,
    };
  }
  return { error: message, status: 400 };
}

async function signInWithRetry(email: string, password: string) {
  const supabase = getAuthClient();
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (!error && data.session?.access_token && data.session?.refresh_token) {
        return data.session;
      }
      lastError = error || new Error("Sign in failed");
      const message = (error?.message || "").toLowerCase();
      const retryable =
        message.includes("fetch") ||
        message.includes("timeout") ||
        message.includes("522") ||
        message.includes("<html") ||
        message.includes("load failed");
      if (!retryable) break;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("Could not sign in right now. Please try again.");
}

export async function POST(req: Request) {
  const rateResult = checkRateLimit(req, strictRateLimiter);
  if (!rateResult.allowed && rateResult.response) {
    return rateResult.response;
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    const session = await signInWithRetry(email, password);
    return NextResponse.json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not sign in right now. Please try again.";
    const { error: publicError, status } = publicAuthError(message);
    if (status >= 500) {
      console.error("[auth/login]", message.slice(0, 300));
    }
    return NextResponse.json({ error: publicError }, { status });
  }
}
