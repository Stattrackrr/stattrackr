'use client';

import { ChatComposerHighlight } from '@/components/chat/ChatComposerHighlight';
import { ChatMentionMenu } from '@/components/chat/ChatMentionMenu';
import { CHAT_IMAGE_TYPES, CHAT_MAX_MESSAGE_LENGTH, type ChatMessage } from '@/lib/chat';
import {
  filterMentionCandidates,
  getActiveMention,
  insertMentionAt,
  toMentionHandle,
  type ChatMentionCandidate,
} from '@/lib/chatMentions';
import { ImagePlus, Loader2, Send, X } from 'lucide-react';
import {
  FormEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';

export type ChatComposerHandle = {
  insertMention: (username: string) => void;
  clear: () => void;
  focus: () => void;
};

type Props = {
  mentionCandidates: ChatMentionCandidate[];
  knownMentionHandles: Set<string>;
  replyTarget: ChatMessage | null;
  onCancelReply: () => void;
  onSend: (body: string) => Promise<void> | void;
  sending: boolean;
  disabled: boolean;
  isAdmin: boolean;
  composerImage: { file: File; preview: string } | null;
  onPickImage: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearImage: () => void;
  error: string | null;
  onClearError: () => void;
  isCooldown: boolean;
};

export const ChatComposer = forwardRef<ChatComposerHandle, Props>(function ChatComposer(
  {
    mentionCandidates,
    knownMentionHandles,
    replyTarget,
    onCancelReply,
    onSend,
    sending,
    disabled,
    isAdmin,
    composerImage,
    onPickImage,
    onClearImage,
    error,
    onClearError,
    isCooldown,
  },
  ref
) {
  const [value, setValue] = useState('');
  const [mentionActive, setMentionActive] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef(0);
  const mentionActiveRef = useRef<{ start: number; query: string } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const filteredMentions = useMemo(
    () => (mentionActive ? filterMentionCandidates(mentionCandidates, mentionActive.query) : []),
    [mentionActive, mentionCandidates]
  );

  const refreshMention = useCallback((text: string, caret: number) => {
    caretRef.current = caret;
    const active = getActiveMention(text, caret);
    const previous = mentionActiveRef.current;
    const changed =
      (!!active !== !!previous) ||
      active?.start !== previous?.start ||
      active?.query !== previous?.query;

    mentionActiveRef.current = active;
    setMentionActive(active);
    if (!active || changed) {
      setMentionIndex(0);
    }
  }, []);

  const focusAt = useCallback((caret: number) => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, []);

  const applyValue = useCallback(
    (nextValue: string, nextCaret: number) => {
      const limited = nextValue.slice(0, CHAT_MAX_MESSAGE_LENGTH);
      const caret = Math.min(nextCaret, limited.length);
      setValue(limited);
      caretRef.current = caret;
      refreshMention(limited, caret);
      if (error) onClearError();
      requestAnimationFrame(() => focusAt(caret));
    },
    [error, focusAt, onClearError, refreshMention]
  );

  const selectMention = useCallback(
    (candidate: ChatMentionCandidate) => {
      if (!mentionActive) return;
      const { next, nextCaret } = insertMentionAt(value, mentionActive.start, caretRef.current, candidate.handle);
      mentionActiveRef.current = null;
      setMentionActive(null);
      setMentionIndex(0);
      applyValue(next, nextCaret);
    },
    [applyValue, mentionActive, value]
  );

  useImperativeHandle(
    ref,
    () => ({
      insertMention: (username: string) => {
        const handle = toMentionHandle(username) || username;
        const mention = `@${handle} `;
        const trimmed = value.trimEnd();
        const next =
          !trimmed
            ? mention
            : trimmed.toLowerCase().includes(`@${handle.toLowerCase()}`)
              ? value
              : `${trimmed} ${mention}`;
        applyValue(next, next.length);
      },
      clear: () => {
        setValue('');
        mentionActiveRef.current = null;
        setMentionActive(null);
        setMentionIndex(0);
        caretRef.current = 0;
      },
      focus: () => focusAt(caretRef.current || value.length),
    }),
    [applyValue, focusAt, value]
  );

  useEffect(() => {
    if (!mentionActive) return;
    if (filteredMentions.length === 0) {
      setMentionIndex(0);
      return;
    }
    setMentionIndex((current) => Math.min(current, filteredMentions.length - 1));
  }, [filteredMentions.length, mentionActive]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionActive) {
      if (event.key === 'Escape') {
        event.preventDefault();
        mentionActiveRef.current = null;
        setMentionActive(null);
        setMentionIndex(0);
        return;
      }
      if (filteredMentions.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setMentionIndex((current) => (current + 1) % filteredMentions.length);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setMentionIndex((current) => (current - 1 + filteredMentions.length) % filteredMentions.length);
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          const candidate = filteredMentions[mentionIndex] ?? filteredMentions[0];
          if (candidate) selectMention(candidate);
          return;
        }
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleSend = async () => {
    if (disabled || sending || isCooldown) return;
    const trimmed = value.trim();
    if (!trimmed && !composerImage) return;
    await onSend(trimmed);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void handleSend();
  };

  const canSubmit = !disabled && !sending && !isCooldown && Boolean(value.trim() || composerImage);

  return (
    <form onSubmit={handleSubmit} className="space-y-1 sm:space-y-3">
      {replyTarget ? (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-[#111c2d]">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-purple-600 dark:text-purple-300">
              Replying to {replyTarget.display_name || 'Member'}
            </div>
            <p className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-300">
              {replyTarget.body || (replyTarget.image_url ? 'Photo' : '')}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="Cancel reply"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {isAdmin && composerImage ? (
        <div className="relative inline-block">
          <img
            src={composerImage.preview}
            alt="Photo to send"
            className="max-h-32 rounded-xl border border-gray-200 object-contain dark:border-gray-700"
          />
          <button
            type="button"
            onClick={onClearImage}
            disabled={sending}
            className="absolute -right-2 -top-2 rounded-full bg-gray-900/80 p-1 text-white transition-colors hover:bg-gray-900 disabled:opacity-60"
            aria-label="Remove photo"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div className="relative">
        {mentionActive ? (
          <ChatMentionMenu
            candidates={filteredMentions}
            activeIndex={mentionIndex}
            onHoverIndex={setMentionIndex}
            onSelect={selectMention}
          />
        ) : null}

        <div className="relative overflow-hidden rounded-2xl border border-gray-300 bg-white transition-colors focus-within:border-purple-500 focus-within:ring-2 focus-within:ring-purple-500/25 dark:border-gray-600 dark:bg-[#111c2d]">
          <ChatComposerHighlight
            value={value}
            knownHandles={knownMentionHandles}
            className="px-4 py-2.5 pr-20 leading-5 sm:py-3 sm:pr-4"
          />
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => {
              const nextValue = event.target.value.slice(0, CHAT_MAX_MESSAGE_LENGTH);
              const caret = event.target.selectionStart ?? nextValue.length;
              setValue(nextValue);
              refreshMention(nextValue, caret);
              if (error) onClearError();
            }}
            onSelect={(event) => {
              refreshMention(
                event.currentTarget.value,
                event.currentTarget.selectionStart ?? event.currentTarget.value.length
              );
            }}
            onClick={(event) => {
              refreshMention(
                event.currentTarget.value,
                event.currentTarget.selectionStart ?? event.currentTarget.value.length
              );
            }}
            onKeyUp={(event) => {
              if (
                event.key === 'ArrowDown' ||
                event.key === 'ArrowUp' ||
                event.key === 'Enter' ||
                event.key === 'Tab' ||
                event.key === 'Escape'
              ) {
                return;
              }
              refreshMention(
                event.currentTarget.value,
                event.currentTarget.selectionStart ?? event.currentTarget.value.length
              );
            }}
            onKeyDown={handleKeyDown}
            onScroll={(event) => {
              const highlight = event.currentTarget.previousElementSibling as HTMLElement | null;
              if (highlight) highlight.scrollTop = event.currentTarget.scrollTop;
            }}
            placeholder="Message..."
            maxLength={CHAT_MAX_MESSAGE_LENGTH}
            rows={3}
            className="relative z-10 h-16 w-full resize-none bg-transparent px-4 py-2.5 pr-20 text-sm leading-5 text-transparent caret-gray-900 outline-none placeholder:text-gray-500 dark:caret-white dark:placeholder:text-gray-400 sm:h-auto sm:py-3 sm:pr-4"
          />
          <button
            type="submit"
            disabled={!canSubmit}
            className="absolute bottom-3 right-3 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full bg-purple-600 text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-purple-400 sm:hidden"
            aria-label="Send message"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="order-2 mt-1 text-[10px] leading-none text-gray-500 dark:text-gray-400 sm:order-1 sm:mt-0 sm:text-xs sm:leading-normal">
          {value.trim().length}/{CHAT_MAX_MESSAGE_LENGTH} characters
        </div>
        <div className="order-1 flex items-center gap-3 sm:order-2">
          {error ? <span className="text-xs text-red-600 dark:text-red-300">{error}</span> : null}
          {isAdmin ? (
            <>
              <input
                ref={imageInputRef}
                type="file"
                accept={CHAT_IMAGE_TYPES.join(',')}
                onChange={onPickImage}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={sending}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-[#162338] sm:py-2.5 sm:text-sm"
                aria-label="Add photo"
              >
                <ImagePlus className="h-4 w-4" />
                Photo
              </button>
            </>
          ) : null}
          <button
            type="submit"
            disabled={!canSubmit}
            className="hidden items-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-purple-400 sm:inline-flex"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send message
          </button>
        </div>
      </div>
    </form>
  );
});
