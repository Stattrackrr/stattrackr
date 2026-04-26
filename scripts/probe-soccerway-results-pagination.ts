/**
 * Probe Soccerway team /results/ HTML for "show more" / feed URLs.
 * Run: npx tsx scripts/probe-soccerway-results-pagination.ts
 */
async function main() {
  const url = process.argv[2] || 'https://www.soccerway.com/team/arsenal/hA1Zm19f/results/';
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(60_000),
  });
  const html = await res.text();
  console.log('status', res.status, 'bytes', html.length);

  const needles = [
    'show more',
    'Show more games',
    'more games',
    'MORE_GAMES',
    'loadMore',
    'load_more',
    'offset',
    'cursor',
    'nextPage',
    'pq_graphql',
    'participant',
    'dapi',
    'api.soccerway',
    'ajax',
    'feed',
    'results/',
    'teamfixtures',
    'team-results',
    'block_service',
  ];
  const lower = html.toLowerCase();
  for (const k of needles) {
    const i = lower.indexOf(k.toLowerCase());
    if (i >= 0) console.log('needle', JSON.stringify(k), 'at', i);
  }

  const feeds = html.match(/https?:\/\/[^"'\\s>]+flashscore[^"'\\s>]*feed[^"'\\s>]*/gi);
  if (feeds) console.log('flashscore feed urls', [...new Set(feeds)].slice(0, 15));

  const dFeed = html.match(/https?:\/\/d\.[^"'\\s>]+/gi);
  if (dFeed) console.log('d.* urls sample', [...new Set(dFeed)].slice(0, 20));

  const urlPatterns: RegExp[] = [
    /https?:\/\/[^"'\\s>]+participant[^"'\\s>]*/gi,
    /https?:\/\/[^"'\\s>]+pq_graphql[^"'\\s>]*/gi,
    /https?:\/\/d\.en\.spt[^"'\\s>]*/gi,
    /\/\/d\.en\.spt[^"'\\s>]*/gi,
    /"[^"]*block_service[^"]*"/gi,
    /"[^"]*team[^"]*results[^"]*"/gi,
  ];
  for (const re of urlPatterns) {
    const m = html.match(re);
    if (m?.length) console.log(String(re), 'count', m.length, 'sample', [...new Set(m)].slice(0, 6));
  }

  // Flashscore-style embedded feed path (often in page config)
  const cfg = html.match(/pathToRootFile[^;]+/g);
  if (cfg) console.log('pathToRootFile lines', cfg.slice(0, 5));

  for (const pat of [/df_[a-z0-9_]+/gi, /c_team_[a-z0-9_]+/gi, /team_[0-9]+_[0-9]+/gi, /participant\/[0-9]+/gi]) {
    const m = html.match(pat);
    if (m) console.log(String(pat), 'unique sample', [...new Set(m)].slice(0, 12));
  }

  const env = html.match(/window\.environment\s*=\s*\{[^<]{100,8000}\}/);
  if (env) console.log('\nwindow.environment snippet', env[0].slice(0, 2500));

  const swConfig = html.match(/sw\.[a-zA-Z0-9_$]+=\{[^}]{20,800}\}/g);
  if (swConfig) console.log('sw.* object snippets', swConfig.slice(0, 3).map((s) => s.slice(0, 400)));

  const mgRe = /.{0,120}(more.games|more_games|MORE_GAMES).{0,400}/gi;
  const mgHits = html.match(mgRe);
  if (mgHits) console.log('\n--- regex hits (more games) ---\n', mgHits.slice(0, 8));

  const mg2 = lower.indexOf('more games');
  if (mg2 >= 0) {
    const ctx = html.slice(Math.max(0, mg2 - 300), mg2 + 600);
    console.log('\n--- context around "more games" ---\n', ctx.replace(/\s+/g, ' '));
  }

  const gq = html.indexOf('pq_graphql');
  if (gq >= 0) {
    console.log('\n--- start of pq_graphql region ---\n', html.slice(gq, gq + 1500).replace(/\s+/g, ' '));
  }

  const marker = 'participant-page-summary-results-more';
  const mi = html.indexOf(marker);
  if (mi >= 0) {
    console.log('\n--- HTML around participant-page-summary-results-more ---\n');
    console.log(html.slice(mi - 80, mi + 1200));
  }

  const passive = html.match(/fs-passive-link-more-games[^>]{0,2000}/gi);
  if (passive) console.log('\nfs-passive-link snippets', passive.slice(0, 5));

  const feedUrls = html.match(/https?:\/\/[a-z0-9.-]+\/2020\/x\/feed\/[^"'\\s]+/gi);
  if (feedUrls) console.log('\nfeed URLs in page', [...new Set(feedUrls)]);

  const ninja = [...new Set(html.match(/[a-z0-9.-]*flashscore[a-z0-9.-]*/gi) || [])].slice(0, 30);
  console.log('\nflashscore host tokens', ninja);

  const ifeed = html.indexOf('initialFeeds["summary-results"]');
  if (ifeed >= 0) console.log('\n--- after initialFeeds summary-results key ---\n', html.slice(ifeed, ifeed + 500).replace(/\s+/g, ' '));

  const feedKeys = [...html.matchAll(/cjs\.initialFeeds\["([^"]+)"\]\s*=\s*\{/g)].map((m) => m[1]);
  console.log('\ninitialFeeds keys', [...new Set(feedKeys)]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
