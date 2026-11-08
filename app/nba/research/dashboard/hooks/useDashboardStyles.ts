'use client';

import { useMemo } from 'react';

export interface UseDashboardStylesParams {
  sidebarOpen: boolean;
}

export function useDashboardStyles({ sidebarOpen }: UseDashboardStylesParams) {
  // Memoize container styles to prevent object recreation on every render
  const containerStyle = useMemo(() => ({
    marginLeft: sidebarOpen ? 'calc(var(--sidebar-width, 0px) + var(--gap, 8px))' : '0px',
    width: sidebarOpen ? 'calc(100% - (var(--sidebar-width, 0px) + var(--gap, 8px)))' : '100%',
    paddingLeft: 0,
    transition: 'margin-left 0.3s ease, width 0.3s ease'
  }), [sidebarOpen]);

  // Memoize inner container styles (mobile uses 4px via CSS var in DashboardStyles)
  const innerContainerStyle = useMemo(() => ({
    paddingLeft: sidebarOpen ? 0 : 'var(--inner-padding-left, 2rem)',
    paddingRight: sidebarOpen ? 0 : 'var(--inner-padding-right, 1rem)'
  }), [sidebarOpen]);

  // Memoize inner container className
  const innerContainerClassName = useMemo(() => 
    `mx-auto w-full ${sidebarOpen ? 'max-w-[1550px]' : 'max-w-[1800px]'}`,
    [sidebarOpen]
  );

  // Memoize main content area className (pr-1 on mobile to match journal).
  // Scroll: document on touch/mobile; pane scroll only on real desktop (see DashboardStyles).
  const mainContentClassName = useMemo(() => 
    `dashboard-scroll-main relative z-50 flex-1 min-w-0 min-h-0 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 pl-0 pr-1 sm:pl-0 sm:pr-2 md:px-0 pb-24 lg:pb-12 fade-scrollbar custom-scrollbar ${
      sidebarOpen ? 'lg:flex-[6] xl:flex-[6.2]' : 'lg:flex-[6] xl:flex-[6]'
    }`,
    [sidebarOpen]
  );

  // Memoize main content area style
  const mainContentStyle = useMemo(() => ({
    scrollbarGutter: 'stable'
  }), []);

  return {
    containerStyle,
    innerContainerStyle,
    innerContainerClassName,
    mainContentClassName,
    mainContentStyle,
  };
}

