'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { StatTrackrLogo } from '@/components/StatTrackrLogo';
import { tennisLastName } from '@/lib/tennis/chartStats';

type ChatMsg = { role: 'user' | 'assistant'; content: string; breakdown?: string[] };

function BrandLockup({
  isDark,
  compact = false,
}: {
  isDark: boolean;
  compact?: boolean;
}) {
  const muted = isDark ? 'text-gray-500' : 'text-gray-400';
  const strong = isDark ? 'text-white' : 'text-gray-900';
  if (compact) {
    return (
      <div className="flex items-center justify-center gap-1.5">
        <StatTrackrLogo className="w-6 h-6" />
        <span className={`text-sm font-semibold tracking-tight ${strong}`}>StatTrackr</span>
        <span className={`text-xs ${muted}`} aria-hidden>
          ×
        </span>
        <span className={`text-sm font-semibold tracking-tight ${strong}`}>OpenAI</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center">
      <div className="relative flex h-28 w-28 items-center justify-center">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-28 w-28 rounded-full bg-purple-500/40 blur-2xl st-ask-logo-glow"
        />
        <div className="relative st-ask-logo">
          <StatTrackrLogo className="w-24 h-24" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className={`text-base font-semibold tracking-tight ${strong}`}>StatTrackr</span>
        <span className={`text-sm ${muted}`} aria-hidden>
          ×
        </span>
        <span className={`text-base font-semibold tracking-tight ${strong}`}>OpenAI</span>
      </div>
    </div>
  );
}

export function TennisAskPanel({
  isDark = false,
  layout = 'desktop',
  playerName = null,
  opponentName = null,
  tour = 'ATP',
  isGrandSlam = false,
}: {
  isDark?: boolean;
  layout?: 'mobile' | 'desktop';
  playerName?: string | null;
  opponentName?: string | null;
  tour?: 'ATP' | 'WTA' | null;
  isGrandSlam?: boolean;
}) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const player = String(playerName || '').trim();
  const opponent = String(opponentName || '').trim();
  const playerLast = tennisLastName(player) || 'this player';
  const oppLast = opponent ? tennisLastName(opponent) : 'the opponent';
  const tourKey = tour === 'WTA' ? 'WTA' : 'ATP';
  const compact = layout === 'mobile';
  const idle = messages.length === 0 && !loading;
  const muted = isDark ? 'text-gray-400' : 'text-gray-500';
  const chip = isDark
    ? 'border-white/10 bg-white/[0.03] text-gray-200 hover:border-purple-500/70 hover:bg-purple-500/10'
    : 'border-gray-200 bg-white text-gray-800 hover:border-purple-400 hover:bg-purple-50';

  const suggestions = useMemo(() => {
    if (!player || !opponent) return [];
    const fiveSet = tourKey === 'ATP' && isGrandSlam;
    return [
      `Should I back ${playerLast} on the moneyline?`,
      `Will ${playerLast} win in straight sets?`,
      `Will ${playerLast} win by ${fiveSet ? '5.5' : '1.5'} games?`,
    ];
  }, [player, opponent, playerLast, tourKey, isGrandSlam]);

  useEffect(() => {
    setMessages([]);
    setError(null);
    setQuestion('');
  }, [player, opponent]);

  useEffect(() => {
    if (idle) return;
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, loading, idle]);

  async function ask(text: string) {
    const next = text.trim();
    if (!next || !player || !opponent || loading) return;
    setQuestion('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: next }]);
    setLoading(true);
    try {
      const res = await fetch('/api/tennis/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: next,
          player,
          opponent,
          tour: tourKey,
          isGrandSlam,
          history: messages.map((msg) => ({
            role: msg.role,
            content: msg.breakdown?.length ? `${msg.content}\n${msg.breakdown.join('\n')}` : msg.content,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Ask failed');
      const reply = String(json.answer || json.reasoning || '');
      const breakdown = Array.isArray(json.breakdown)
        ? json.breakdown.map((row: unknown) => String(row || '').trim()).filter(Boolean)
        : [];
      setMessages((prev) => [...prev, { role: 'assistant', content: reply, breakdown }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ask failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`w-full flex flex-col ${compact ? 'min-h-[300px]' : 'min-h-[380px]'}`}>
      {!idle ? <div className="mb-3"><BrandLockup isDark={isDark} compact /></div> : null}

      <div className="flex-1 min-h-0 flex flex-col">
        {idle ? (
          <div className="flex-1 flex flex-col items-center justify-center px-1 py-4 text-center">
            <BrandLockup isDark={isDark} />
            <div className={`mt-3 text-[13px] ${muted}`}>
              {player && opponent
                ? `${playerLast} vs ${oppLast}`
                : 'Select an opponent to ask about this match'}
            </div>

            {player && opponent ? (
              <div className="mt-5 w-full max-w-md space-y-2">
                {suggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => ask(item)}
                    className={`w-full rounded-xl border px-3.5 py-2.5 text-left text-[13px] leading-snug transition-colors ${chip}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex-1 min-h-0 space-y-3">
            {messages.map((msg, idx) => (
              <div
                key={`${msg.role}-${idx}`}
                className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-purple-600 text-white'
                      : isDark
                        ? 'bg-white/[0.04] text-gray-100'
                        : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <div>{msg.content}</div>
                  {msg.role === 'assistant' && msg.breakdown?.length ? (
                    <div
                      className={`mt-2.5 space-y-1.5 border-t pt-2.5 text-[13px] leading-relaxed ${
                        isDark ? 'border-white/10 text-gray-300' : 'border-gray-200 text-gray-600'
                      }`}
                    >
                      {msg.breakdown.map((line, lineIdx) => (
                        <div key={`${idx}-why-${lineIdx}`}>{line}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {loading ? (
              <div className={`inline-flex items-center gap-2 text-xs ${muted}`}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Reading the match model
              </div>
            ) : null}
            {error ? <div className="text-xs text-red-500">{error}</div> : null}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={!player || !opponent || loading}
          maxLength={500}
          placeholder={opponent ? 'Ask a match question' : 'Select an opponent first'}
          className={`min-w-0 flex-1 rounded-full border px-4 py-2.5 text-sm ${
            isDark
              ? 'border-white/10 bg-white/[0.04] text-white placeholder:text-gray-500'
              : 'border-gray-200 bg-white text-gray-900 placeholder:text-gray-400'
          }`}
        />
        <button
          type="submit"
          disabled={!player || !opponent || loading || !question.trim()}
          className="rounded-full bg-purple-600 p-2.5 text-white disabled:opacity-40"
          aria-label="Send question"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
