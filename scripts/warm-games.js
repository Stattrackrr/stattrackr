// Simple local warmer (optional). Set BASE_URL to your deployed site.
// Usage: BASE_URL=https://your.app npm run warm:games
// Copy WC logo: node scripts/warm-games.js copy-world-cup-logo

if (process.argv.includes('copy-world-cup-logo')) {
  const fs = require('fs');
  const path = require('path');
  const DOWNLOADS_STEM = 'fifa_trophy_transparent_v2';
  const DOWNLOADS_EXTENSIONS = ['.png', '.webp'];
  const root = path.resolve(__dirname, '..');
  const dest = path.join(root, 'public', 'images', 'world-cup-logo.png');
  const downloadCandidates = DOWNLOADS_EXTENSIONS.flatMap((ext) => [
    path.join(process.env.USERPROFILE || '', 'Downloads', `${DOWNLOADS_STEM}${ext}`),
    path.join('C:/Users/nduar/Downloads', `${DOWNLOADS_STEM}${ext}`),
  ]);
  const src = downloadCandidates.find((candidate) => fs.existsSync(candidate));
  if (!src) {
    if (fs.existsSync(dest)) {
      console.log('World Cup logo already present at', dest);
      process.exit(0);
    }
    console.warn('World Cup logo not found in Downloads; skipping copy.');
    process.exit(0);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('Copied', src, '->', dest, '(' + fs.statSync(dest).size + ' bytes)');
  process.exit(0);
}

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
