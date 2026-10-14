const BDL_BASE = 'https://api.balldontlie.io';

export type BdlPage<T> = { data: T[]; meta?: { next_cursor?: number | null; per_page?: number } };

export type BdlClientOptions = {
  apiKey: string;
  /** Requests per minute. The live site shares the key, so stay well under the 600 plan limit. */
  perMinute?: number;
  maxRetries?: number;
};

export class BdlClient {
  private readonly apiKey: string;
  private readonly intervalMs: number;
  private readonly maxRetries: number;
  private nextSlot = 0;
  requests = 0;

  constructor(opts: BdlClientOptions) {
    if (!opts.apiKey) throw new Error('BALLDONTLIE_API_KEY is not set');
    this.apiKey = opts.apiKey;
    this.intervalMs = 60_000 / (opts.perMinute ?? 360);
    this.maxRetries = opts.maxRetries ?? 5;
  }

  private async slot(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.nextSlot);
    this.nextSlot = at + this.intervalMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }

  async get<T = unknown>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.slot();
      this.requests++;
      let res: Response;
      try {
        res = await fetch(`${BDL_BASE}${path}`, {
          headers: { Authorization: this.apiKey },
          signal: AbortSignal.timeout(60_000),
        });
      } catch (err) {
        if (attempt >= this.maxRetries) throw err;
        await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
        continue;
      }
      if (res.ok) return (await res.json()) as T;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.maxRetries) {
        const body = (await res.text().catch(() => '')).slice(0, 200);
        throw new Error(`BDL ${res.status} ${path}: ${body}`);
      }
      await new Promise((r) => setTimeout(r, res.status === 429 ? 15_000 : 3_000 * (attempt + 1)));
    }
  }

  /** Follows meta.next_cursor until exhausted (per_page 100). */
  async all<T>(path: string, onPage?: (rows: T[]) => void | Promise<void>): Promise<T[]> {
    const out: T[] = [];
    let cursor: number | null | undefined;
    const sep = path.includes('?') ? '&' : '?';
    do {
      const page = await this.get<BdlPage<T>>(
        `${path}${sep}per_page=100${cursor != null ? `&cursor=${cursor}` : ''}`
      );
      const rows = page.data ?? [];
      if (onPage) await onPage(rows);
      else out.push(...rows);
      cursor = page.meta?.next_cursor;
    } while (cursor != null);
    return out;
  }
}
