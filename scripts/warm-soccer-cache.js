#!/usr/bin/env node

const baseUrl = String(process.env.PROD_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
const limit = String(process.env.SOCCER_WARM_LIMIT || 'all').trim();
const concurrency = Math.max(1, parseInt(process.env.SOCCER_WARM_CONCURRENCY || '2', 10));
const refresh = String(process.env.SOCCER_WARM_REFRESH || '1') === '1';
const team = String(process.env.SOCCER_WARM_TEAM || '').trim();
const cronSecret = String(process.env.CRON_SECRET || '').trim();

if (!baseUrl) {
  console.error('Missing PROD_URL');
  process.exit(1);
}

async function main() {
  const params = new URLSearchParams({
    limit,
    concurrency: String(concurrency),
    refresh: refresh ? '1' : '0',
  });
  if (team) params.set('team', team);
  const headers = { Accept: 'application/json' };
  if (cronSecret) {
    headers.Authorization = `Bearer ${cronSecret}`;
    headers['X-Cron-Secret'] = cronSecret;
  }

  const url = `${baseUrl}/api/cron/warm-soccer-cache?${params.toString()}`;
  console.log(`[Soccer Warm] GET ${url}`);
  const response = await fetch(url, { headers });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    console.error('[Soccer Warm] Failed:', payload?.error || `HTTP ${response.status}`);
    process.exit(1);
  }

  console.log(JSON.stringify(payload, null, 2));
  if (payload && payload.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[Soccer Warm] Unexpected failure:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
