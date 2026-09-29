'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

const PUBLIC_PATHS = new Set(['/', '/home', '/login', '/terms', '/privacy']);

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return pathname.startsWith('/auth/');
}

/**
 * Signed-out visitors only get the home paywall, login, and the auth/legal pages.
 * Free still needs an account, so every other route waits for a session.
 */
export default function SignedOutGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const isPublic = isPublicPath(pathname);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (isPublic) return;
    let cancelled = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      const hasSession = Boolean(session);
      if (hasSession) {
        setSignedIn(true);
        return;
      }
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
        setSignedIn(false);
        router.replace('/home');
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [isPublic, router]);

  if (isPublic || signedIn) return children;
  return <div className="min-h-dvh bg-[#050d1a]" />;
}
