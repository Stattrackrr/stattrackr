'use client';

import { useState } from 'react';
import { Check, Copy, Mail } from 'lucide-react';

type Props = {
  link: string;
  code: string;
};

export function ReferralLinkBlock({ link, code }: Props) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);

  const shareMessage = `Join me on StatTrackr — use my link for 20% off while you're subscribed:\n${link}`;

  const copy = async (value: string, which: 'link' | 'code' | 'message') => {
    try {
      await navigator.clipboard.writeText(value);
      if (which === 'link') {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      } else if (which === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } else {
        setCopiedMessage(true);
        setTimeout(() => setCopiedMessage(false), 2000);
      }
    } catch {
      /* ignore */
    }
  };

  const tweetHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    `Join me on StatTrackr — 20% off while you're subscribed: ${link}`
  )}`;
  const mailHref = `mailto:?subject=${encodeURIComponent('StatTrackr referral')}&body=${encodeURIComponent(shareMessage)}`;

  return (
    <section aria-labelledby="referral-link-heading">
      <h2
        id="referral-link-heading"
        className="text-[15px] font-semibold tracking-tight"
        style={{ color: 'var(--ref-text)' }}
      >
        Your link
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--ref-text-secondary)' }}>
        Share this with friends. They get 20% off for as long as they stay subscribed.
      </p>

      <div
        className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-stretch"
        style={{ gap: 8 }}
      >
        <input
          readOnly
          value={link}
          aria-label="Referral link"
          onFocus={(e) => e.currentTarget.select()}
          className="ref-focus min-w-0 flex-1 px-3 py-2.5 text-[13px] sm:text-sm"
          style={{
            fontFamily: 'var(--ref-mono)',
            background: 'var(--ref-raised)',
            border: '1px solid var(--ref-border)',
            borderRadius: 'var(--ref-radius-control)',
            color: 'var(--ref-text)',
          }}
        />
        <button
          type="button"
          onClick={() => copy(link, 'link')}
          className={`ref-focus ref-btn-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium shrink-0 transition-[background-color,color] duration-150 ease-out${
            copiedLink ? ' is-copied' : ''
          }`}
          aria-live="polite"
        >
          {copiedLink ? (
            <>
              <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              Copy link
            </>
          )}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--ref-text-secondary)' }}>
          <span>Code</span>
          <code
            className="ref-tabular px-1.5 py-0.5 text-[13px]"
            style={{
              fontFamily: 'var(--ref-mono)',
              color: 'var(--ref-text)',
              background: 'var(--ref-raised)',
              borderRadius: 6,
              border: '1px solid var(--ref-border)',
            }}
          >
            {code}
          </code>
          <button
            type="button"
            onClick={() => copy(code, 'code')}
            className="ref-focus inline-flex items-center gap-1 text-[13px] transition-colors duration-150 ease-out hover:opacity-90"
            style={{ color: 'var(--ref-text-secondary)' }}
            aria-live="polite"
          >
            {copiedCode ? (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                Copy
              </>
            )}
          </button>
        </div>

        <span className="hidden sm:inline" style={{ color: 'var(--ref-border-strong)' }} aria-hidden>
          |
        </span>

        <div className="flex items-center gap-3 text-[13px]">
          <button
            type="button"
            onClick={() => copy(shareMessage, 'message')}
            className="ref-focus transition-colors duration-150 ease-out"
            style={{ color: 'var(--ref-text-secondary)' }}
            aria-live="polite"
          >
            {copiedMessage ? 'Message copied' : 'Copy message'}
          </button>
          <a
            href={mailHref}
            className="ref-focus inline-flex items-center gap-1 transition-colors duration-150 ease-out"
            style={{ color: 'var(--ref-text-secondary)' }}
          >
            <Mail className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
            Email
          </a>
          <a
            href={tweetHref}
            target="_blank"
            rel="noopener noreferrer"
            className="ref-focus transition-colors duration-150 ease-out"
            style={{ color: 'var(--ref-text-secondary)' }}
          >
            Post on X
          </a>
        </div>
      </div>
    </section>
  );
}
