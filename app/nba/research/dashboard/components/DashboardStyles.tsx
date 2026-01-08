/**
 * Global styles for the NBA Dashboard
 * 
 * This component contains all the CSS-in-JS styles used by the dashboard,
 * including responsive breakpoints, scrollbar styling, and chart optimizations.
 */

export function DashboardStyles() {
  return (
    <style jsx global>{`
      .dashboard-container {
        --sidebar-margin: 0px;
        --sidebar-width: 0px;
        --gap: 8px;
        --inner-max: 1550px;
        --app-max: calc(var(--sidebar-width) + var(--gap) + var(--inner-max));
        --content-margin-right: 0px;
        --content-padding-left: 0px;
        --content-padding-right: 0px;
      }

      @media (min-width: 1024px) {
        .dashboard-container {
          --sidebar-width: 340px;
          --right-panel-width: 340px;
        }
      }
      
      @media (min-width: 1500px) {
        .dashboard-container {
          --sidebar-margin: 0px;
          --sidebar-width: 400px;
          --right-panel-width: 400px;
          --content-margin-right: 0px;
          --content-padding-left: 0px;
          --content-padding-right: 0px;
        }
      }
      
      @media (min-width: 2200px) {
        .dashboard-container {
          --sidebar-margin: 0px;
          --sidebar-width: 460px;
          --right-panel-width: 460px;
          --content-margin-right: 0px;
          --content-padding-left: 0px;
          --content-padding-right: 0px;
        }
      }

      /* Mobile-only: reduce outer gap to tighten left/right padding */
      @media (max-width: 639px) {
        .dashboard-container { --gap: 8px; }
      }

      /* Custom scrollbar colors for light/dark mode - force always visible */
      .custom-scrollbar {
        scrollbar-width: thin;
        scrollbar-color: #d1d5db transparent;
      }
      
      .dark .custom-scrollbar {
        scrollbar-color: #4b5563 transparent;
      }
      
      .custom-scrollbar::-webkit-scrollbar {
        width: 10px;
        height: 10px;
        -webkit-appearance: none; /* Disable macOS overlay scrollbar */
      }
      
      .custom-scrollbar::-webkit-scrollbar-track {
        background: transparent;
      }
      
      /* Remove the little arrow buttons on custom scrollbars */
      .custom-scrollbar::-webkit-scrollbar-button {
        display: none;
        width: 0;
        height: 0;
      }
      
      .custom-scrollbar::-webkit-scrollbar-thumb {
        background-color: #d1d5db;
        border-radius: 8px;
      }
      
      .dark .custom-scrollbar::-webkit-scrollbar-thumb {
        background-color: #4b5563;
      }

      /* Desktop scrollbar styling: fade until hovered */
      @media (hover: hover) and (pointer: fine) {
        .fade-scrollbar { scrollbar-color: transparent transparent; }
        .fade-scrollbar:hover { scrollbar-color: #9ca3af1a transparent; }
        .fade-scrollbar::-webkit-scrollbar { width: 10px; height: 10px; background: transparent; }
        .fade-scrollbar::-webkit-scrollbar-thumb { background: transparent; border-radius: 8px; }
        .fade-scrollbar:hover::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.2); }
      }

      /* Mobile-only: thinner scrollbar for stats slider */
      @media (max-width: 639px) {
        .stats-slider-scrollbar::-webkit-scrollbar {
          height: 4px;
        }
        .stats-slider-scrollbar {
          scrollbar-width: thin;
        }
      }

      /* Mobile-only: hide X/Y axis ticks and lines inside the chart */
      @media (max-width: 639px) {
        /* Hide tick groups and text for both axes */
        .chart-mobile-optimized .recharts-cartesian-axis .recharts-cartesian-axis-tick,
        .chart-mobile-optimized .recharts-cartesian-axis .recharts-cartesian-axis-ticks,
        .chart-mobile-optimized .recharts-cartesian-axis .recharts-cartesian-axis-line,
        .chart-mobile-optimized .recharts-cartesian-axis text,
        .chart-mobile-optimized .recharts-cartesian-axis-tick-value {
          display: none !important;
        }
      }
      @media (min-width: 640px) {
        /* Ensure ticks/labels/lines reappear on tablets and larger */
        .chart-mobile-optimized .recharts-cartesian-axis .recharts-cartesian-axis-tick,
        .chart-mobile-optimized .recharts-cartesian-axis .recharts-cartesian-axis-ticks,
        .chart-mobile-optimized .recharts-cartesian-axis .recharts-cartesian-axis-line,
        .chart-mobile-optimized .recharts-cartesian-axis text,
        .chart-mobile-optimized .recharts-cartesian-axis-tick-value {
          display: initial !important;
        }
      }
      
      /* Remove focus border from chart container and all children */
      .chart-container-no-focus,
      .chart-container-no-focus *,
      .chart-container-no-focus:focus,
      .chart-container-no-focus *:focus,
      .chart-container-no-focus:focus-visible,
      .chart-container-no-focus *:focus-visible,
      .chart-container-no-focus:active,
      .chart-container-no-focus *:active {
        outline: none !important;
        box-shadow: none !important;
      }
      
      .chart-container-no-focus {
        border-color: rgb(229, 231, 235) !important;
      }
      
      .dark .chart-container-no-focus {
        border-color: rgb(55, 65, 81) !important;
      }
      
      /* Prevent Recharts elements from getting focus */
      .chart-container-no-focus .recharts-wrapper,
      .chart-container-no-focus .recharts-surface,
      .chart-container-no-focus svg {
        outline: none !important;
      }
    `}</style>
  );
}





