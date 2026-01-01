# Browser Logs Configuration

## Overview

Browser console logs are now **suppressed in production** for public users to prevent information leakage and improve performance. However, logs are still available for you as the developer/admin.

---

## How It Works

### Production (Public Users)
- ✅ All `console.log`, `console.warn`, `console.info`, `console.debug` are **suppressed**
- ✅ `console.error` shows generic "An error occurred" message
- ✅ Clean console for public users

### Development
- ✅ All logs work normally
- ✅ Full debugging capabilities

### Production (Admin/Developer Access)
Logs can be enabled in production using one of these methods:

---

## Methods to Enable Logs in Production

### Method 1: Secret Query Parameter (Recommended)
Add a secret query parameter to the URL:
```
https://stattrackr.co/?debug=your-secret-key
```

**Setup:**
1. Add to your `.env.local`:
   ```bash
   NEXT_PUBLIC_DEBUG_SECRET=your-secret-key-here
   ```
2. Add to production environment variables (Vercel)
3. Use the same key in the URL

**Benefits:**
- Easy to share with team members
- Can be bookmarked
- Automatically enables logs and saves to localStorage

---

### Method 2: Browser Console (LocalStorage)
Open browser console and run:
```javascript
localStorage.setItem('stattrackr_admin_logs', 'true');
```
Then refresh the page.

To disable:
```javascript
localStorage.removeItem('stattrackr_admin_logs');
```

---

### Method 3: Global Logger Functions
Open browser console and run:
```javascript
// Enable logs
window.stattrackrLogger.enable();
// or
window.enableLogs();

// Disable logs
window.stattrackrLogger.disable();
// or
window.disableLogs();
```

---

## Implementation Details

### Files Created/Modified
- ✅ `lib/clientLogger.ts` - NEW - Client-side logger utility that overrides console methods
- ✅ `app/layout-client.tsx` - Import logger to initialize (console overrides happen at module load)

### How It Works
1. Logger module loads early in the app lifecycle
2. In production, console methods are overridden to check `shouldLog()` on each call
3. `shouldLog()` checks:
   - Development mode (localhost) → always enabled
   - localStorage flag → enabled if set
   - Query parameter → enabled if secret matches
4. If none match, logs are suppressed

---

## Security

- ✅ Public users cannot see logs
- ✅ No sensitive information exposed in console
- ✅ Admin access requires secret key or manual enable
- ✅ Logs can be disabled at any time
- ✅ Errors are sanitized to show generic messages only

---

## Testing

### Test in Development
```bash
npm run dev
# Logs should appear normally
```

### Test in Production
1. Build production: `npm run build && npm start`
2. Visit site - logs should be suppressed
3. Add `?debug=your-secret-key` - logs should appear
4. Check localStorage - `stattrackr_admin_logs` should be `true`

---

**Setup Complete!** Browser logs are now suppressed for public users but available for you. ✅

