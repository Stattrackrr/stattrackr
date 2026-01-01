# Security & User Experience Scan Report
**Date:** January 2026  
**Status:** 🔴 Critical Issues Found

## Executive Summary

After a comprehensive security scan, I've identified **1 CRITICAL** security vulnerability and several HIGH/MEDIUM priority issues that require immediate attention. While many security fixes from the previous audit have been applied, new critical issues were discovered.

---

## 🔴 CRITICAL SECURITY ISSUES

### 1. Admin Endpoint Without Authentication ⚠️ CRITICAL

**File:** `app/api/admin/list-user-bets/route.ts`

**Problem:**
- The endpoint uses `supabaseAdmin` (which bypasses RLS) but has **NO authentication check**
- Anyone can call this endpoint and retrieve **any user's bets** by email
- Complete data breach vulnerability - exposes all user betting data

**Current Code:**
```typescript
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');
    
    // ❌ NO AUTHENTICATION CHECK!
    
    // Find user by email
    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
    const user = authUsers.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    
    // Fetch all bets for this user
    const { data: bets } = await supabaseAdmin
      .from('bets')
      .select('*')
      .eq('user_id', user.id);
    
    return NextResponse.json({ bets }); // Exposes all user data
  }
}
```

**Attack Vector:**
```bash
# Anyone can do this:
curl https://yourdomain.com/api/admin/list-user-bets?email=anyuser@example.com
# Returns all bets for that user - no authentication required!
```

**Severity:** 🔴 CRITICAL  
**Impact:** 
- Complete privacy breach - anyone can view any user's betting history
- GDPR/privacy violation
- User trust destroyed
- Potential legal liability

**Fix Required:**
1. Add authentication check (admin role or service account)
2. Restrict to admin users only
3. Log all access attempts
4. Consider removing if not needed in production

**Recommended Fix:**
```typescript
export async function GET(request: Request) {
  // Check if user is authenticated AND is admin
  const supabase = await createClient();
  const { data: { session }, error: authError } = await supabase.auth.getSession();
  
  if (!session || authError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Check if user has admin role (implement admin check)
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', session.user.id)
    .single();
    
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
  }
  
  // Then proceed with admin operations...
}
```

---

## 🟠 HIGH PRIORITY ISSUES

### 2. Error Message Information Leakage

**Files:**
- `app/api/historical-odds/route.ts:119` - Returns `error.message` directly
- `app/api/admin/list-user-bets/route.ts:95` - Returns `error.message` directly
- `app/api/portal-client/route.ts:75` - Returns `error.message` directly
- Multiple other endpoints

**Problem:**
- Error messages may expose sensitive information (database structure, API keys, internal paths)
- Stack traces visible in production (some endpoints check for production, others don't)

**Examples:**
```typescript
// ❌ Bad - leaks error details
catch (error: any) {
  return NextResponse.json(
    { error: error.message || 'Internal server error' },
    { status: 500 }
  );
}

// ✅ Good - sanitized error
catch (error: any) {
  const isProduction = process.env.NODE_ENV === 'production';
  return NextResponse.json(
    { 
      error: isProduction 
        ? 'An error occurred. Please try again later.'
        : error.message 
    },
    { status: 500 }
  );
}
```

**Severity:** 🟠 HIGH  
**Impact:** Information disclosure, potential for further attacks  
**Fix:** Sanitize all error messages in production, never expose stack traces

---

### 3. Missing Security Headers

**File:** `middleware.ts`

**Problem:**
- No security headers configured (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.)
- Vulnerable to XSS, clickjacking, and other attacks

**Current Code:**
```typescript
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/webhooks/')) {
    return NextResponse.next();
  }
  return NextResponse.next(); // ❌ No security headers
}
```

**Severity:** 🟠 HIGH  
**Impact:** 
- XSS vulnerabilities
- Clickjacking attacks
- Missing security best practices

**Recommended Fix:**
```typescript
export function middleware(request: NextRequest) {
  // Skip webhook endpoints (they need raw access)
  if (request.nextUrl.pathname.startsWith('/api/webhooks/')) {
    return NextResponse.next();
  }
  
  const response = NextResponse.next();
  
  // Security headers
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"
  );
  
  // HSTS (only in production with HTTPS)
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  return response;
}
```

---

### 4. Input Validation Issues

**Files:** Multiple API routes

**Problem:**
- Many endpoints use `parseInt()`, `parseFloat()`, `Number()` without validation
- Could lead to `NaN` values being stored in database
- No length limits on string inputs
- No type validation for query parameters

**Examples:**
```typescript
// ❌ Bad - no validation
const playerId = searchParams.get('playerId');
const playerIdNum = parseInt(playerId); // Could be NaN!

// ❌ Bad - no length limit
const email = searchParams.get('email'); // Could be 10MB string!

// ✅ Good - validated
const playerId = searchParams.get('playerId');
if (!playerId || isNaN(parseInt(playerId))) {
  return NextResponse.json({ error: 'Invalid playerId' }, { status: 400 });
}
const playerIdNum = parseInt(playerId);

// ✅ Better - use Zod
import { z } from 'zod';
const schema = z.object({
  playerId: z.string().regex(/^\d+$/).transform(Number),
  email: z.string().email().max(255),
});
```

**Severity:** 🟠 HIGH  
**Impact:** Invalid data in database, potential DoS, API errors  
**Fix:** Implement Zod/Yup validation for all inputs, add length limits

---

### 5. Service Role Key Overuse

**Files:** 18 files use `supabaseAdmin`

**Problem:**
- `supabaseAdmin` uses `SUPABASE_SERVICE_ROLE_KEY` which bypasses all RLS
- Used in many places where regular client would suffice
- Increases attack surface if any of these endpoints are compromised

**Files Using `supabaseAdmin`:**
1. `app/api/admin/list-user-bets/route.ts` ⚠️ No auth check!
2. `app/api/check-tracked-bets/route.ts` ✅ Has auth
3. `app/api/check-journal-bets/route.ts` ✅ Has auth
4. `app/api/historical-odds/route.ts` ⚠️ No auth check!
5. `app/api/historical-odds/sync/route.ts` - Need to verify
6. And 13 more files...

**Severity:** 🟠 HIGH  
**Impact:** If endpoint is compromised, full database access  
**Fix:** 
- Only use `supabaseAdmin` when absolutely necessary
- Always add authentication/authorization checks
- Use regular `createClient()` with RLS when possible

---

## 🟡 MEDIUM PRIORITY ISSUES

### 6. Development Bypass in Production Code

**Files:**
- `app/api/check-tracked-bets/route.ts:34`
- `app/api/check-journal-bets/route.ts:922`

**Problem:**
- Code allows `x-bypass-auth` header for development
- While it checks `NODE_ENV === 'development'`, this pattern should be removed or clearly documented

**Current Code:**
```typescript
const isDevelopment = process.env.NODE_ENV === 'development';
const bypassAuth = isDevelopment && request.headers.get('x-bypass-auth') === 'true';
```

**Severity:** 🟡 MEDIUM  
**Impact:** Low risk since it's gated by NODE_ENV, but could be misconfigured  
**Fix:** Remove bypass or move to test-only endpoints

---

### 7. Placeholder Environment Variables

**Files:**
- `lib/supabaseClient.ts:4-5`
- `app/api/portal-client/route.ts:9-10`

**Problem:**
- Placeholder values might mask configuration issues
- Should fail fast instead

**Current Code:**
```typescript
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key-' + 'x'.repeat(100)
```

**Severity:** 🟡 MEDIUM  
**Impact:** Silent failures if env vars not set  
**Fix:** Remove placeholders, throw error if missing (or validate in `lib/env.ts`)

---

### 8. Inconsistent Error Handling

**Problem:**
- Some endpoints sanitize errors in production, others don't
- Inconsistent error response formats
- Some return stack traces, others don't

**Severity:** 🟡 MEDIUM  
**Impact:** Inconsistent user experience, potential information leakage  
**Fix:** Standardize error handling middleware

---

### 9. Missing Rate Limiting on Some Endpoints

**Files to Check:**
- `/api/admin/list-user-bets` - No rate limiting
- `/api/historical-odds` - No rate limiting (POST endpoint)
- `/api/reset-bets` - No rate limiting (though has auth)

**Severity:** 🟡 MEDIUM  
**Impact:** DoS potential, API abuse  
**Fix:** Add rate limiting to all public endpoints

---

## 🟢 LOW PRIORITY / USER EXPERIENCE ISSUES

### 10. No Input Sanitization for XSS

**Note:** React automatically escapes content, but:
- User input stored in database should be sanitized
- Check for `dangerouslySetInnerHTML` usage (found 5 files mentioning it)

**Severity:** 🟢 LOW (React protects by default)  
**Fix:** Audit `dangerouslySetInnerHTML` usage, sanitize database inputs

---

### 11. Missing CORS Configuration

**Problem:**
- No explicit CORS configuration
- Next.js handles this by default, but should be explicit for API routes

**Severity:** 🟢 LOW  
**Fix:** Add explicit CORS headers if needed for API consumption

---

### 12. Error Messages Not User-Friendly

**Problem:**
- Technical error messages shown to users
- No user-friendly error messages

**Example:**
```typescript
// ❌ Technical error
{ error: 'PGRST116: No rows found' }

// ✅ User-friendly error
{ error: 'No data found. Please try again.' }
```

**Severity:** 🟢 LOW  
**Impact:** Poor user experience  
**Fix:** Map technical errors to user-friendly messages

---

## ✅ SECURITY MEASURES CONFIRMED WORKING

1. ✅ **RLS (Row Level Security)** - Properly configured in Supabase
2. ✅ **Cron Authentication** - Cron endpoints properly secured
3. ✅ **Bet Update Endpoints** - Fixed authentication bypass
4. ✅ **Rate Limiting** - Implemented on most endpoints
5. ✅ **No Hardcoded Secrets** - All removed (per previous audit)
6. ✅ **Console Error Override** - Fixed (build-time only)
7. ✅ **Environment Validation** - `lib/env.ts` available

---

## 📋 IMMEDIATE ACTION ITEMS

### 🔴 URGENT (Do Today)
1. **Fix Admin Endpoint** - Add authentication to `/api/admin/list-user-bets`
2. **Sanitize Error Messages** - Fix error message leakage in production

### 🟠 HIGH PRIORITY (This Week)
3. **Add Security Headers** - Implement in `middleware.ts`
4. **Add Input Validation** - Use Zod for all API inputs
5. **Audit Service Role Usage** - Review all `supabaseAdmin` usage

### 🟡 MEDIUM PRIORITY (This Month)
6. **Standardize Error Handling** - Create error handling middleware
7. **Add Rate Limiting** - To remaining unprotected endpoints
8. **Remove Development Bypasses** - Or document clearly

---

## 🔍 VERIFICATION CHECKLIST

After fixes are applied, verify:

- [ ] `/api/admin/list-user-bets` requires authentication
- [ ] All error messages sanitized in production
- [ ] Security headers present in responses
- [ ] Input validation on all user inputs
- [ ] Rate limiting on all public endpoints
- [ ] No sensitive data in error responses
- [ ] All `supabaseAdmin` usage has proper auth checks

---

## 📊 SUMMARY

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 Critical | 1 | **NEEDS IMMEDIATE FIX** |
| 🟠 High | 4 | Needs attention this week |
| 🟡 Medium | 4 | Can be addressed this month |
| 🟢 Low | 3 | Nice to have improvements |

**Total Issues Found:** 12 (1 critical, 4 high, 4 medium, 3 low)

---

**Report Generated:** January 2026  
**Next Review:** After critical issues are fixed

