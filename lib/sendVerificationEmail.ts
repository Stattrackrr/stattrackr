import { Resend } from "resend";

/**
 * Sends a 6-digit verification code to the user's email.
 * Requires RESEND_API_KEY and RESEND_FROM_EMAIL (from a Resend-verified domain).
 */
export async function sendVerificationCodeEmail(
  to: string,
  code: string
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set. Add it to .env.local and restart the dev server." };
  }
  const from = process.env.RESEND_FROM_EMAIL
    ? `StatTrackr <${process.env.RESEND_FROM_EMAIL}>`
    : "StatTrackr <onboarding@resend.dev>";

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    subject: "Your StatTrackr verification code",
    html: `
      <h2>Verify your email</h2>
      <p>Your 6-digit verification code is:</p>
      <p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${code}</p>
      <p>Enter this code in the app to activate your account. The code expires in 15 minutes.</p>
      <p>If you didn't sign up for StatTrackr, you can ignore this email.</p>
    `,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
