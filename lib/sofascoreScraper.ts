/**
 * Fetch SofaScore JSON endpoints through a hosted scraper API.
 *
 * SofaScore blocks direct/datacenter requests (HTTP 403). Rather than driving a
 * real browser (slow, fragile, needs Chrome), we route the same JSON endpoints
 * through a scraper API that rotates premium/residential proxies. Because these
 * are JSON endpoints — not rendered pages — JavaScript rendering is OFF, which
 * keeps credit usage at the cheap "basic request" tier.
 *
 * Provider-agnostic. Configure via .env.local:
 *   SCRAPER_API_KEY        (required)
 *   SCRAPER_API_PROVIDER   'scraperapi' (default) | 'scrapingbee' | 'custom'
 *   SCRAPER_API_TEMPLATE   only for provider=custom; must contain {KEY} and {URL}
 *                          e.g. https://example.com/?token={KEY}&url={URL}
 */

const SOFASCORE_API = 'https://api.sofascore.com/api/v1';

type Provider = 'scraperapi' | 'scrapingbee' | 'custom';

function getProvider(): Provider {
  const raw = (process.env.SCRAPER_API_PROVIDER || 'scraperapi').trim().toLowerCase();
  if (raw === 'scrapingbee' || raw === 'custom') return raw;
  return 'scraperapi';
}

function buildProxiedUrl(targetUrl: string): string {
  const key = process.env.SCRAPER_API_KEY;
  if (!key) throw new Error('SCRAPER_API_KEY missing from .env.local');
  const provider = getProvider();
  const encoded = encodeURIComponent(targetUrl);

  switch (provider) {
    case 'scrapingbee':
      // render_js=false keeps it at the cheap tier; premium_proxy bypasses 403s.
      return `https://app.scrapingbee.com/api/v1/?api_key=${key}&url=${encoded}&render_js=false&premium_proxy=true`;
    case 'custom': {
      const template = process.env.SCRAPER_API_TEMPLATE;
      if (!template) throw new Error('SCRAPER_API_TEMPLATE required when SCRAPER_API_PROVIDER=custom');
      return template.replace('{KEY}', key).replace('{URL}', encoded);
    }
    case 'scraperapi':
    default:
      // premium=true uses residential/premium proxies (needed for SofaScore).
      return `https://api.scraperapi.com/?api_key=${key}&url=${encoded}&premium=true`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Count successful upstream requests so scripts can report real scraper-credit
// usage. Each fetch (including retries) increments this.
let _requestCount = 0;
export function getSofascoreRequestCount(): number {
  return _requestCount;
}
export function resetSofascoreRequestCount(): void {
  _requestCount = 0;
}

export type SofascoreFetchOptions = {
  /** Max attempts before giving up (default 4). */
  maxAttempts?: number;
  /** Base backoff in ms; grows linearly per attempt (default 1500). */
  backoffMs?: number;
};

/** Thrown for non-retryable upstream responses (e.g. 404 — match has no data). */
export class SofascoreNotFoundError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SofascoreNotFoundError';
    this.status = status;
  }
}

/**
 * Fetch a SofaScore API path (e.g. "/event/123/lineups" or a full
 * https://api.sofascore.com URL) through the configured scraper API and return
 * parsed JSON. Retries transient proxy/rate-limit failures with backoff.
 */
export async function sofascoreFetch<T>(path: string, options: SofascoreFetchOptions = {}): Promise<T> {
  const target = path.startsWith('http')
    ? path
    : `${SOFASCORE_API}${path.startsWith('/') ? '' : '/'}${path}`;
  const proxied = buildProxiedUrl(target);
  const maxAttempts = options.maxAttempts ?? 4;
  const backoffMs = options.backoffMs ?? 1500;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      _requestCount += 1;
      const res = await fetch(proxied, { headers: { Accept: 'application/json' } });
      const text = await res.text();

      // 404/410 mean the resource genuinely doesn't exist (e.g. a match with no
      // lineups) — retrying wastes credits, so fail fast with a typed error.
      if (res.status === 404 || res.status === 410) {
        throw new SofascoreNotFoundError(res.status, `SofaScore ${res.status} for ${target}`);
      }
      // 401/403/429/5xx from the proxy or upstream → retry with backoff.
      if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) {
        if (attempt < maxAttempts) {
          const wait = backoffMs * attempt;
          console.warn(`[sofascore-scraper] HTTP ${res.status} on ${target} — retry ${attempt}/${maxAttempts} in ${wait}ms`);
          await sleep(wait);
          continue;
        }
        throw new Error(`scraper HTTP ${res.status} for ${target}: ${text.slice(0, 200)}`);
      }
      if (!res.ok) {
        throw new Error(`scraper HTTP ${res.status} for ${target}: ${text.slice(0, 200)}`);
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        // Some proxies wrap JSON in <pre>…</pre> or add a banner; salvage it.
        const stripped = text.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>\s*$/, '');
        try {
          return JSON.parse(stripped) as T;
        } catch {
          const m = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
          if (m) return JSON.parse(m[1]) as T;
          throw new Error(`SofaScore ${target} returned non-JSON via scraper: ${text.slice(0, 200)}`);
        }
      }
    } catch (err) {
      // Non-retryable upstream 404/410 — surface immediately.
      if (err instanceof SofascoreNotFoundError) throw err;
      lastErr = err;
      if (attempt >= maxAttempts) break;
      const wait = backoffMs * attempt;
      console.warn(`[sofascore-scraper] error on ${target}: ${(err as Error).message} — retry ${attempt}/${maxAttempts} in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Failed to fetch ${target}`);
}
