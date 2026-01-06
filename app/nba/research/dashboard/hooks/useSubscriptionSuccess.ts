import { useEffect } from 'react';

/**
 * Custom hook to check for subscription success parameter from checkout
 */
export function useSubscriptionSuccess() {
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('success') === 'true') {
      alert('✅ Subscription successful! Welcome to Pro! Your Player Props features are now unlocked.');
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);
}


