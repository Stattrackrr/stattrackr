/** `crop=wide` zooms padded studio shots; `crop=tight` un-zooms WTA close-ups. */
export function tennisComAvatarImgStyle(
  url?: string | null
): { transform?: string; transformOrigin?: string; objectFit?: 'contain'; objectPosition?: string } | undefined {
  const raw = String(url || '');
  if (/(?:^|[?&])crop=wide(?:&|$)/i.test(raw)) {
    return { transform: 'scale(1.55) translateY(-5%)', transformOrigin: 'center 34%' };
  }
  if (/(?:^|[?&])crop=tight(?:&|$)/i.test(raw)) {
    return {
      objectFit: 'contain',
      objectPosition: 'center 22%',
      transform: 'scale(0.92)',
      transformOrigin: 'center 36%',
    };
  }
  return undefined;
}

export function isLocalTennisHeadshotPath(url: string | null | undefined): boolean {
  return /^\/images\/tennis\/headshots\//i.test(String(url || '').split('?')[0]);
}

export function tennisHeadshotApiPath(playerId: string, query?: string | null): string {
  const path = `/api/tennis/headshot/${encodeURIComponent(String(playerId).trim())}`;
  const qs = String(query || '').replace(/^\?/, '');
  return qs ? `${path}?${qs}` : path;
}

function tennisHeadshotQuery(url: string): string {
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(q + 1) : '';
}

/** Always the cached local file (via headshot API), never a different remote photo. */
export function clientTennisHeadshotUrl(
  playerId?: string | null,
  stored?: string | null
): string | null {
  const id = String(playerId || '').trim();
  const url = String(stored || '').trim();
  if (id) return tennisHeadshotApiPath(id, tennisHeadshotQuery(url));
  if (isLocalTennisHeadshotPath(url) || url.startsWith('/api/tennis/headshot/')) return url;
  return null;
}
