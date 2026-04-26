/**
 * One-off: fetch a team /results/ page and report parse counts (no limit vs 24).
 * Run: npx tsx scripts/test-soccerway-team-results.ts
 */
import { parseSoccerwayTeamResultsHtml } from '../lib/soccerwayTeamResults';

async function main() {
  const href = process.argv[2] || '/team/arsenal/hA1Zm19f/';
  const base = href.replace(/\/+$/, '');
  const url = `https://www.soccerway.com${base.startsWith('/') ? base : `/${base}`}/results/`;

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    console.error('HTTP', res.status, url);
    process.exit(1);
  }

  const html = await res.text();
  const all = parseSoccerwayTeamResultsHtml(html);
  const capped = parseSoccerwayTeamResultsHtml(html, 24);

  const fmt = (unix: number | null) =>
    unix != null && unix > 1_000_000_000 ? new Date(unix * 1000).toISOString().slice(0, 10) : '?';

  console.log('url', url);
  console.log('htmlBytes', html.length);
  console.log('parsedNoLimit', all.length);
  console.log('parsedLimit24', capped.length);
  if (all.length) {
    const a = all[0];
    const b = all[all.length - 1];
    console.log('first', a.homeTeam, `${a.homeScore}-${a.awayScore}`, a.awayTeam, fmt(a.kickoffUnix));
    console.log('last', b.homeTeam, `${b.homeScore}-${b.awayScore}`, b.awayTeam, fmt(b.kickoffUnix));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
