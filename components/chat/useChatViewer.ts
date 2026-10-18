'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '@/lib/supabaseClient';

export const CHAT_ADMIN_EMAIL = 'admin@stattrackr.co';

export type ChatViewerState = {
  userId: string | null;
  username: string | null;
  userEmail: string | null;
  avatarUrl: string | null;
  hasPremium: boolean;
  isAdmin: boolean;
  loading: boolean;
};

export const DEFAULT_CHAT_VIEWER: ChatViewerState = {
  userId: null,
  username: null,
  userEmail: null,
  avatarUrl: null,
  hasPremium: false,
  isAdmin: false,
  loading: true,
};

/** Signed-in viewer with premium/admin flags for the chat and picks pages; signed-out users go to /home. */
export function useChatViewer(logLabel: string): [ChatViewerState, Dispatch<SetStateAction<ChatViewerState>>] {
  const router = useRouter();
  const [viewer, setViewer] = useState<ChatViewerState>(DEFAULT_CHAT_VIEWER);

  useEffect(() => {
    let isMounted = true;

    const loadViewer = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace('/home');
        return;
      }

      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, username, avatar_url, subscription_status, subscription_tier')
          .eq('id', session.user.id)
          .single();

        if (!isMounted) return;

        const profileData = profile as {
          full_name?: string | null;
          username?: string | null;
          avatar_url?: string | null;
          subscription_status?: string | null;
          subscription_tier?: string | null;
        } | null;

        const isActive =
          profileData?.subscription_status === 'active' || profileData?.subscription_status === 'trialing';
        const premiumTier =
          profileData?.subscription_tier === 'premium' || profileData?.subscription_tier === 'pro';
        const isAdmin = (session.user.email ?? '').toLowerCase() === CHAT_ADMIN_EMAIL;

        setViewer({
          userId: session.user.id,
          userEmail: session.user.email ?? null,
          username:
            profileData?.username ||
            profileData?.full_name ||
            session.user.user_metadata?.username ||
            session.user.user_metadata?.full_name ||
            null,
          avatarUrl:
            profileData?.avatar_url ??
            session.user.user_metadata?.avatar_url ??
            session.user.user_metadata?.picture ??
            null,
          hasPremium: Boolean((isActive && premiumTier) || isAdmin),
          isAdmin,
          loading: false,
        });
      } catch (error) {
        if (!isMounted) return;
        console.error(`${logLabel}: failed to load viewer profile`, error);
        setViewer({
          userId: session.user.id,
          userEmail: session.user.email ?? null,
          username:
            session.user.user_metadata?.username ||
            session.user.user_metadata?.full_name ||
            session.user.email ||
            null,
          avatarUrl:
            session.user.user_metadata?.avatar_url ??
            session.user.user_metadata?.picture ??
            null,
          hasPremium: (session.user.email ?? '').toLowerCase() === CHAT_ADMIN_EMAIL,
          isAdmin: (session.user.email ?? '').toLowerCase() === CHAT_ADMIN_EMAIL,
          loading: false,
        });
      }
    };

    void loadViewer();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setViewer(DEFAULT_CHAT_VIEWER);
        router.replace('/home');
      }

      if (event === 'SIGNED_IN' && session?.user) {
        void loadViewer();
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [router, logLabel]);

  return [viewer, setViewer];
}
