import { headers } from 'next/headers';

const INLINE_PAYLOAD_MAX_CHARS = 250_000;
const PROPS_CACHE_KEY = 'nba-player-props-cache';
const PROPS_TIMESTAMP_KEY = 'nba-player-props-cache-timestamp';
const CACHE_STALE_MS = 30 * 60 * 1000;

type NbaPropsResponse = {
  success?: boolean;
  data?: unknown[];
};

function escapeForInlineScript(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: 'force-cache',
      next: { revalidate: 60 },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function PropsLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';

  let inlineSeedScript = '';

  if (host) {
    const baseUrl = `${proto}://${host}`;
    const nbaData = await fetchJsonWithTimeout<NbaPropsResponse>(`${baseUrl}/api/nba/player-props`, 1500);
    const propsRows = Array.isArray(nbaData?.data) ? nbaData.data : [];

    if ((nbaData?.success ?? false) && propsRows.length > 0) {
      const serialized = JSON.stringify(propsRows);
      if (serialized.length <= INLINE_PAYLOAD_MAX_CHARS) {
        const escaped = escapeForInlineScript(serialized);
        inlineSeedScript = `
          (function(){
            try {
              var now = Date.now();
              var tsRaw = sessionStorage.getItem('${PROPS_TIMESTAMP_KEY}');
              var ts = tsRaw ? parseInt(tsRaw, 10) : 0;
              var isFresh = Number.isFinite(ts) && (now - ts) < ${CACHE_STALE_MS};
              if (!isFresh) {
                sessionStorage.setItem('${PROPS_CACHE_KEY}', '${escaped}');
                sessionStorage.setItem('${PROPS_TIMESTAMP_KEY}', String(now));
              }
            } catch (e) {}
          }());
        `;
      }
    }
  }

  return (
    <>
      {inlineSeedScript ? (
        <script
          dangerouslySetInnerHTML={{
            __html: inlineSeedScript,
          }}
        />
      ) : null}
      {children}
    </>
  );
}
