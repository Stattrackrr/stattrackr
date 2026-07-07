/**
 * Shared FootyWire HTTP helper for CI scripts.
 * GitHub Actions IPs are often rate-limited (503); retry with backoff before giving up.
 */

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
  Referer: 'https://www.footywire.com/',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFootywireUnavailableStatus(status) {
  return status === 429 || status === 502 || status === 503;
}

/**
 * Probe FootyWire with retries. Returns { ok, status, attempts }.
 */
async function probeFootywire(url, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || process.env.FOOTYWIRE_PROBE_ATTEMPTS || 8));
  const baseDelayMs = Math.max(500, Number(options.baseDelayMs || process.env.FOOTYWIRE_PROBE_DELAY_MS || 4000));
  const headers = options.headers || DEFAULT_HEADERS;

  let lastStatus = 0;
  let lastError = '';
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { headers });
      lastStatus = res.status;
      if (res.ok) return { ok: true, status: res.status, attempts: i + 1 };
      if (!isFootywireUnavailableStatus(res.status)) {
        return { ok: false, status: res.status, attempts: i + 1 };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      lastStatus = 0;
    }
    if (i < attempts - 1) {
      const wait = baseDelayMs * (i + 1);
      console.warn(`[FootyWire] probe attempt ${i + 1}/${attempts} unavailable (HTTP ${lastStatus || lastError}); retry in ${wait}ms`);
      await sleep(wait);
    }
  }
  return { ok: false, status: lastStatus, error: lastError, attempts };
}

/**
 * GET with retries for transient FootyWire errors.
 */
async function fetchFootywireText(url, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || process.env.FOOTYWIRE_FETCH_ATTEMPTS || 5));
  const baseDelayMs = Math.max(500, Number(options.baseDelayMs || process.env.FOOTYWIRE_FETCH_DELAY_MS || 2500));
  const headers = options.headers || DEFAULT_HEADERS;

  let lastStatus = 0;
  let lastError = '';
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { headers });
      lastStatus = res.status;
      if (res.ok) return { ok: true, status: res.status, text: await res.text() };
      if (!isFootywireUnavailableStatus(res.status)) {
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      lastStatus = 0;
    }
    if (i < attempts - 1) {
      const wait = baseDelayMs * (i + 1);
      await sleep(wait);
    }
  }
  return { ok: false, status: lastStatus, error: lastError || `HTTP ${lastStatus}` };
}

module.exports = {
  DEFAULT_HEADERS,
  isFootywireUnavailableStatus,
  probeFootywire,
  fetchFootywireText,
};
