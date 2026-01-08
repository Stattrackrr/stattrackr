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

  // Render immediately without loading screen - dashboard will show its own loading states
  if (!mounted) {
    return null; // Return null instead of loading screen for instant render
  }

  return (
    <Suspense fallback={null}>
      <NBADashboardContent />
    </Suspense>
  );
}

