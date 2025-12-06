# Fix Google OAuth Display Text

## Problem
Google OAuth screen shows "to continue to tqtfjyeysbfaankpqrxr.supabase.co" instead of "logging into stattrackr.com"

## Solution Options

### Option 1: Update Google OAuth Consent Screen (Easiest) ⭐

This changes the app name that Google shows, but the domain will still be Supabase.

1. **Go to Google Cloud Console:**
   - https://console.cloud.google.com/
   - Select your project (or create one for StatTrackr)

2. **Navigate to OAuth Consent Screen:**
   - Go to: APIs & Services → OAuth consent screen

3. **Update Application Information:**
   - **Application name:** StatTrackr
   - **User support email:** Your email
   - **Application logo:** Upload StatTrackr logo (optional)
   - **Application home page:** https://stattrackr.com (or your domain)
   - **Privacy policy link:** https://stattrackr.com/privacy (if you have one)
   - **Terms of service link:** https://stattrackr.com/terms (if you have one)

4. **Save and Continue**

**Note:** This changes the app name, but the domain in the URL will still show Supabase. The text will say "StatTrackr wants to access your Google Account" instead of showing the Supabase domain name.

### Option 2: Use Custom Domain with Supabase (Best Long-term)

If you have a custom domain (e.g., stattrackr.com):

1. **Set up Custom Domain in Supabase:**
   - Go to Supabase Dashboard → Settings → API
   - Add custom domain (requires DNS configuration)

2. **Update Redirect URI in Google Cloud Console:**
   - Go to: APIs & Services → Credentials
   - Find your OAuth 2.0 Client ID
   - Update Authorized redirect URIs:
     - Remove: `https://tqtfjyeysbfaankpqrxr.supabase.co/auth/v1/callback`
     - Add: `https://stattrackr.com/auth/v1/callback` (or your custom domain)

3. **Update Supabase Google Provider:**
   - Go to Supabase Dashboard → Authentication → Providers → Google
   - Update redirect URI to match

**Note:** This requires DNS setup and custom domain configuration.

### Option 3: Update Redirect URL in Code (If Using Custom Domain)

If you have your own domain and want to handle OAuth redirects yourself:

1. **Update `.env`:**
   ```env
   NEXT_PUBLIC_SITE_URL=https://stattrackr.com
   ```

2. **Create OAuth callback handler:**
   - Create route: `app/auth/callback/route.ts`
   - Handle OAuth redirect and exchange code for session

3. **Update Google OAuth settings:**
   - Add redirect URI: `https://stattrackr.com/auth/callback`

**Note:** This is more complex and requires handling the OAuth flow yourself.

## Recommended: Option 1 (Easiest)

For now, **Option 1** is the easiest:
- Just update the OAuth consent screen in Google Cloud Console
- Changes the app name users see
- No code changes needed
- No DNS setup required

The domain will still show Supabase, but users will see "StatTrackr wants to access your Google Account" which is much better.

## Steps for Option 1:

1. Go to: https://console.cloud.google.com/apis/credentials/consent
2. Select your project
3. Fill in:
   - **App name:** StatTrackr
   - **User support email:** [your email]
   - **App logo:** [upload if you have one]
   - **App domain:** stattrackr.com
   - **Developer contact:** [your email]
4. Click **Save and Continue**
5. Test by trying Google sign-in again

## Current Code

Your login page uses:
```typescript
const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
redirectTo: `${baseUrl}${HOME_ROUTE}`
```

This redirects to your app after OAuth, but the OAuth screen itself is controlled by Google Cloud Console settings.

