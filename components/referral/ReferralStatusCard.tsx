'use client';

type Props = {
  appliedPercent: number;
  pendingPercent: number;
  referredCount: number;
  activeCount: number;
  nextTier: number | null;
  nextActiveNeeded: number | null;
  isPro: boolean;
};

function nextTierCopy(
  activeCount: number,
  nextTier: number | null,
  nextActiveNeeded: number | null
): string {
  if (nextTier == null || nextActiveNeeded == null) {
    return 'You are at the maximum discount.';
  }
  const more = Math.max(1, nextActiveNeeded - activeCount);
  const friendWord = more === 1 ? 'friend' : 'friends';
  if (activeCount === 0) {
    return `Invite your first active friend for ${nextTier}% off.`;
  }
  return `${more} more active ${friendWord} → ${nextTier}% off`;
}

export function ReferralStatusCard({
  appliedPercent,
  pendingPercent,
  referredCount,
  activeCount,
  nextTier,
  nextActiveNeeded,
  isPro,
}: Props) {
  const stateLine = !isPro
    ? 'An active Pro subscription is required to earn referral tiers.'
    : nextTierCopy(activeCount, nextTier, nextActiveNeeded);

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Referred', value: String(referredCount) },
    { label: 'Active friends', value: String(activeCount) },
    {
      label: 'Next tier',
      value:
        nextTier != null && nextActiveNeeded != null
          ? `${Math.max(1, nextActiveNeeded - activeCount)} more → ${nextTier}%`
          : 'Max reached',
    },
  ];

  return (
    <aside
      className="lg:sticky lg:top-8"
      aria-labelledby="referral-status-heading"
      style={{
        background: 'var(--ref-surface)',
        border: '1px solid var(--ref-border)',
        borderRadius: 'var(--ref-radius-surface)',
        padding: 24,
      }}
    >
      <h2
        id="referral-status-heading"
        className="text-[13px] font-medium"
        style={{ color: 'var(--ref-text-secondary)' }}
      >
        Your status
      </h2>

      <p
        className="ref-tabular mt-3 text-[40px] font-semibold leading-none tracking-tight"
        style={{ color: 'var(--ref-text)' }}
      >
        {appliedPercent}
        <span className="text-[22px] font-semibold" style={{ color: 'var(--ref-text-secondary)' }}>
          % off
        </span>
      </p>

      <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--ref-text-secondary)' }}>
        {stateLine}
      </p>

      {pendingPercent !== appliedPercent && (
        <p
          className="mt-2 text-[13px] leading-relaxed"
          style={{ color: 'var(--ref-accent)' }}
        >
          Pending at next renewal: {pendingPercent}% off
        </p>
      )}

      <dl className="mt-6">
        {rows.map((row, i) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-4 py-3"
            style={{
              borderTop: i === 0 ? '1px solid var(--ref-border)' : undefined,
              borderBottom: '1px solid var(--ref-border)',
            }}
          >
            <dt className="text-[13px]" style={{ color: 'var(--ref-text-secondary)' }}>
              {row.label}
            </dt>
            <dd
              className="ref-tabular text-[13px] font-medium"
              style={{ color: 'var(--ref-text)' }}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
