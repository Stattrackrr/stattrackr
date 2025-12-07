# Trial Start Email Setup

## Overview

The webhook handler now detects when a free trial starts and can send an email notification to the user.

## Current Implementation

✅ **Trial Detection:**
- Detects when `subscription.status === 'trialing'`
- Checks if it's a new trial (user hasn't used trial before)
- Gets user email from profile

✅ **Email Handler:**
- Function `sendTrialStartEmail()` is ready
- Currently logs the email (ready for email service integration)
- Handles errors gracefully (won't break webhook if email fails)

## Setup Options

### Option 1: Use Stripe's Built-in Emails (Easiest) ⭐

Stripe can send trial-related emails automatically:

1. Go to: https://dashboard.stripe.com/settings/billing/automatic
2. Enable: **"Send a reminder email 7 days before a free trial ends"**
3. Stripe will send emails automatically when trials start/end

**Pros:**
- No code changes needed
- Stripe handles email delivery
- Professional templates

**Cons:**
- Less customization
- Can't fully customize trial start email

### Option 2: Use Resend (Recommended for Custom Emails) ⭐⭐

Resend is a modern email API service:

1. **Sign up:** https://resend.com
2. **Get API key** from dashboard
3. **Add to `.env`:**
   ```
   RESEND_API_KEY=re_xxxxxxxxxxxxx
   ```
4. **Install Resend:**
   ```bash
   npm install resend
   ```
5. **Update webhook handler:**
   - Uncomment the Resend code in `sendTrialStartEmail()`
   - Customize the email template

**Example Resend Integration:**

```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendTrialStartEmail(userEmail: string, subscription: Stripe.Subscription) {
  const trialEndDate = subscription.trial_end 
    ? new Date(subscription.trial_end * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : '7 days from now';

  try {
    await resend.emails.send({
      from: 'StatTrackr <noreply@stattrackr.com>',
      to: [userEmail],
      subject: '🎉 Your 7-Day Free Trial Has Started!',
      html: `
        <h1>Welcome to StatTrackr Pro!</h1>
        <p>Your 7-day free trial has started. Enjoy full access to all Pro features.</p>
        <p><strong>Trial ends:</strong> ${trialEndDate}</p>
        <p>No credit card will be charged until your trial ends.</p>
        <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/nba/research/dashboard">Get Started →</a></p>
      `,
    });
    
    console.log(`✅ Trial start email sent to ${userEmail}`);
  } catch (error) {
    console.error('Failed to send trial start email:', error);
  }
}
```

**Pros:**
- Full control over email content
- Modern API
- Good deliverability
- Free tier available

**Cons:**
- Requires API key setup
- Need to write email templates

### Option 3: Use SendGrid

Similar to Resend:

1. Sign up: https://sendgrid.com
2. Get API key
3. Add `SENDGRID_API_KEY` to `.env`
4. Install: `npm install @sendgrid/mail`
5. Update `sendTrialStartEmail()` function

### Option 4: Use Nodemailer (SMTP)

For custom SMTP servers:

1. Install: `npm install nodemailer`
2. Configure SMTP settings in `.env`
3. Update `sendTrialStartEmail()` function

## Testing

### Test Trial Start Email:

1. **Create a test subscription with trial:**
   - Use Stripe test mode
   - Create a checkout session with trial
   - Complete checkout

2. **Check webhook logs:**
   - Look for: `📧 Trial start email should be sent to: [email]`
   - Verify email address is correct

3. **If using Resend/SendGrid:**
   - Check email service dashboard for delivery status
   - Check user's inbox (and spam folder)

## Email Template Ideas

### Trial Start Email Content:

**Subject:** 🎉 Your 7-Day Free Trial Has Started!

**Body:**
- Welcome message
- Trial end date
- What they get access to
- Link to dashboard
- Reminder that no card is charged until trial ends

**Example:**
```
Welcome to StatTrackr Pro!

Your 7-day free trial has started. You now have full access to:

✅ Advanced NBA research tools
✅ Similar players analysis
✅ Historical betting data
✅ Real-time odds tracking
✅ And much more!

Trial ends: [DATE]
No credit card will be charged until your trial ends.

[Get Started Button] → Dashboard
```

## Current Status

✅ **Code is ready** - `sendTrialStartEmail()` function exists
✅ **Trial detection works** - Detects when trial starts
✅ **Email address retrieved** - Gets email from profile
⏳ **Email service needed** - Choose Option 1, 2, 3, or 4 above

## Next Steps

1. **Choose an email service** (recommend Resend for custom emails)
2. **Add API key** to `.env`
3. **Uncomment/update** email code in `sendTrialStartEmail()`
4. **Test** with a trial subscription
5. **Customize** email template to match your brand

## Files Modified

- `app/api/webhooks/stripe/route.ts`
  - Added `sendTrialStartEmail()` function
  - Updated `handleSubscriptionUpdated()` to call email function
  - Updated `handleCheckoutCompleted()` to send email on trial start


