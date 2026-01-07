'use client';

import LeftSidebar from "@/components/LeftSidebar";
import { Dispatch, SetStateAction } from "react";

interface DashboardLeftSidebarWrapperProps {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  oddsFormat: 'american' | 'decimal';
  setOddsFormat: Dispatch<SetStateAction<'american' | 'decimal'>>;
  hasPremium: boolean;
  avatarUrl: string | null;
  username: string | null;
  userEmail: string | null;
  isPro: boolean;
  onSubscriptionClick: () => void;
  onSignOutClick: () => void;
}

export function DashboardLeftSidebarWrapper({
  sidebarOpen,
  setSidebarOpen,
  oddsFormat,
  setOddsFormat,
  hasPremium,
  avatarUrl,
  username,
  userEmail,
  isPro,
  onSubscriptionClick,
  onSignOutClick,
}: DashboardLeftSidebarWrapperProps) {
  return (
    <>
      {/* Left Sidebar - conditionally rendered based on sidebarOpen state */}
      {sidebarOpen && (
        <LeftSidebar
          oddsFormat={oddsFormat}
          setOddsFormat={setOddsFormat}
          hasPremium={hasPremium}
          avatarUrl={avatarUrl}
          username={username}
          userEmail={userEmail}
          isPro={isPro}
          onSubscriptionClick={onSubscriptionClick}
          onSignOutClick={onSignOutClick}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
      )}
      
      {/* Expand Sidebar Button - visible when sidebar is closed */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="hidden lg:flex fixed z-[60] items-center justify-center w-8 h-8 bg-gray-300 dark:bg-[#0a1929] hover:bg-gray-400 dark:hover:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-lg transition-all"
          style={{
            top: '1.5rem',
            left: 'clamp(0px, calc((100vw - var(--app-max, 2000px)) / 2), 9999px)',
            transition: 'left 0.3s ease, top 0.3s ease'
          }}
          aria-label="Open sidebar"
        >
          <svg 
            className="w-4 h-4 text-gray-700 dark:text-gray-300 transition-transform"
            style={{ transform: 'rotate(180deg)' }}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
    </>
  );
}
