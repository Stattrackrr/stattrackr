# Email Authentication — Production Setup

This guide configures **email verification** for sign‑up/sign‑in using **Resend SMTP** and **Supabase**, so confirmation emails are reliable and from your domain.

---

## 1. Resend (Domain + API Key)

### 1.1 Domain

1. [Resend](https://resend.com) → **Domains** → **Add Domain**
2. On the **Domain** step:
   - **Name:** Your root domain, e.g. `stattrackr.com` or `stattrackr.co` (no `https://` or path). A subdomain like `mail.stattrackr.com` is also fine if you prefer to send from it.
   - **Region:** Choose a region close to your users (e.g. a US region like **Ohio** or **N. Virginia** if most users are in the US; **Tokyo** is fine for Asia). This affects where Resend processes mail.
   - **> Advanced options — Return path:** Leave blank to use the default. Resend will use the `send` subdomain (e.g. `send.stattrackr.co`) for bounces; the DNS Records step will include the MX/SPF for it. Only set a custom return-path subdomain (e.g. `bounce` or `return`) if `send` is already used by another service. Use letters, numbers, or hyphens only; max 63 chars.
   - Click **+ Add Domain**.
3. On the **DNS Records** step (“Fill in your DNS Records”), add each record at your DNS provider (Cloudflare, Namecheap, Vercel, etc.):
   - **Domain Verification (DKIM):** TXT, Name `resend._domainkey`, Content = the long key Resend shows. Required.
   - **Enable Sending (SPF):** keep ON. Add:
     - **MX:** Name `send`, Content `feedback-smtp.us-east-1.amazonses.com` (or the value Resend shows), Priority `10`.
     - **TXT:** Name `send`, Content `v=spf1 include:amazonses.com ~all` (or the value Resend shows). Both required for sending.
   - **DMARC (optional but recommended):** TXT, Name `_dmarc`, Content `v=DMARC1; p=none;`. Helps with deliverability; `p=none` is a soft start.
   - **Enable Receiving:** leave OFF for auth-only (you’re not receiving at Resend).
   - **Name format:** Use the exact **Name** Resend gives (e.g. `resend._domainkey`, `send`, `_dmarc`). Many DNS hosts auto-append your domain; if yours requires the full host, use e.g. `resend._domainkey.stattrackr.co`, `send.stattrackr.co`, `_dmarc.stattrackr.co`. Copy **Content** exactly.
4. At your DNS provider, save each record. Then in Resend click **I've added the records**.
5. Wait until the domain status is **Verified** (often a few minutes; can be up to 48h). Resend will re-check automatically.

**Testing:** Resend’s `onboarding.resend.dev` works without a custom domain but is not suitable for production.

### 1.2 API Key

1. Resend → **API Keys** → **Create API Key**
2. Name it e.g. `Supabase Auth`
3. Copy the key (`re_...`). You’ll use it in **Supabase** (SMTP) and in **Next.js** (`RESEND_API_KEY`) for the 6‑digit OTP flow.

---

## 2. Supabase — Custom SMTP (Resend)

1. [Supabase](https://supabase.com/dashboard) → your project → **Project Settings** (gear) → **Authentication**
2. Find **SMTP Settings**
3. **Enable Custom SMTP** = ON
4. Use:

   | Field          | Value                     |
   |----------------|---------------------------|
   | **Sender email** | `noreply@yourdomain.com` (must be from the Resend‑verified domain) |
   | **Sender name**  | `StatTrackr` (or your app name) |
   | **Host**         | `smtp.resend.com`         |
   | **Port**         | `465`                     |
   | **Username**     | `resend`                  |
   | **Password**     | Your Resend API key (`re_...`) |

5. **Save**

If you use a subdomain for sending (e.g. `mail.stattrackr.com`), verify that in Resend and use an address like `noreply@mail.stattrackr.com` if required.

---

## 3. Supabase — Confirm Email

1. **Authentication** → **Providers** → **Email**
2. Turn **Confirm email** (or **Enable email confirmations**) **ON**
3. Save

After this, new sign‑ups get a confirmation email and must click the link before they can sign in with password. The app already:

- Shows “Check your email” after sign‑up when confirmation is required
- Supports “Resend verification email”
- Handles “Email not confirmed” on sign‑in with a resend option

---

## 4. Production URL for Redirects

Confirmation and resend links use `emailRedirectTo`. The app uses:

```
process.env.NEXT_PUBLIC_SITE_URL || window.location.origin
```

**Vercel (or your host):**

1. **Project** → **Settings** → **Environment Variables**
2. Add:
   - **Name:** `NEXT_PUBLIC_SITE_URL`
   - **Value:** `https://yourdomain.com` (no trailing slash)
   - **Environments:** Production (and Preview if you want)

Sign‑up and resend both use `${NEXT_PUBLIC_SITE_URL}/home`. After the user confirms, they land on `/home` with a session.

**Supabase (recommended):**

1. **Project Settings** → **Authentication** → **URL Configuration**
2. Set **Site URL** to `https://yourdomain.com` (no trailing slash).
3. In **Redirect URLs**, add:
   - `http://localhost:3000/auth/callback` (for local dev)
   - `https://yourdomain.com/auth/callback` (for production)

The magic link from the 6‑digit verify flow redirects to `/auth/callback`, which sets the session and then sends the user to `/home`.

---

## 5. 6‑digit verification code (custom OTP)

The app sends a **6‑digit numeric code** via Resend (not Supabase’s link). Supabase’s **Confirm signup** template is not used for email/password sign‑up.

### 5.1 Migration

Run the migration so the app can store and verify 6‑digit codes:

1. In Supabase: **SQL Editor** → **New query**
2. Run the contents of `migrations/email_verification_codes_6digit.sql`

This creates `email_verification_codes` and `get_auth_user_id_by_email`.

### 5.2 Next.js environment variables

In **Vercel** (or your host) and in `.env.local`:

| Name | Value |
|------|-------|
| `RESEND_API_KEY` | Your Resend API key (`re_...`). Same key as Supabase SMTP. |
| `RESEND_FROM_EMAIL` | Sender address from a Resend‑verified domain, e.g. `noreply@yourdomain.com` |

The 6‑digit email is sent by `lib/sendVerificationEmail.ts` via the Resend API. If `RESEND_FROM_EMAIL` is unset, it falls back to `onboarding@resend.dev` (fine for local dev only).

### 5.3 (Optional) Customize Auth Email Templates

If you use **Magic Link**, **Change Email**, or **Reset Password**, edit those in Supabase → **Authentication** → **Email Templates**. The **Confirm signup** template is not used for email/password sign‑ups in the 6‑digit flow.

---

## 6. Checklist

- [ ] Resend: domain verified
- [ ] Resend: API key created
- [ ] Supabase: Custom SMTP enabled with Resend (Host, Port, User, Password, Sender email/name)
- [ ] Supabase: **Confirm email** enabled on the Email provider
- [ ] Migration: `migrations/email_verification_codes_6digit.sql` applied
- [ ] Next.js / Vercel: `RESEND_API_KEY` and `RESEND_FROM_EMAIL` set
- [ ] Vercel: `NEXT_PUBLIC_SITE_URL` set to your production URL
- [ ] Supabase: **Site URL** (Auth → URL Configuration) set to your production URL

---

## 7. Troubleshooting

| Issue | What to check |
|-------|----------------|
| No verification email | Supabase **Auth** → **Logs** for SMTP/Resend errors; Resend **Logs** for bounces or failures |
| “Sender not allowed” / 450 | Sender address must be from a Resend‑verified domain |
| Links go to wrong site | `NEXT_PUBLIC_SITE_URL` in production and `emailRedirectTo` in sign‑up (currently `/home`) |
| Resend “rate limit” | Resend plan limits; Supabase default SMTP is only for testing (≈2–4/hr) — custom SMTP avoids that |
| “Invalid or expired code” (6‑digit) | Enter the exact 6 digits from the latest email; each resend invalidates the previous code; code expires in 15 minutes |
| “Failed to send verification email” | `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in Next.js; `RESEND_FROM_EMAIL` must be from a Resend‑verified domain |

---

## 8. App Behaviour (Reference)

- **Sign up (6‑digit flow):** `POST /api/auth/signup-with-otp` creates the user (unconfirmed), stores a 6‑digit code, and sends it via Resend. The app shows “Check your email” with an **Enter 6‑digit code** field, **Verify**, and **Resend code**. No auto sign‑in.
- **Verify:** `POST /api/auth/verify-email-otp` checks the code, confirms the email in Supabase, and returns a magic link to sign in. The user is redirected to `/home` with a session.
- **Sign in before verifying:** `signInWithPassword` returns “Email not confirmed”. The app shows a 6‑digit code input, **Verify code**, and **Resend code**.
- **Resend:** `POST /api/auth/resend-email-otp` generates a new 6‑digit code, upserts it, and sends it via Resend.

---

## 9. Files

- `app/login/page.tsx` — sign up, sign in, “Check your email”, 6‑digit code, verify, resend
- `app/api/auth/signup-with-otp/route.ts` — create user, store 6‑digit code, send via Resend
- `app/api/auth/verify-email-otp/route.ts` — verify code, confirm email, return magic link
- `app/api/auth/resend-email-otp/route.ts` — resend 6‑digit code
- `lib/sendVerificationEmail.ts` — send 6‑digit email via Resend
- `migrations/email_verification_codes_6digit.sql` — table and `get_auth_user_id_by_email`
- `docs/email-auth-production-setup.md` — this guide
