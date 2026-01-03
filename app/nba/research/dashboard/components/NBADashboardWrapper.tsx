'use client';

import { useState, useEffect, Suspense } from 'react';
import { NBADashboardContent } from '../page';

// Wrapper component to ensure theme context is available
// This ensures the component only renders client-side after ThemeProvider is mounted
export default function NBADashboardWrapper() {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-[#050d1a]">
        Loading dashboard...
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-[#050d1a]">Loading dashboard...</div>}>
      <NBADashboardContent />
    </Suspense>
  );
}

