# Password reset setup (6-digit code)

Password reset uses a 6-digit code sent by email: user enters email → receives code → enters code → sets new password. No link to click.

## 1. Supabase email template (required for 6-digit code)

1. Go to **Authentication → Email Templates**.
2. Open the **Magic Link** template (used for `signInWithOtp`).
3. Ensure the email body includes the **OTP token** so the user gets a 6-digit code, e.g.:

   ```html
   <h2>Your reset code</h2>
   <p>Enter this code on the site: <strong>{{ .Token }}</strong></p>
   ```

   The variable `{{ .Token }}` is the 6-digit code. Without it, the user only gets a magic link and the code flow won’t work.

## 2. Flow

1. User clicks **Forgot password?** and enters their email.
2. We call `signInWithOtp({ email, options: { shouldCreateUser: false } })` so only existing users receive a code.
3. User receives the email with the 6-digit code.
4. User enters the code and clicks **Verify and set new password**.
5. We call `verifyOtp({ email, token, type: 'email' })` and get a session.
6. User is redirected to `/auth/update-password` where they set a new password; we call `updateUser({ password })`.

No redirect URLs or link handling are required for this flow.
