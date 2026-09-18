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

function staticTennisHeadshotPath(playerId: string, stored?: string | null): string {
  const fromStored = String(stored || '').trim();
  if (isLocalTennisHeadshotPath(fromStored)) return fromStored;
  const apiMatch = fromStored.match(/^\/api\/tennis\/headshot\/([^/?#]+)/i);
  const id = String(playerId || apiMatch?.[1] || '').trim();
  const file = apiMatch
    ? `/images/tennis/headshots/${decodeURIComponent(apiMatch[1])}.jpg`
    : `/images/tennis/headshots/${id}.jpg`;
  const qs = tennisHeadshotQuery(fromStored);
  return qs ? `${file}?${qs}` : file;
}

/** Cached local file from /public — skip the per-id API route in dev. */
export function clientTennisHeadshotUrl(
  playerId?: string | null,
  stored?: string | null
): string | null {
  const id = String(playerId || '').trim();
  const url = String(stored || '').trim();
  if (isLocalTennisHeadshotPath(url)) return url;
  if (id || url.startsWith('/api/tennis/headshot/')) return staticTennisHeadshotPath(id, url);
  return null;
}
