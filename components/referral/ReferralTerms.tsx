'use client';

const STEPS = [
  {
    n: '1',
    title: 'You share your link',
    body: 'Anyone who signs up through it is tied to your account as a referral.',
  },
  {
    n: '2',
    title: 'They get 20% off',
    body: 'While they’re on a paid plan, their subscription stays discounted. That discount doesn’t depend on yours.',
  },
  {
    n: '3',
    title: 'You earn a discount from active friends',
    body: 'Only friends who are currently subscribed and paying count. 1 active friend → 20% off. 2 → 30%. 3 or more → 35% (the max).',
  },
  {
    n: '4',
    title: 'Tiers move with who stays subscribed',
    body: 'If you gain an active friend, the higher discount is applied as a credit. If you lose one, the lower rate starts at your next renewal — not mid-cycle.',
  },
] as const;

const DETAILS = [
  {
    title: 'You need Pro to earn tiers',
    body: 'Friends still get their 20% off even if you’re not on Pro. Your own referrer discount only applies while you have an active Pro subscription.',
  },
  {
    title: 'Pending cancellations are blocked',
    body: 'If either account has a cancellation scheduled, they can’t refer or be referred until that subscription fully ends.',
  },
  {
    title: 'Your friends keep their discount if you leave',
    body: 'Cancelling your plan doesn’t remove the 20% off from people you already referred.',
  },
  {
    title: 'Referral discounts don’t stack with promo codes',
    body: 'Checkout uses one discount at a time. A referral offer can’t be combined with another promo.',
  },
  {
    title: 'Abuse',
    body: 'Self-referrals, fake accounts, and similar patterns can get discounts removed.',
  },
] as const;

export function ReferralTerms() {
  return (
    <section aria-label="How referrals work" className="space-y-10">
      <div>
        <h2
          className="text-[15px] font-semibold tracking-tight"
          style={{ color: 'var(--ref-text)' }}
        >
          How referrals work
        </h2>
        <ol className="mt-5 space-y-5">
          {STEPS.map((step) => (
            <li key={step.n} className="flex gap-3.5">
              <span
                className="ref-tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
                style={{
                  background: 'var(--ref-accent-muted)',
                  color: 'var(--ref-accent)',
                }}
                aria-hidden
              >
                {step.n}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-[14px] font-medium" style={{ color: 'var(--ref-text)' }}>
                  {step.title}
                </p>
                <p
                  className="mt-1 text-[13px] leading-[1.55]"
                  style={{ color: 'var(--ref-text-secondary)' }}
                >
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div style={{ borderTop: '1px solid var(--ref-border)', paddingTop: 32 }}>
        <h2
          className="text-[15px] font-semibold tracking-tight"
          style={{ color: 'var(--ref-text)' }}
        >
          Details worth knowing
        </h2>
        <dl className="mt-5 space-y-5">
          {DETAILS.map((item) => (
            <div key={item.title}>
              <dt className="text-[14px] font-medium" style={{ color: 'var(--ref-text)' }}>
                {item.title}
              </dt>
              <dd
                className="mt-1 text-[13px] leading-[1.55]"
                style={{ color: 'var(--ref-text-secondary)' }}
              >
                {item.body}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
