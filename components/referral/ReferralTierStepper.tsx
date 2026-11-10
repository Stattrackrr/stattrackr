'use client';

const TIERS = [
  { friends: 0, label: '0', discount: 'Full price', percent: 0 },
  { friends: 1, label: '1', discount: '20% off', percent: 20 },
  { friends: 2, label: '2', discount: '30% off', percent: 30 },
  { friends: 3, label: '3+', discount: '35% max', percent: 35 },
] as const;

type Props = {
  activeCount: number;
};

function tierIndex(activeCount: number): number {
  if (activeCount >= 3) return 3;
  if (activeCount === 2) return 2;
  if (activeCount === 1) return 1;
  return 0;
}

export function ReferralTierStepper({ activeCount }: Props) {
  const current = tierIndex(activeCount);

  return (
    <section aria-labelledby="referral-tiers-heading">
      <h2
        id="referral-tiers-heading"
        className="text-[15px] font-semibold tracking-tight"
        style={{ color: 'var(--ref-text)' }}
      >
        Discount tiers
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--ref-text-secondary)' }}>
        Your discount is based on how many friends stay active on a paid plan.
      </p>

      {/* Desktop: horizontal */}
      <ol className="mt-6 hidden sm:grid sm:grid-cols-4 sm:gap-0" aria-label="Referral discount tiers">
        {TIERS.map((tier, i) => {
          const done = i < current;
          const active = i === current;
          const upcoming = i > current;
          return (
            <li key={tier.friends} className="relative flex flex-col items-start px-1 first:pl-0 last:pr-0">
              {i < TIERS.length - 1 && (
                <span
                  aria-hidden
                  className="absolute left-[18px] right-0 top-[7px] h-px"
                  style={{
                    background:
                      i < current ? 'var(--ref-accent)' : 'var(--ref-border-strong)',
                  }}
                />
              )}
              <span
                className="relative z-[1] flex h-[15px] w-[15px] items-center justify-center rounded-full"
                style={{
                  background: done || active ? 'var(--ref-accent)' : 'var(--ref-raised)',
                  border: `1.5px solid ${
                    done || active ? 'var(--ref-accent)' : 'var(--ref-border-strong)'
                  }`,
                  boxShadow: active ? '0 0 0 3px var(--ref-accent-muted)' : undefined,
                }}
                aria-current={active ? 'step' : undefined}
              />
              <p
                className="ref-tabular mt-3 text-[13px] font-medium"
                style={{
                  color: upcoming ? 'var(--ref-text-tertiary)' : 'var(--ref-text)',
                }}
              >
                {tier.label} {tier.friends === 1 ? 'friend' : 'friends'}
              </p>
              <p
                className="mt-0.5 text-[13px]"
                style={{
                  color: active
                    ? 'var(--ref-accent)'
                    : upcoming
                      ? 'var(--ref-text-tertiary)'
                      : 'var(--ref-text-secondary)',
                }}
              >
                {tier.discount}
              </p>
            </li>
          );
        })}
      </ol>

      {/* Mobile: vertical */}
      <ol className="mt-6 flex flex-col sm:hidden" aria-label="Referral discount tiers">
        {TIERS.map((tier, i) => {
          const done = i < current;
          const active = i === current;
          const upcoming = i > current;
          return (
            <li key={tier.friends} className="relative flex gap-3 pb-5 last:pb-0">
              {i < TIERS.length - 1 && (
                <span
                  aria-hidden
                  className="absolute left-[7px] top-[15px] bottom-0 w-px"
                  style={{
                    background:
                      i < current ? 'var(--ref-accent)' : 'var(--ref-border-strong)',
                  }}
                />
              )}
              <span
                className="relative z-[1] mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full"
                style={{
                  background: done || active ? 'var(--ref-accent)' : 'var(--ref-raised)',
                  border: `1.5px solid ${
                    done || active ? 'var(--ref-accent)' : 'var(--ref-border-strong)'
                  }`,
                  boxShadow: active ? '0 0 0 3px var(--ref-accent-muted)' : undefined,
                }}
                aria-current={active ? 'step' : undefined}
              />
              <div>
                <p
                  className="ref-tabular text-[13px] font-medium"
                  style={{
                    color: upcoming ? 'var(--ref-text-tertiary)' : 'var(--ref-text)',
                  }}
                >
                  {tier.label} {tier.friends === 1 ? 'friend' : 'friends'}
                </p>
                <p
                  className="mt-0.5 text-[13px]"
                  style={{
                    color: active
                      ? 'var(--ref-accent)'
                      : upcoming
                        ? 'var(--ref-text-tertiary)'
                        : 'var(--ref-text-secondary)',
                  }}
                >
                  {tier.discount}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
