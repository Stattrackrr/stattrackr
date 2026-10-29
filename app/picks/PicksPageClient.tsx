'use client';

import { BarChart3, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { BackToPropsButton } from '@/components/BackToPropsButton';
import { PickAlertsButton } from '@/components/picks/PickAlertsButton';
import { PicksReadMeButton } from '@/components/picks/PicksReadMeButton';
import { AiPicksFeed, AiPicksLearningPanel } from '@/components/chat/AiPicksFeed';
import { OfficialPicksRecordModal } from '@/components/chat/OfficialPicksRecordModal';
import { useChatViewer } from '@/components/chat/useChatViewer';
import { openProUpgrade } from '@/components/ProFeatureLock';
import { useTheme } from '@/contexts/ThemeContext';
import { aiPicksAsRecordBets, fetchAiPicks, fetchAiPicksPublic } from '@/lib/aiPicks/client';
import { DEFAULT_ODDS_FORMAT, readOddsFormatPreference } from '@/lib/currencyUtils';
import { useSiteOnlineCount } from '@/lib/sitePresence';
import { supabase } from '@/lib/supabaseClient';

type OddsFormat = 'american' | 'decimal';

async function loadAiRecordBets() {
  return aiPicksAsRecordBets(await fetchAiPicks(1000));
}

export default function PicksPageClient() {
  const router = useRouter();
  const { isDark } = useTheme();
  const [viewer, setViewer] = useChatViewer('Picks page');
  const [oddsFormat, setOddsFormat] = useState<OddsFormat>(DEFAULT_ODDS_FORMAT);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [aiPicksPublic, setAiPicksPublic] = useState(false);
  const onlineCount = useSiteOnlineCount();
  const locked = !viewer.isAdmin && !aiPicksPublic;

  useEffect(() => {
    try {
      setOddsFormat(readOddsFormatPreference());
    } catch {
      // Ignore local storage access issues.
    }
  }, []);

  useEffect(() => {
    if (!viewer.userId) return;
    let cancelled = false;
    void fetchAiPicksPublic().then((isPublic) => {
      if (!cancelled) setAiPicksPublic(isPublic);
    });
    return () => {
      cancelled = true;
    };
  }, [viewer.userId]);

  const handleSubscriptionClick = async () => {
    if (!viewer.hasPremium) {
      router.push('/subscription');
      return;
    }
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/subscription');
        return;
      }
      const response = await fetch('/api/portal-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      });
      const data = (await response.json()) as { url?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
    } catch (error) {
      console.error('Picks page: failed to open billing portal', error);
    }
    router.push('/subscription');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    router.push('/');
  };

  return (
    <div className="dashboard-container fixed inset-0 min-h-0 overflow-hidden bg-gray-50 text-gray-900 transition-colors dark:bg-[#050d1a] dark:text-white">
      <style jsx global>{`
        .dashboard-container {
          --sidebar-margin: 0px;
          --sidebar-width: 0px;
          --gap: 2px;
          --inner-max: 1550px;
          --app-max: calc(var(--sidebar-width) + var(--gap) + var(--inner-max));
          --content-margin-right: 0px;
          --content-padding-left: 0px;
          --content-padding-right: 0px;
        }

        @media (min-width: 1024px) {
          .dashboard-container {
            --sidebar-width: 340px;
            --right-panel-width: 340px;
          }
        }

        @media (min-width: 1500px) {
          .dashboard-container {
            --sidebar-width: 400px;
            --right-panel-width: 400px;
          }
        }

        @media (min-width: 2200px) {
          .dashboard-container {
            --sidebar-width: 460px;
            --right-panel-width: 460px;
          }
        }
      `}</style>

      <DashboardLeftSidebarWrapper
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        oddsFormat={oddsFormat}
        setOddsFormat={setOddsFormat}
        hasPremium={viewer.hasPremium}
        avatarUrl={viewer.avatarUrl}
        username={viewer.username}
        userEmail={viewer.userEmail}
        isPro={viewer.hasPremium}
        onSubscriptionClick={handleSubscriptionClick}
        onSignOutClick={handleLogout}
        onProfileUpdated={({ username, full_name, avatar_url }) => {
          setViewer((current) => ({
            ...current,
            username: username ?? full_name ?? current.username,
            avatarUrl: avatar_url ?? current.avatarUrl,
          }));
        }}
      />

      <main
        className="dashboard-container h-full overflow-hidden px-0 transition-[margin,width] duration-300"
        style={{
          marginLeft: sidebarOpen ? 'calc(var(--sidebar-width, 0px) + var(--gap, 2px))' : '0px',
          width: sidebarOpen ? 'calc(100% - (var(--sidebar-width, 0px) + var(--gap, 2px)))' : '100%',
          paddingLeft: 0,
        }}
      >
        <div className="mx-auto h-full w-full max-w-[1550px]">
          <div className="dashboard-container flex h-full min-h-0 w-full flex-col px-1.5 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-2 sm:px-3 sm:pt-4 lg:px-3 lg:pb-4">
            {viewer.loading ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600 shadow-sm dark:border-gray-700 dark:bg-[#0f1a2b] dark:text-gray-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading picks...
                </div>
              </div>
            ) : !viewer.hasPremium ? (
              <div className="rounded-3xl border border-purple-200 bg-gradient-to-br from-purple-50 to-white p-6 shadow-sm dark:border-purple-800/60 dark:from-purple-950/30 dark:to-[#0f1a2b]">
                <div className="max-w-2xl">
                  <p className="text-sm font-medium uppercase tracking-[0.22em] text-purple-500 dark:text-purple-300">Upgrade required</p>
                  <h2 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">Picks are available to premium members.</h2>
                  <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                    Upgrade to unlock Stattrackr AI picks, posted, tracked and graded automatically.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => openProUpgrade()}
                      className="rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-purple-700"
                    >
                      View plans
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push('/props')}
                      className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      Back to props
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <section className="flex min-h-0 flex-1 flex-col sm:h-[calc(100dvh-9rem)] lg:h-[calc(100vh-1rem)] lg:max-w-[1480px] lg:pr-3">
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent dark:bg-transparent lg:h-full lg:rounded-3xl lg:border lg:border-gray-200 lg:bg-white lg:shadow-sm dark:lg:border-gray-700 dark:lg:bg-[#0f1a2b]">
                  <div className="border-b border-gray-200 px-2 py-3 dark:border-gray-700 sm:px-5 sm:py-4">
                    <div className="flex flex-col gap-1.5">
                      <BackToPropsButton className="mb-1" />
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Picks</h2>
                            {onlineCount ? (
                              <span
                                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                                title="People on StatTrackr right now"
                              >
                                <span className="relative flex h-2 w-2">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                                </span>
                                {onlineCount} online
                              </span>
                            ) : null}
                          </div>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            Picks from Stattrackr AI, posted, tracked and graded automatically.
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                          <PicksReadMeButton />
                          <PickAlertsButton />
                          {!locked ? (
                            <button
                              type="button"
                              onClick={() => setShowRecordModal(true)}
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/50 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/25 dark:text-emerald-200"
                            >
                              <BarChart3 className="h-3.5 w-3.5" />
                              View record
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="chat-scrollbar relative z-0 min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain px-5 py-4">
                    {locked ? <AiPicksLearningPanel /> : <AiPicksFeed />}
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </main>

      <OfficialPicksRecordModal
        isOpen={showRecordModal}
        onClose={() => setShowRecordModal(false)}
        isAdmin={viewer.isAdmin}
        isDark={isDark}
        loadBets={loadAiRecordBets}
        subtitle="Stattrackr AI units performance. Every pick is graded automatically at the price shown when it was posted, which may no longer be available by the time you bet."
      />
    </div>
  );
}
