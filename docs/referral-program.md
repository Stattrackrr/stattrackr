# Refer-a-friend program

## Setup

1. Run the SQL migration:

```bash
# apply migrations/create_referral_program.sql in Supabase SQL editor
```

2. Create Stripe forever coupons (idempotent):

```bash
npx tsx scripts/ensure-referral-coupons.ts
```

Creates:
- `ref_20_forever` — 20% forever
- `ref_30_forever` — 30% forever
- `ref_35_forever` — 35% forever

3. Stripe webhook events (in addition to existing): enable `charge.refunded` and `charge.dispute.created` if not already.

4. Optional: `RESEND_API_KEY` / `RESEND_FROM_EMAIL` for referral emails.

## User flows

- Referrers: `/referral` (also Profile → Refer a friend)
- Friends: `/home?ref=CODE` (legacy `/pricing?ref=CODE` redirects here) → Checkout applies 20% and disables marketing promo codes

## Admin

`GET /api/admin/referrals`  
`POST /api/admin/referrals` with `{ action, userId }` where action is `lock` | `unlock` | `remove_discount` | `reconcile`

Auth: `ADMIN_SECRET` or `ADMIN_EMAILS`.
