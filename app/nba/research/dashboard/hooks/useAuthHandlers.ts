import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { clientLogger } from '@/lib/clientLogger';

/**
 * Custom hook for authentication-related handlers
 */
export function useAuthHandlers() {
  const router = useRouter();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const handleSidebarSubscription = async (isPro: boolean) => {
    if (!isPro) {
      router.push('/subscription');
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/subscription');
        return;
      }

      const response = await fetch('/api/portal-client', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        router.push('/subscription');
      }
    } catch (error) {
      clientLogger.error('Portal error:', error);
      router.push('/subscription');
    }
  };

  return {
    handleLogout,
    handleSidebarSubscription,
  };
}

