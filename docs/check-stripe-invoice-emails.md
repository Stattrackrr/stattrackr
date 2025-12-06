# How to Check if Stripe Invoices/Receipts are Sent Automatically

## Quick Check

Stripe **automatically sends invoices and receipts by default**, but you should verify the settings.

## 1. Check Stripe Dashboard Settings

### Automatic Email Settings
1. Go to: https://dashboard.stripe.com/settings/billing/automatic
2. Verify these are enabled:
   - ✅ **"Email customers about their invoices"**
   - ✅ **"Email customers about their receipts"**

### Invoice Email Settings
1. Go to: https://dashboard.stripe.com/settings/billing/invoice
2. Check:
   - Email delivery settings
   - Invoice email template
   - Receipt email template

## 2. Test with a Recent Payment

1. Go to: https://dashboard.stripe.com/payments
2. Find a recent successful payment
3. Click on the payment to view details
4. Check the **"Receipt"** tab:
   - Look for **"Email sent"** timestamp
   - If it shows a date/time, the email was sent
   - If it says "Not sent", check your email settings

## 3. Check Invoice History

1. Go to: https://dashboard.stripe.com/invoices
2. Find a recent invoice
3. Click on it to view details
4. Check:
   - **"Email sent"** timestamp (if present, email was sent)
   - **"Status"** (should be "Paid" for successful payments)

## 4. Check Your Webhook Handler

Your webhook at `app/api/webhooks/stripe/route.ts` handles:
- ✅ `invoice.payment_succeeded` - Logs successful payments
- ✅ `invoice.payment_failed` - Logs failed payments

**Note:** Stripe sends emails **automatically** before the webhook fires. Your webhook handler doesn't need to send emails - it just logs the events.

## 5. Test Email Delivery

### Option A: Use Stripe Test Mode
1. Create a test payment in Stripe Dashboard
2. Check if test email is sent to the test customer email

### Option B: Check Customer Email
1. Go to: https://dashboard.stripe.com/customers
2. Find a customer who made a payment
3. Click on them
4. Check their **"Invoices"** or **"Payments"** tab
5. Look for email delivery status

## 6. Common Issues

### Emails Not Being Sent?
- Check spam/junk folder
- Verify customer email is correct in Stripe
- Check if email settings are disabled in Stripe Dashboard
- Verify your Stripe account email settings

### Custom Email Templates?
- Stripe uses default templates by default
- You can customize in: https://dashboard.stripe.com/settings/billing/invoice
- Or use Stripe API to send custom emails via webhook

## 7. Verify in Your Code

Your webhook handler currently just logs invoice events:

```typescript
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  // Optional: Log successful payment, send receipt email, etc.
  console.log('Invoice payment succeeded:', invoice.id);
}
```

**This is fine!** Stripe sends emails automatically. If you want to send **custom** emails, you can add that logic here.

## Summary

✅ **Stripe sends invoices/receipts automatically by default**
✅ **Your webhook receives the events (for logging/tracking)**
✅ **Check Stripe Dashboard to verify email settings are enabled**
✅ **Check a recent payment to see if "Email sent" timestamp exists**

If emails aren't being sent, check:
1. Stripe Dashboard email settings
2. Customer email address is correct
3. Email isn't in spam folder
4. Stripe account email delivery isn't disabled

