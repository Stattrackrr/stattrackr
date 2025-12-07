# Stripe Email Settings Checklist

## Settings to Enable for Automatic Invoice/Receipt Emails

Based on your Stripe Dashboard settings page, here are the key settings to enable:

### 1. Customer Emails Section ✅

Enable these notifications:
- ✅ **Send emails about upcoming renewals** - Notifies customers before subscription renews
- ✅ **Send emails when card payments fail** - Important for failed payment recovery
- ✅ **Send emails when bank debit payments fail** - For ACH/bank payments
- ✅ **Send a reminder email 7 days before a free trial ends** - Helps with trial conversion

### 2. Manage Invoices Sent to Customers ✅

Enable these:
- ✅ **Send finalised invoices and credit notes to customers** - Sends invoices automatically
- ✅ **Send reminders if a recurring invoice hasn't been paid** - Payment reminders

### 3. Important Notes

**Receipts are sent automatically by default:**
- Stripe automatically sends receipts for successful payments
- You don't need to enable anything special for basic receipts
- Receipts are sent immediately after successful payment

**Invoices vs Receipts:**
- **Receipts** = Confirmation of payment (sent automatically)
- **Invoices** = Bill to be paid (sent when invoice is finalized)
- For subscriptions, both are typically sent automatically

### 4. How to Verify Emails Are Being Sent

1. **Check a Recent Payment:**
   - Go to: https://dashboard.stripe.com/payments
   - Click on any successful payment
   - Check the **"Receipt"** tab
   - Look for **"Email sent"** timestamp

2. **Check Invoice History:**
   - Go to: https://dashboard.stripe.com/invoices
   - Click on any invoice
   - Check for **"Email sent"** timestamp

3. **Check Customer Email:**
   - Go to: https://dashboard.stripe.com/customers
   - Click on a customer
   - Check their **"Invoices"** or **"Payments"** tab
   - Look for email delivery status

### 5. Recommended Settings Summary

**Must Enable:**
- ✅ Send finalised invoices and credit notes to customers
- ✅ Send emails about upcoming renewals
- ✅ Send emails when card payments fail

**Nice to Have:**
- ✅ Send a reminder email 7 days before a free trial ends
- ✅ Send reminders if a recurring invoice hasn't been paid

### 6. Your Webhook Handler

Your webhook at `app/api/webhooks/stripe/route.ts` handles:
- `invoice.payment_succeeded` - Logs successful payments
- `invoice.payment_failed` - Logs failed payments

**Note:** Stripe sends emails **before** the webhook fires, so your webhook just needs to log/receive the events.

### 7. Testing

To test if emails are working:
1. Make a test payment in Stripe Dashboard
2. Check the payment's "Receipt" tab for "Email sent" timestamp
3. Check the test customer's email inbox (and spam folder)

### 8. Troubleshooting

**If emails aren't being sent:**
1. Check spam/junk folder
2. Verify customer email is correct in Stripe
3. Check if email settings are disabled
4. Verify Stripe account email delivery isn't paused
5. Check Stripe Dashboard → Settings → Email delivery

**If you want custom email templates:**
- Go to: https://dashboard.stripe.com/settings/billing/invoice
- Customize invoice and receipt email templates
- Or use Stripe API to send custom emails via webhook

## Summary

✅ **Stripe sends receipts automatically by default** (no settings needed)
✅ **Enable "Send finalised invoices" for invoice emails**
✅ **Enable renewal and failure email notifications**
✅ **Check a recent payment to verify emails are being sent**

The most important setting is: **"Send finalised invoices and credit notes to customers"** - this ensures invoices are emailed automatically.


