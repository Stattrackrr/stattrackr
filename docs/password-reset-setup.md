# Password reset setup

If users keep ending up on the login page after clicking the reset link, the tokens in the URL are being lost (usually due to a redirect).

## 1. Supabase dashboard

1. Go to **Authentication → URL configuration**.
2. Set **Site URL** to your canonical URL **without** `www`, e.g. `https://stattrackr.co`.
3. In **Redirect URLs**, include:
   - `https://stattrackr.co/auth/update-password`
   - (and any other auth URLs you use)

Using the same canonical URL (no `www`) everywhere avoids a redirect that drops the hash.

## 2. After deploy

When you change the redirect URL or deploy fixes:

1. Request a **new** password reset (Forgot password? → enter email).
2. Use the link from **that** email only. Old emails may point at `www` or an old path.
3. Open the link in the **same browser** (or paste the full link into the address bar). Don’t open from an in-app browser if it strips the URL.

## How it works

- The reset link goes to Supabase, then Supabase redirects to your site with tokens in the URL hash.
- The app captures that hash (inline script + sessionStorage) and establishes the session, then shows the “Set new password” form.
- If the link sent users to `www` and your host redirects `www` → non-`www`, the hash is lost. Using the non-`www` URL in Supabase and in our `redirectTo` avoids that.
