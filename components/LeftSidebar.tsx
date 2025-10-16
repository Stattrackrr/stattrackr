"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, Dispatch, SetStateAction } from "react";
import { StatTrackrLogoWithText } from "./StatTrackrLogo";
import { useTheme } from "../contexts/ThemeContext";

type OddsFormat = 'american' | 'decimal';
interface LeftSidebarProps {
  oddsFormat: OddsFormat;
  setOddsFormat: Dispatch<SetStateAction<OddsFormat>>;
}

export default function LeftSidebar({ oddsFormat, setOddsFormat }: LeftSidebarProps) {
  const pathname = usePathname();
  const [showSettings, setShowSettings] = useState(false);
  const { theme, setTheme, isDark } = useTheme();

  const handleSaveSettings = () => {
    // Save to localStorage for persistence
    localStorage.setItem('theme', theme);
    localStorage.setItem('oddsFormat', oddsFormat);
    
    // Close the settings modal
    setShowSettings(false);
    
    // You can add more logic here like updating global state, API calls, etc.
    console.log('Settings saved:', { theme, oddsFormat });
  };

  const sports = [
    { name: "All Sports", href: "/research" },
    { name: "NBA", href: "/nba/research/dashboard" },
    { name: "NFL", href: "/nfl/research/dashboard" },
    { name: "NBL", href: "/nbl/research/dashboard" },
    { name: "TENNIS", href: "/tennis/research/dashboard" },
    { name: "SOCCER", href: "/soccer/research/dashboard" },
  ];

  return (
    <>
    <div className="fixed left-0 top-0 h-full w-64 bg-gray-300 dark:bg-slate-900 border-r border-gray-200 dark:border-gray-700 flex flex-col rounded-r-2xl shadow-lg">
      {/* Logo at top */}
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <StatTrackrLogoWithText 
          logoSize="w-10 h-10" 
          textSize="text-2xl" 
          isDark={isDark}
        />
      </div>

      {/* Navigation links */}
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {sports.map((sport) => (
            <li key={sport.name}>
              <Link
                href={sport.href}
                className={`block px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  pathname === sport.href
                    ? "bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300"
                    : "text-black dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-black dark:hover:text-white"
                }`}
              >
                {sport.name}
              </Link>
            </li>
          ))}
        </ul>
        
        {/* Journal section with spacing */}
        <div className="mt-6">
          <Link
            href="/journal"
            className={`block px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
              pathname === "/journal"
                ? "bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300"
                : "text-black dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-black dark:hover:text-white"
            }`}
          >
            Journal
          </Link>
        </div>
      </nav>

      {/* Settings section at bottom */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <button 
          onClick={() => setShowSettings(true)}
          className="w-full px-4 py-3 text-left rounded-xl text-sm font-medium text-black dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-black dark:hover:text-white transition-colors flex items-center gap-3"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </button>
      </div>
    </div>

    {/* Settings Modal */}
    {showSettings && (
      <div className="fixed inset-0 z-50">
        {/* Backdrop with blur */}
        <div 
          className="absolute inset-0 bg-black/20 backdrop-blur-sm"
          onClick={() => setShowSettings(false)}
        ></div>
        
        {/* Modal content - positioned like sidebar */}
        <div className="fixed left-0 top-0 h-full w-64 bg-gray-300 dark:bg-slate-900 border-r border-gray-200 dark:border-gray-700 rounded-r-2xl shadow-xl z-10 flex flex-col">
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Settings</h2>
            <button
              onClick={() => setShowSettings(false)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div className="flex-1 p-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-black dark:text-gray-300 mb-3">Theme</label>
              <select 
                value={theme}
                onChange={(e) => setTheme(e.target.value as 'Light' | 'Dark')}
                className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="Light">Light</option>
                <option value="Dark">Dark</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-black dark:text-gray-300 mb-3">Preferred Odds</label>
              <select 
                value={oddsFormat}
                onChange={(e) => setOddsFormat((e.target.value as 'american' | 'decimal'))}
                className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="american">American</option>
                <option value="decimal">Decimal</option>
              </select>
            </div>
          </div>
          
          <div className="p-6 border-t border-gray-200 dark:border-gray-700">
            <button 
              onClick={handleSaveSettings}
              className="w-full bg-purple-600 text-white py-3 px-4 rounded-xl hover:bg-purple-700 transition-colors font-medium"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
