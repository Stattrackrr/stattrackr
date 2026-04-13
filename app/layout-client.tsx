'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import ErrorBoundary from "@/components/ErrorBoundary";
import { TrackedBetsProvider } from "@/contexts/TrackedBetsContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import NavigationLoader from "@/components/NavigationLoader";
import '@/lib/disableConsoleInProduction';
import { trackMetaEvent, trackMetaPageView } from '@/lib/metaPixel';

export default function RootLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const didTrackInitialRoute = useRef(false);

  // Global error handlers
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Handle unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);
    };
    
    // Handle global errors
    const handleError = (event: ErrorEvent) => {
      // Suppress known benign NotFoundError from releasePointerCapture (e.g. overlayscrollbars,
      // scrollbar drag, or devtools resize when pointer is released or element unmounts first)
      const msg = event.error?.message ?? '';
      if (
        event.error?.name === 'NotFoundError' &&
        typeof msg === 'string' &&
        msg.includes('releasePointerCapture') &&
        msg.includes('No active pointer with the given id')
      ) {
        event.preventDefault();
        return;
      }
      console.error('Global error:', event.error);
    };
    
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);
    
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
    };
  }, []);
  
  // Fire Meta PageView on client-side route changes.
  useEffect(() => {
    if (!pathname) return;
    if (!didTrackInitialRoute.current) {
      didTrackInitialRoute.current = true;
      return;
    }
    trackMetaPageView();
  }, [pathname]);

  // Track successful Stripe return as a Purchase event.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (pathname !== '/props') return;
    const currentParams = new URLSearchParams(window.location.search);
    if (currentParams.get('success') !== 'true') return;

    const billing = currentParams.get('billing');
    const valueByBilling: Record<string, number> = {
      monthly: 9.99,
      semiannual: 49.99,
      annual: 89.99,
    };
    const value = billing ? valueByBilling[billing] : undefined;
    const sessionId = currentParams.get('session_id') || 'unknown';
    const dedupeKey = `meta_purchase_tracked_${sessionId}`;
    if (sessionStorage.getItem(dedupeKey)) return;

    const eventParams: Record<string, string | number | boolean> = { currency: 'USD' };
    if (typeof value === 'number') eventParams.value = value;
    if (billing) eventParams.billing_cycle = billing;
    trackMetaEvent('Purchase', eventParams);
    sessionStorage.setItem(dedupeKey, '1');
  }, [pathname]);

  return (
    <ThemeProvider>
      <TrackedBetsProvider>
        <ErrorBoundary>
          <NavigationLoader />
          {children}
        </ErrorBoundary>
      </TrackedBetsProvider>
    </ThemeProvider>
  );
}
