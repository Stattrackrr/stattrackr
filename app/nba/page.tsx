'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Legacy route: /nba now redirects to /props (main props page).
 */
export default function NbaRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/props');
  }, [router]);
  return null;
}
