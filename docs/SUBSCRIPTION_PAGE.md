# Subscription Management Page

## Overview
A clean, Stripe-inspired subscription management page located at `/subscription`. This page provides users with a comprehensive view of their subscription details, payment methods, billing information, and invoice history.

## Design Philosophy
The page is inspired by Stripe's billing interface, emphasizing:
- **Simplicity**: Clean, minimalist design with clear information hierarchy
- **Clarity**: All subscription details are easy to find and understand
- **Professional**: Trustworthy appearance that inspires confidence in payment management

## Features

### 1. Current Subscription Section
- Displays the active subscription plan name (e.g., "StatTrackr")
- Shows pricing: **US$14.99 per month**
- Displays next billing date
- Action buttons:
  - **Update subscription** - Modify subscription plan
  - **Cancel subscription** - Cancel with confirmation dialog

### 2. Payment Method Section
- Displays saved payment methods with card brand logos
- Shows masked card number (e.g., "Visa •••• 9150")
- Shows expiration date
- Options menu for each payment method
- **Add payment method** button for adding new cards

### 3. Billing Information Section
- Name
- Email address
- Billing address
- **Update information** button to modify details

### 4. Invoice History Section
- Chronological list of all invoices
- Each invoice shows:
  - Date (e.g., "7 Oct 2025")
  - Amount charged (e.g., "$14.99")
  - Payment status badge ("Paid" in green)
  - Plan name
- Search functionality (icon present)

### 5. Footer
- "Powered by Stripe" branding
- Links to:
  - Learn more about Stripe Billing
  - Terms of Service
  - Privacy Policy

## Color Scheme

### Background
- Dark navy blue: `#0a0e27`
- White card background with clean borders

### Text
- Primary (on white): `#111827` (gray-900)
- Secondary: `#6b7280` (gray-600)
- Labels: `#9ca3af` (gray-500)

### Accent Colors
- Primary action (blue): `#2563eb` (blue-600)
- Success (green): `#10b981` for "Paid" badges
- Card brand colors: Visa blue `#1434CB`, Mastercard red/orange

## Routes

### Main Route
- **Path**: `/subscription`
- **Component**: `app/subscription/page.tsx`
- **Auth**: Required (redirects to `/login` if not authenticated)

### Navigation Links
- From Account Settings: "Manage Subscription" button
- Direct access via URL

## Data Structure

### User Metadata (from Supabase)
```typescript
{
  subscription_status: 'active' | 'inactive' | 'canceled',
  subscription_plan: string,           // e.g., "StatTrackr Premium"
  next_billing_date: string,          // e.g., "7 November 2025"
  billing_address: string,             // e.g., "AU"
  username: string,
  first_name: string,
  email: string
}
```

### Invoice Structure
```typescript
{
  date: string,        // e.g., "7 Oct 2025"
  amount: string,      // e.g., "$14.99"
  status: string,      // e.g., "Paid"
  plan: string         // e.g., "StatTrackr"
}
```

## TODO: Payment Integration

The following handlers need to be implemented with your payment processor:

### 1. Update Subscription
```typescript
const handleUpdateSubscription = () => {
  // TODO: Integrate with Stripe/PayPal subscription update API
  // - Allow user to change plan (monthly/annual/etc.)
  // - Show pricing preview
  // - Process plan change
};
```

### 2. Cancel Subscription
```typescript
const handleCancelSubscription = () => {
  // TODO: Integrate with Stripe/PayPal cancellation API
  // - Confirm cancellation with user
  // - Process cancellation
  // - Update user metadata
  // - Show cancellation confirmation
};
```

### 3. Add Payment Method
```typescript
const handleAddPaymentMethod = () => {
  // TODO: Integrate with Stripe Elements or PayPal
  // - Show payment method form
  // - Tokenize card information
  // - Save to customer profile
  // - Update UI with new method
};
```

### 4. Update Billing Information
```typescript
const handleUpdateBillingInfo = () => {
  // TODO: Open modal or navigate to edit form
  // - Update name, email, address
  // - Sync with payment processor
  // - Update Supabase user metadata
};
```

## Responsive Design

The page is fully responsive:
- **Desktop**: Full layout with all sections visible
- **Tablet**: Stacked sections, maintained spacing
- **Mobile**: Single column layout, touch-friendly buttons

## Implementation Notes

### Mock Data
Currently using mock invoice data. Replace with actual data from your backend:

```typescript
// Current (mock):
const invoices = [
  { date: "7 Oct 2025", amount: "$14.99", status: "Paid", plan: subscriptionPlan },
  // ...
];

// Replace with API call:
const { data: invoices } = await supabase
  .from('invoices')
  .select('*')
  .eq('user_id', user.id)
  .order('created_at', { ascending: false });
```

### Card Icons
Currently using inline SVG for Visa/Mastercard logos. Consider:
- Using a card brand detection library
- Supporting more payment methods (Amex, Discover, etc.)
- Loading actual card brand from payment processor

## Testing Checklist

- [ ] Page loads correctly for authenticated users
- [ ] Redirects to login for unauthenticated users
- [ ] All user data displays correctly
- [ ] "Update subscription" button triggers correct flow
- [ ] "Cancel subscription" shows confirmation dialog
- [ ] "Add payment method" opens correct interface
- [ ] "Update information" allows editing billing details
- [ ] Invoice history displays correctly
- [ ] All links in footer work
- [ ] Responsive design works on mobile
- [ ] Dark background contrasts well with white card
- [ ] Back button returns to account page

## Related Files

- `/app/subscription/page.tsx` - Main subscription page component
- `/app/account/page.tsx` - Account settings with link to subscription
- `/lib/subscription.ts` - Subscription utility functions
- `/components/navigation.tsx` - Site navigation

## Future Enhancements

1. **Invoice Download** - Add PDF download for each invoice
2. **Payment History Graph** - Visual representation of payment history
3. **Usage Statistics** - Show feature usage if applicable
4. **Proration Preview** - Show proration when changing plans
5. **Multiple Payment Methods** - Support for backup payment methods
6. **Auto-reload** - Automatically refresh when subscription changes
7. **Email Preferences** - Manage billing email notifications
8. **Coupon/Discount Codes** - Apply promotional codes
