'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { NBA_PUBLIC_ENABLED } from '@/lib/nbaConstants';
import { NBADashboardContent } from '../page';

// Wrapper component to ensure theme context is available
// This ensures the component only renders client-side after ThemeProvider is mounted
export default function NBADashboardWrapper() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || NBA_PUBLIC_ENABLED) return;
    router.replace('/props?sport=afl');
  }, [mounted, router]);

  if (!mounted) {
    return null;
  }

  if (!NBA_PUBLIC_ENABLED) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <NBADashboardContent />
    </Suspense>
  );
}
