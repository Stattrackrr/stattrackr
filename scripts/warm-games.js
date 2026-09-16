// Simple local warmer (optional). Set BASE_URL to your deployed site.
// Usage: BASE_URL=https://your.app npm run warm:games

const fetch = globalThis.fetch;

function currentSeason() {
  const now = new Date();
  const m = now.getMonth();
  const d = now.getDate();
  // season year flips mid-October; match your app logic
  if (m === 9 && d >= 15) return now.getFullYear();
  return m >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}

(async () => {
  const base = process.env.BASE_URL || 'http://localhost:3000';
  const season = currentSeason();
  const url = `${base}/api/cache/warm-games?seasons[]=${season}&per_page=100`;
  console.log('Warming:', url);
  const res = await fetch(url, { method: 'POST' });
  const txt = await res.text();
  console.log('Status:', res.status, txt);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
