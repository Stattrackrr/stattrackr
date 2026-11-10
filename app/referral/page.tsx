'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { ReferralLinkBlock } from '@/components/referral/ReferralLinkBlock';
import { ReferralStatusCard } from '@/components/referral/ReferralStatusCard';
import { ReferralTierStepper } from '@/components/referral/ReferralTierStepper';
import { ReferralTerms } from '@/components/referral/ReferralTerms';
import { ReferralList } from '@/components/referral/ReferralList';

type ReferralMe = {
  code: string;
  link: string;
  referredCount: number;
  activeCount: number;
  currentPercent: number;
  appliedPercent: number;
  pendingPercent: number;
  nextTier: number | null;
  nextActiveNeeded: number | null;
  isReferredFriend: boolean;
  friendPercent: number;
  maxPercent: number;
  isPro: boolean;
  referrals: Array<{
    id: string;
    status: string;
    createdAt: string;
    activatedAt: string | null;
    endedAt: string | null;
  }>;
};

function ReferralSkeleton() {
  return (
    <div className="referral-page">
      <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 py-10 sm:py-16">
        <div className="ref-skeleton h-4 w-28" />
        <div className="ref-skeleton mt-6 h-8 w-48" />
        <div className="ref-skeleton mt-3 h-4 w-full max-w-xl" />
        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
          <div className="space-y-10">
            <div className="ref-skeleton h-24 w-full" />
            <div className="ref-skeleton h-28 w-full" />
            <div className="ref-skeleton h-40 w-full" />
          </div>
          <div className="ref-skeleton h-64 w-full" />
        </div>
      </div>
    </div>
  );
}

export default function ReferralPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReferralMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) {
        router.replace('/login?redirect=/referral');
        return;
      }
      try {
        const res = await fetch('/api/referral/me', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load');
        if (!cancelled) setData(json);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading) return <ReferralSkeleton />;

  return (
    <div className="referral-page">
      <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 py-10 sm:py-16">
        <Link
          href="/props"
          className="ref-focus ref-back-link inline-flex items-center gap-1.5 rounded-[8px] px-1 py-1 -ml-1 text-[13px] transition-colors duration-150 ease-out"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
          Account
        </Link>

        <header className="mt-6 max-w-[65ch]">
          <h1
            className="text-[28px] sm:text-[32px] font-semibold tracking-tight leading-tight"
            style={{ color: 'var(--ref-text)', letterSpacing: '-0.02em' }}
          >
            Referrals
          </h1>
          <p
            className="mt-3 text-[14px] sm:text-[15px] leading-[1.55]"
            style={{ color: 'var(--ref-text-secondary)' }}
          >
            Friends get 20% off while they&apos;re subscribed. You earn up to 35% off as more of
            them stay active.
          </p>
        </header>

        {error && (
          <div
            role="alert"
            className="mt-8 px-4 py-3 text-sm"
            style={{
              background: 'var(--ref-danger-bg)',
              border: '1px solid var(--ref-danger-border)',
              borderRadius: 'var(--ref-radius-control)',
              color: 'var(--ref-danger-text)',
            }}
          >
            {error}
          </div>
        )}

        {data && (
          <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-12">
            {/* Mobile status first */}
            <div className="lg:hidden">
              <ReferralStatusCard
                appliedPercent={data.appliedPercent}
                pendingPercent={data.pendingPercent}
                referredCount={data.referredCount}
                activeCount={data.activeCount}
                nextTier={data.nextTier}
                nextActiveNeeded={data.nextActiveNeeded}
                isPro={data.isPro}
              />
            </div>

            <div className="space-y-12 min-w-0">
              <div
                style={{
                  background: 'var(--ref-surface)',
                  border: '1px solid var(--ref-border)',
                  borderRadius: 'var(--ref-radius-surface)',
                  padding: 24,
                }}
              >
                <ReferralLinkBlock link={data.link} code={data.code} />
              </div>

              <ReferralTierStepper activeCount={data.activeCount} />

              <ReferralTerms />

              <ReferralList referrals={data.referrals} />
            </div>

            <div className="hidden lg:block">
              <ReferralStatusCard
                appliedPercent={data.appliedPercent}
                pendingPercent={data.pendingPercent}
                referredCount={data.referredCount}
                activeCount={data.activeCount}
                nextTier={data.nextTier}
                nextActiveNeeded={data.nextActiveNeeded}
                isPro={data.isPro}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
