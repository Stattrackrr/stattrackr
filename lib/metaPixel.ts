'use client';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export const trackMetaPageView = () => {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
  window.fbq('track', 'PageView');
};

export const trackMetaEvent = (
  eventName: string,
  params?: Record<string, string | number | boolean>
) => {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
  if (params) {
    window.fbq('track', eventName, params);
    return;
  }
  window.fbq('track', eventName);
};
