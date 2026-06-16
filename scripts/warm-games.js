// Simple local warmer (optional). Set BASE_URL to your deployed site.
// Usage: BASE_URL=https://your.app npm run warm:games
// Copy WC logo: node scripts/warm-games.js copy-world-cup-logo
// Write UTF-8 World Cup GitHub Actions workflows: node scripts/warm-games.js write-wc-workflows

if (process.argv.includes('write-wc-workflows')) {
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '..');
  const workflowsDir = path.join(root, '.github', 'workflows');

  const worldCupProcessStats = `name: World Cup Process Stats

on:
  schedule:
    - cron: '0 */2 * * *'
  workflow_dispatch:
    inputs:
      full_rebuild:
        description: 'Full BDL rebuild instead of incremental'
        required: false
        type: boolean
        default: false
      with_photos:
        description: 'Include squad photo warm (Phase 6)'
        required: false
        type: boolean
        default: false
      skip_local:
        description: 'Skip Supabase dashboard build (production warm only)'
        required: false
        type: boolean
        default: false

concurrency:
  group: world-cup-process-stats
  cancel-in-progress: false

env:
  TZ: Australia/Melbourne

jobs:
  world_cup_pipeline:
    runs-on: ubuntu-latest
    timeout-minutes: 180
    env:
      PROD_URL: \${{ secrets.PROD_URL }}
      CRON_SECRET: \${{ secrets.CRON_SECRET }}
      NEXT_PUBLIC_SUPABASE_URL: \${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: \${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      BALLDONTLIE_API_KEY: \${{ secrets.BALLDONTLIE_API_KEY }}
      BALL_DONT_LIE_API_KEY: \${{ secrets.BALL_DONT_LIE_API_KEY }}
      API_FOOTBALL_KEY: \${{ secrets.API_FOOTBALL_KEY }}
    steps:
      - name: Checkout
        uses: actions/checkout@v5

      - name: Setup Node.js
        uses: actions/setup-node@v5
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run full World Cup pipeline
        run: |
          set -euo pipefail
          ARGS="--full-pipeline --incremental"
          if [ "\${{ github.event.inputs.full_rebuild }}" = "true" ]; then
            ARGS="\${ARGS} --full"
          fi
          if [ "\${{ github.event.inputs.with_photos }}" = "true" ]; then
            ARGS="\${ARGS} --with-photos"
          fi
          if [ "\${{ github.event.inputs.skip_local }}" = "true" ]; then
            ARGS="\${ARGS} --skip-local"
          fi
          echo "Running: npx tsx scripts/build-world-cup-opponent-breakdown.ts \${ARGS}"
          npx --node-options=--max-old-space-size=8192 tsx scripts/build-world-cup-opponent-breakdown.ts \${ARGS}
        env:
          NODE_OPTIONS: '--max-old-space-size=8192'
`;

  const files = [['world-cup-process-stats.yml', worldCupProcessStats]];

  const stale = path.join(workflowsDir, 'refresh-world-cup-odds.yml');
  if (fs.existsSync(stale)) {
    fs.unlinkSync(stale);
    console.log('Removed stale', stale);
  }

  for (const [name, content] of files) {
    const target = path.join(workflowsDir, name);
    fs.writeFileSync(target, content.replace(/\r\n/g, '\n'), { encoding: 'utf8' });
    const bytes = fs.readFileSync(target);
    const nulls = [...bytes].filter((b) => b === 0).length;
    console.log('Wrote', target, 'bytes=', bytes.length, 'nulls=', nulls);
  }
  process.exit(0);
}

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
