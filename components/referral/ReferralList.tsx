'use client';

type ReferralRow = {
  id: string;
  status: string;
  createdAt: string;
};

type Props = {
  referrals: ReferralRow[];
};

export function ReferralList({ referrals }: Props) {
  if (referrals.length === 0) return null;

  return (
    <section aria-labelledby="referral-list-heading">
      <h2
        id="referral-list-heading"
        className="text-[15px] font-semibold tracking-tight"
        style={{ color: 'var(--ref-text)' }}
      >
        Your referrals
      </h2>
      <ul className="mt-4" style={{ borderTop: '1px solid var(--ref-border)' }}>
        {referrals.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-4 py-3 text-[13px]"
            style={{ borderBottom: '1px solid var(--ref-border)' }}
          >
            <span style={{ color: 'var(--ref-text-secondary)' }}>
              {new Date(r.createdAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <span className="capitalize font-medium" style={{ color: 'var(--ref-text)' }}>
              {r.status}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
