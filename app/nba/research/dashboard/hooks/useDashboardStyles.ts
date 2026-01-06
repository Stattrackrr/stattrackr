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

  // Memoize inner container styles
  const innerContainerStyle = useMemo(() => ({
    paddingLeft: sidebarOpen ? 0 : '2rem',
    paddingRight: sidebarOpen ? 0 : '1rem'
  }), [sidebarOpen]);

  // Memoize inner container className
  const innerContainerClassName = useMemo(() => 
    `mx-auto w-full ${sidebarOpen ? 'max-w-[1550px]' : 'max-w-[1800px]'}`,
    [sidebarOpen]
  );

  // Memoize main content area className
  const mainContentClassName = useMemo(() => 
    `relative z-50 flex-1 min-w-0 min-h-0 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 overflow-y-auto overflow-x-hidden overscroll-contain pl-0 pr-2 sm:pl-0 sm:pr-2 md:px-0 pb-0 lg:h-screen lg:max-h-screen fade-scrollbar custom-scrollbar ${
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

