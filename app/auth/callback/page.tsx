"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const DEFAULT_NEXT = "/home";

function getSafeNextPath(rawNext: string | null): string {
  if (!rawNext) return DEFAULT_NEXT;

  // Only allow same-origin absolute paths.
  if (!rawNext.startsWith("/")) return DEFAULT_NEXT;
  if (rawNext.startsWith("//")) return DEFAULT_NEXT;

  try {
    const url = new URL(rawNext, window.location.origin);
    if (url.origin !== window.location.origin) return DEFAULT_NEXT;
    return `${url.pathname}${url.search}${url.hash}` || DEFAULT_NEXT;
  } catch {
    return DEFAULT_NEXT;
  }
}

function AuthCallbackLoading() {
  return (
    <div className="min-h-screen bg-[#050d1a] flex items-center justify-center">
      <div className="text-center text-white">
        <div className="w-10 h-10 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto mb-4" />
        <p>Signing you in…</p>
      </div>
    </div>
  );
}

/**
 * Handles the redirect from Supabase after magic-link verification.
 * Supabase appends access_token and refresh_token to the URL hash.
 * We parse them, set the session, then redirect to /home (or the `next` param).
 * We read query params from window.location so this works safely in prerendered builds.
 */
function AuthCallbackContent() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    const run = async () => {
      const next = getSafeNextPath(new URLSearchParams(window.location.search).get("next"));
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const params = new URLSearchParams(hash.replace(/^#/, ""));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          setStatus("error");
          return;
        }
        setStatus("ok");
        router.replace(next);
        return;
      }

      setStatus("ok");
      router.replace(next);
    };
    run();
  }, [router]);

  return (
    <div className="min-h-screen bg-[#050d1a] flex items-center justify-center">
      <div className="text-center text-white">
        {status === "loading" && (
          <>
            <div className="w-10 h-10 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto mb-4" />
            <p>Signing you in…</p>
          </>
        )}
        {status === "ok" && (
          <p>Redirecting…</p>
        )}
        {status === "error" && (
          <>
            <p className="text-red-400 mb-4">Could not sign you in.</p>
            <a href="/login" className="text-purple-400 hover:underline">Go to sign in</a>
          </>
        )}
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<AuthCallbackLoading />}>
      <AuthCallbackContent />
    </Suspense>
  );
}
