'use client';

import { useEffect, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';

export default function NavigationLoader() {
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(false);
  const currentPathRef = useRef(pathname);
  const loadingStartTimeRef = useRef<number | null>(null);
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    // Only run in browser
    if (typeof window === 'undefined') return;

    // Detect clicks on Link elements (Next.js Link components)
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if click is on a Link or inside a Link
      const link = target.closest('a[href]');
      if (link) {
        const href = link.getAttribute('href');
        // Only show loading for internal navigation (not external links or hash links)
        // Don't show on NBA pages - they have their own loading screens
        if (href && href.startsWith('/') && !href.startsWith('#') && href !== pathname && !pathname.startsWith('/nba')) {
          setIsLoading(true);
          loadingStartTimeRef.current = Date.now();
        }
      }
    };

    // Listen for clicks (capture phase to catch early)
    document.addEventListener('click', handleClick, true);

    return () => {
      document.removeEventListener('click', handleClick, true);
    };
  }, [pathname]);

  useEffect(() => {
    // Skip showing loader on initial page load - let page-specific loading screens handle it
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      currentPathRef.current = pathname;
      return;
    }

    // When pathname changes, navigation is complete
    if (pathname !== currentPathRef.current) {
      currentPathRef.current = pathname;
      
      // Calculate minimum display time (300ms) to avoid flickering on fast navigations
      const minDisplayTime = 300;
      const elapsed = loadingStartTimeRef.current ? Date.now() - loadingStartTimeRef.current : 0;
      const remainingTime = Math.max(0, minDisplayTime - elapsed);
      
      // Hide loading after minimum display time
      const timer = setTimeout(() => {
        setIsLoading(false);
        loadingStartTimeRef.current = null;
      }, remainingTime);
      
      return () => clearTimeout(timer);
    }
  }, [pathname]);

  if (!isLoading) return null;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      {/* Loading overlay */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-auto" />
      
      {/* Loading spinner */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 flex flex-col items-center gap-4">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 border-4 border-purple-200 dark:border-purple-800 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-purple-600 dark:border-purple-400 rounded-full border-t-transparent animate-spin"></div>
          </div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">Loading...</p>
        </div>
      </div>
    </div>
  );
}

