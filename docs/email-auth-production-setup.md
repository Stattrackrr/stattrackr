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
3. Copy the key (`re_...`) — you’ll use it only in **Supabase**, not in your Next.js env.

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

This is used as a fallback for auth emails when `emailRedirectTo` is not specified.

---

## 5. (Optional) Customize Auth Email Templates

1. Supabase → **Authentication** → **Email Templates**
2. Edit:
   - **Confirm signup** — subject/body for the verification link
   - **Magic Link** / **Change Email Address** / **Reset Password** if you use them

Use the placeholders Supabase provides (e.g. `{{ .ConfirmationURL }}`, `{{ .Token }}`) so links keep working.

---

## 6. Checklist

- [ ] Resend: domain verified
- [ ] Resend: API key created
- [ ] Supabase: Custom SMTP enabled with Resend (Host, Port, User, Password, Sender email/name)
- [ ] Supabase: **Confirm email** enabled on the Email provider
- [ ] Vercel: `NEXT_PUBLIC_SITE_URL` set to your production URL
- [ ] Supabase: **Site URL** (Auth → URL Configuration) set to your production URL
- [ ] (Optional) Supabase: “Confirm signup” (and other) email templates updated

---

## 7. Troubleshooting

| Issue | What to check |
|-------|----------------|
| No verification email | Supabase **Auth** → **Logs** for SMTP/Resend errors; Resend **Logs** for bounces or failures |
| “Sender not allowed” / 450 | Sender address must be from a Resend‑verified domain |
| Links go to wrong site | `NEXT_PUBLIC_SITE_URL` in production and `emailRedirectTo` in sign‑up (currently `/home`) |
| Resend “rate limit” | Resend plan limits; Supabase default SMTP is only for testing (≈2–4/hr) — custom SMTP avoids that |

---

## 8. App Behaviour (Reference)

- **Sign up with Confirm email ON:** After `signUp`, if Supabase does not return a session, the app shows “Check your email” and “Resend verification email”. No auto sign‑in.
- **Sign up with Confirm email OFF:** App still signs in and redirects to `/home` when Supabase returns a session.
- **Sign in before verifying:** Error: “Please verify your email before signing in” + “Resend verification email”.
- **Resend:** Uses `supabase.auth.resend({ type: 'signup', email })`; Supabase sends the email via your configured SMTP (Resend).

---

## 9. Files

- `app/login/page.tsx` — sign up, sign in, “Check your email”, resend
- `docs/email-auth-production-setup.md` — this guide
