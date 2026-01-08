'use client';

import { useEffect, useState } from 'react';

interface LoadingBarProps {
  isLoading: boolean;
  isDark?: boolean;
  showImmediately?: boolean; // Show immediately even if isLoading is false (for props page navigation)
  mobileOffset?: number; // Offset from top on mobile (in pixels)
}

/**
 * Top loading bar that shows progress when loading player stats
 * Uses a smooth animation to indicate loading state
 */
export function LoadingBar({ isLoading, isDark = false, showImmediately = false, mobileOffset = 0 }: LoadingBarProps) {
  const [progress, setProgress] = useState(showImmediately ? 10 : 0);
  const [isVisible, setIsVisible] = useState(showImmediately);

  useEffect(() => {
    // Show immediately if showImmediately is true, or if isLoading becomes true
    if (showImmediately || isLoading) {
      setIsVisible(true);
      // Start progress immediately when showing (for props page navigation)
      if (showImmediately) {
        setProgress((prev) => prev < 10 ? 10 : prev); // Start at 10% to make it visible immediately
      } else if (isLoading && !showImmediately) {
        setProgress(0);
      }
      
      // Simulate progress (0-90%) over 2 seconds
      // The last 10% will complete when isLoading becomes false
      const interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) return 90;
          // Accelerate progress: faster at start, slower near end
          const increment = prev < 50 ? 5 : prev < 80 ? 3 : 1;
          return Math.min(prev + increment, 90);
        });
      }, 50);

      return () => clearInterval(interval);
    } else if (!isLoading && !showImmediately) {
      // Complete the bar when loading finishes
      setProgress(100);
      // Hide after a short delay to show completion
      const timeout = setTimeout(() => {
        setIsVisible(false);
        setProgress(0);
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [isLoading, showImmediately]);

  if (!isVisible) return null;

  return (
    <div 
      className="fixed left-0 right-0 z-[100] h-1 bg-transparent lg:top-0"
      style={{
        top: mobileOffset > 0 ? `${mobileOffset}px` : '0px',
      }}
    >
      <div
        className={`h-full transition-all duration-300 ease-out ${
          isDark ? 'bg-purple-500' : 'bg-purple-600'
        }`}
        style={{
          width: `${progress}%`,
          boxShadow: `0 0 10px ${isDark ? 'rgba(168, 85, 247, 0.5)' : 'rgba(147, 51, 234, 0.5)'}`,
        }}
      />
    </div>
  );
}

