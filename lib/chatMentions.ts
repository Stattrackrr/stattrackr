export type ChatMentionCandidate = {
  userId: string;
  /** Inserted after `@` (no spaces). */
  handle: string;
  label: string;
  avatarUrl: string | null;
  /** Most recent message timestamp for this user in the room (ms). */
  lastMessagedAt?: number;
};

/** Empty `@` menu only shows this many recent messagers; typing searches everyone. */
export const MENTION_RECENT_LIMIT = 5;

const HANDLE_RE = /^[A-Za-z0-9_]{1,32}$/;

export function toMentionHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (HANDLE_RE.test(trimmed)) return trimmed;
  const compact = trimmed.replace(/[^A-Za-z0-9_]/g, '');
  return compact.length > 0 ? compact.slice(0, 32) : null;
}

/** Active `@query` at the caret, if any. */
export function getActiveMention(
  text: string,
  caret: number
): { start: number; query: string } | null {
  if (caret < 0 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const match = before.match(/(^|[\s([{])@([A-Za-z0-9_]{0,32})$/);
  if (!match) return null;
  const query = match[2] ?? '';
  const start = before.length - query.length - 1;
  return { start, query };
}

export function filterMentionCandidates(
  candidates: ChatMentionCandidate[],
  query: string,
  options?: { recentLimit?: number; searchLimit?: number }
): ChatMentionCandidate[] {
  const recentLimit = options?.recentLimit ?? MENTION_RECENT_LIMIT;
  const searchLimit = options?.searchLimit ?? 8;
  const q = query.trim().toLowerCase();

  // Bare `@`: only the most recent messagers.
  if (!q) {
    return [...candidates]
      .filter((candidate) => (candidate.lastMessagedAt ?? 0) > 0)
      .sort((left, right) => (right.lastMessagedAt ?? 0) - (left.lastMessagedAt ?? 0))
      .slice(0, recentLimit);
  }

  // Typing a name: search the full room roster.
  const ranked = candidates
    .map((candidate) => {
      const handle = candidate.handle.toLowerCase();
      const label = candidate.label.toLowerCase();
      let score = -1;
      if (handle.startsWith(q) || label.startsWith(q)) score = 2;
      else if (handle.includes(q) || label.includes(q)) score = 1;
      return { candidate, score };
    })
    .filter((row) => row.score >= 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const byRecency = (right.candidate.lastMessagedAt ?? 0) - (left.candidate.lastMessagedAt ?? 0);
      if (byRecency !== 0) return byRecency;
      return left.candidate.label.localeCompare(right.candidate.label);
    });

  return ranked.slice(0, searchLimit).map((row) => row.candidate);
}

export function insertMentionAt(
  text: string,
  mentionStart: number,
  caret: number,
  handle: string
): { next: string; nextCaret: number } {
  const insertion = `@${handle} `;
  const next = `${text.slice(0, mentionStart)}${insertion}${text.slice(caret)}`;
  return { next, nextCaret: mentionStart + insertion.length };
}

/** Split message body into plain text and @mention segments. */
export function splitMentionSegments(
  body: string,
  knownHandles: Set<string>
): Array<{ type: 'text' | 'mention'; value: string }> {
  if (!body) return [];
  const parts: Array<{ type: 'text' | 'mention'; value: string }> = [];
  const re = /@([A-Za-z0-9_]{1,32})/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) != null) {
    const handle = match[1];
    const start = match.index;
    if (start > last) {
      parts.push({ type: 'text', value: body.slice(last, start) });
    }
    if (knownHandles.has(handle.toLowerCase())) {
      parts.push({ type: 'mention', value: handle });
    } else {
      parts.push({ type: 'text', value: match[0] });
    }
    last = start + match[0].length;
  }
  if (last < body.length) {
    parts.push({ type: 'text', value: body.slice(last) });
  }
  return parts;
}
