import { Resend } from 'resend';

async function sendReferralEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[referral-email] skipped (no RESEND_API_KEY): ${opts.subject} → ${opts.to}`);
    return;
  }
  const from = process.env.RESEND_FROM_EMAIL
    ? `StatTrackr <${process.env.RESEND_FROM_EMAIL}>`
    : 'StatTrackr <onboarding@resend.dev>';
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  if (error) console.error('[referral-email] failed', error.message);
}

export async function emailFriendSignedUp(to: string, friendLabel: string) {
  await sendReferralEmail({
    to,
    subject: 'Your friend just signed up with your referral',
    html: `<p>Good news — <strong>${friendLabel}</strong> signed up with your referral link.</p>
<p>Once their first payment clears, they’ll count toward your discount tier.</p>
<p><a href="${process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.stattrackr.co'}/referral">View your referrals</a></p>`,
  });
}

export async function emailFriendBecameActive(
  to: string,
  friendLabel: string,
  newPercent: number
) {
  await sendReferralEmail({
    to,
    subject: 'Referral bonus unlocked — your discount increased',
    html: `<p><strong>${friendLabel}</strong> is now an active referral.</p>
<p>Your referral discount is now <strong>${newPercent}% off</strong>${
      newPercent > 0
        ? ' (a credit for the rest of this billing period has been applied; the new rate continues from your next renewal)'
        : ''
    }.</p>
<p><a href="${process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.stattrackr.co'}/referral">View your referrals</a></p>`,
  });
}

export async function emailFriendEnded(to: string, friendLabel: string, nextPercent: number) {
  await sendReferralEmail({
    to,
    subject: 'A referral ended — your discount may drop at renewal',
    html: `<p><strong>${friendLabel}</strong> is no longer an active referral.</p>
<p>At your next renewal your referral discount will be <strong>${nextPercent}% off</strong> (no mid-cycle clawback).</p>
<p><a href="${process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.stattrackr.co'}/referral">View your referrals</a></p>`,
  });
}
