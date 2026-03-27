'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Global navigation loading bar for App Router transitions.
 * Starts on internal link clicks / browser back-forward, then completes when route updates.
 */
export default function NavigationLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = useMemo(() => `${pathname ?? ''}?${searchParams?.toString() ?? ''}`, [pathname, searchParams]);

  const [isVisible, setIsVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const isNavigatingRef = useRef(false);
  const hideTimeoutRef = useRef<number | null>(null);
  const failSafeTimeoutRef = useRef<number | null>(null);

  const clearTimers = () => {
    if (hideTimeoutRef.current != null) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (failSafeTimeoutRef.current != null) {
      window.clearTimeout(failSafeTimeoutRef.current);
      failSafeTimeoutRef.current = null;
    }
  };

  const start = () => {
    if (typeof window === 'undefined') return;
    clearTimers();
    isNavigatingRef.current = true;
    setIsVisible(true);
    setProgress((prev) => (prev < 10 ? 10 : prev));

    // Fail-safe so bar never gets stuck if a transition is interrupted.
    failSafeTimeoutRef.current = window.setTimeout(() => {
      isNavigatingRef.current = false;
      setProgress(100);
      hideTimeoutRef.current = window.setTimeout(() => {
        setIsVisible(false);
        setProgress(0);
      }, 220);
    }, 10000);
  };

  const stop = () => {
    if (!isNavigatingRef.current) return;
    clearTimers();
    isNavigatingRef.current = false;
    setProgress(100);
    hideTimeoutRef.current = window.setTimeout(() => {
      setIsVisible(false);
      setProgress(0);
    }, 220);
  };

  // Animate progress while navigating (never reaches 100 until stop()).
  useEffect(() => {
    if (!isVisible || !isNavigatingRef.current) return;

    const interval = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 92) return 92;
        const inc = prev < 45 ? 4 : prev < 75 ? 2 : 1;
        return Math.min(prev + inc, 92);
      });
    }, 55);

    return () => window.clearInterval(interval);
  }, [isVisible]);

  // Route changed => complete loader.
  useEffect(() => {
    stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return; // Left click only
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as Element | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      if (href.startsWith('#')) return;

      try {
        const to = new URL(anchor.href, window.location.href);
        const from = new URL(window.location.href);
        if (to.origin !== from.origin) return;
        const fromKey = `${from.pathname}${from.search}`;
        const toKey = `${to.pathname}${to.search}`;
        if (fromKey === toKey) return;
        start();
      } catch {
        // Ignore malformed hrefs.
      }
    };

    const onPopState = () => start();
    const onCustomStart = () => start();
    const onCustomStop = () => stop();

    document.addEventListener('click', onDocumentClick, true);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('navigation:start', onCustomStart as EventListener);
    window.addEventListener('navigation:end', onCustomStop as EventListener);

    return () => {
      document.removeEventListener('click', onDocumentClick, true);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('navigation:start', onCustomStart as EventListener);
      window.removeEventListener('navigation:end', onCustomStop as EventListener);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isVisible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[99] h-1">
      <div
        className="h-full bg-purple-600 transition-[width] duration-200 ease-out"
        style={{
          width: `${progress}%`,
          boxShadow: '0 0 10px rgba(147, 51, 234, 0.55)',
        }}
      />
    </div>
  );
}
