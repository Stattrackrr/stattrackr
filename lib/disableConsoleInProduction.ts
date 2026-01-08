/**
 * Disable console logs in production to prevent users from seeing debug information
 * This runs on the client side only
 */

if (typeof window !== 'undefined') {
  // Check if we're in production by checking hostname (more reliable than NODE_ENV in browser)
  const isProduction = window.location.hostname !== 'localhost' && 
                       !window.location.hostname.includes('127.0.0.1') &&
                       !window.location.hostname.includes('192.168.') &&
                       !window.location.hostname.includes('10.0.');
  
  if (isProduction) {
    // Store original console methods (for potential future use)
    const noop = () => {};
    
    // Override console methods to do nothing in production
    console.log = noop;
    console.warn = noop;
    console.debug = noop;
    console.info = noop;
    console.error = noop;
    console.trace = noop;
    console.table = noop;
    console.group = noop;
    console.groupEnd = noop;
    console.groupCollapsed = noop;
  }
}

