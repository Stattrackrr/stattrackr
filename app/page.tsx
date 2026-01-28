"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/**
 * Root page: if recovery/password-reset link landed here (Site URL with hash),
 * establish session and send to update-password; otherwise go to /home.
 * Server redirect would drop the hash, so we must run on the client.
 */
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash?.replace(/^#/, "") || "" : "";
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type");

    if ((type === "recovery" || accessToken) && accessToken && refreshToken) {
      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(() => router.replace("/auth/update-password"));
      return;
    }

    router.replace("/home");
  }, [router]);

  return (
    <div className="min-h-screen bg-[#050d1a] flex items-center justify-center">
      <div className="w-10 h-10 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
    </div>
  );
}
