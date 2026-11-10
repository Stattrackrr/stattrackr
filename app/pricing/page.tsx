import { redirect } from 'next/navigation';

/**
 * Legacy /pricing (old marketing page). Current plans live on /home#pricing.
 * Preserve ?ref= so existing referral links still work.
 */
export default async function PricingRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === 'string' && value) params.set(key, value);
    else if (Array.isArray(value) && value[0]) params.set(key, value[0]);
  }
  const qs = params.toString();
  // Hash is not reliable on HTTP redirects; /home scrolls to #pricing when ?ref= is present.
  redirect(`/home${qs ? `?${qs}` : ''}`);
}
