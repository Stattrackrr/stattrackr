"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const DEFAULT_NEXT = "/home";

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
 * useSearchParams() must live in a component wrapped by Suspense.
 */
function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    const run = async () => {
      const next = searchParams.get("next") || DEFAULT_NEXT;
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
  }, [router, searchParams]);

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
