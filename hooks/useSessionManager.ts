import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, supabaseSessionOnly } from '@/lib/supabaseClient';

export function useSessionManager() {
  const router = useRouter();

  useEffect(() => {
    // Check for sessions in both localStorage and sessionStorage
    const checkSession = async () => {
      // Check persistent session first
      let { data: { session } } = await supabase.auth.getSession();
      
      // If no persistent session, check session-only storage
      if (!session) {
        const sessionOnlyResult = await supabaseSessionOnly.auth.getSession();
        session = sessionOnlyResult.data.session;
      }
      
      if (!session) {
        // No session in either storage, redirect to login
        router.replace('/login');
        return;
      }
    };

    checkSession();

    // Listen for auth state changes on both clients
    const { data: { subscription: persistentSub } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // Clear all session data
        localStorage.removeItem('stattrackr_remember_me');
        localStorage.removeItem('stattrackr_google_login');
        router.replace('/login');
      }
    });
    
    const { data: { subscription: sessionSub } } = supabaseSessionOnly.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // Session-only logout
        router.replace('/login');
      }
    });

    return () => {
      persistentSub.unsubscribe();
      sessionSub.unsubscribe();
    };
  }, [router]);

  // Function to manually sign out
  const signOut = async () => {
    await supabase.auth.signOut();
    // Cleanup is handled by the auth state change listener above
  };

  return { signOut };
}
