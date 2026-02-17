#!/usr/bin/env node

/**
 * Compare player game-log stats from FootyWire vs AFLTables (no app changes).
 * Fetches FootyWire pg- page (basic + advanced) and our player-game-logs API,
 * then writes a comparison report.
 *
 *   node scripts/compare-afl-stats-sources.js
 *   node scripts/compare-afl-stats-sources.js --player="Nick Daicos" --team="Collingwood Magpies" --season=2025
 */

const fs = require('fs');
const path = require('path');

const FOOTYWIRE_BASE = 'https://www.footywire.com';

function getArg(name, fallback) {
  const pref = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(pref));
  if (!raw) return fallback;
  return raw.slice(pref.length);
}

function htmlToText(v) {
  return String(v || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build FootyWire pg- URL: pg-{team-slug}--{player-slug}, e.g. pg-collingwood-magpies--nick-daicos */
function footyWireGameLogUrl(teamName, playerName, year, advanced = false) {
  const teamSlug = teamName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const playerSlug = playerName.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const base = `${FOOTYWIRE_BASE}/afl/footy/pg-${teamSlug}--${playerSlug}`;
  const params = new URLSearchParams();
  if (year) params.set('year', String(year));
  if (advanced) params.set('advv', 'Y');
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Parse FootyWire pg- page: find game log table and return headers + rows.
 * FootyWire uses nested tables; the games log has a header row with Description, Date, Opponent, Result, K, HB, D, ...
 */
function parseFootyWireGameLog(html) {
  const result = { headers: [], rows: [], advanced: false };
  if (!html || !html.includes('footywire')) return result;

  // Detect advanced view
  result.advanced = /advv=Y|Advanced stats currently displayed|View Basic Stats/i.test(html);

  // FootyWire games log: look for the row that contains "Opponent" and "Result" and "K" (header row)
  const headerRowMatch = html.match(
    /<tr[^>]*>\s*<t[dh][^>]*>\s*[^<]*Description[^<]*<\/t[dh]>[\s\S]*?<t[dh][^>]*>\s*[^<]*Opponent[^<]*<\/t[dh]>[\s\S]*?<t[dh][^>]*>\s*[^<]*Result[^<]*<\/t[dh]>([\s\S]*?)<\/tr>/i
  );
  if (!headerRowMatch) {
    // Fallback: find any <tr> that has both "Opponent" and "K" in cell content
    const alt = html.match(/<tr[^>]*>([\s\S]*?Opponent[\s\S]*?Result[\s\S]*?<\/tr>)/i);
    if (!alt) return result;
  }

  // Extract all table rows from the main content (between "Games Log" title and a closing table)
  const gamesLogBlock = html.match(/Games Log for[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i);
  const tableContent = gamesLogBlock ? gamesLogBlock[1] : html;
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let trm;
  while ((trm = trRegex.exec(tableContent)) !== null) {
    const rowHtml = trm[1];
    const cells = [];
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cm;
    while ((cm = tdRegex.exec(rowHtml)) !== null) {
      cells.push(htmlToText(cm[1]));
    }
    if (cells.length < 5) continue;
    rows.push(cells);
  }

  // Header row: Description, Date, Opponent, Result + either basic (K) or advanced (CP) stat columns
  const headerIdx = rows.findIndex(
    (r) =>
      r.some((c) => /^Description$/i.test(c.trim())) &&
      r.some((c) => /^Opponent$/i.test(c.trim())) &&
      r.some((c) => /^Result$/i.test(c.trim())) &&
      (r.some((c) => /^K$/i.test(c.trim())) || r.some((c) => /^CP$/i.test(c.trim())))
  );
  if (headerIdx < 0) return result;

  result.headers = rows[headerIdx].map((c) => c.trim());
  result.rows = rows.slice(headerIdx + 1).filter((r) => {
    // Data rows: first cell often "Round N" or "Preliminary Final", and have numbers in later columns
    const first = (r[0] || '').trim();
    if (!first) return false;
    const hasRoundOrDescription = /Round|Final|Semi|Qualifying|Preliminary|Grand|Description/i.test(first) || /^R\d+$/i.test(first);
    const hasNumbers = r.some((c, i) => i >= 4 && /^\d+$/.test(String(c).trim()));
    return hasRoundOrDescription && !/^Date$/i.test(first) && (hasNumbers || r.length >= 10);
  });

  return result;
}

async function fetchFootyWireGameLog(teamName, playerName, year, advanced) {
  const url = footyWireGameLogUrl(teamName, playerName, year, advanced);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-AU,en;q=0.9',
      Referer: 'https://www.footywire.com/',
    },
  });
  if (!res.ok) return { ok: false, status: res.status, html: '', parsed: null };
  const html = await res.text();
  const parsed = parseFootyWireGameLog(html);
  return { ok: true, url, html, parsed };
}

async function fetchAflTablesViaApi(playerName, season, baseUrl = 'http://localhost:3000') {
  const url = `${baseUrl}/api/afl/player-game-logs?season=${season}&player_name=${encodeURIComponent(playerName)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, status: res.status, data: null };
    const data = await res.json();
    if (data.error) return { ok: false, error: data.error, data: null };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e.message), data: null };
  }
}

/** AFLTables GameLogRow keys we expose (from player-game-logs route). */
const AFL_TABLES_STAT_KEYS = [
  'season', 'game_number', 'opponent', 'round', 'result', 'guernsey',
  'kicks', 'marks', 'handballs', 'disposals', 'goals', 'behinds', 'hitouts', 'tackles',
  'rebounds', 'inside_50s', 'clearances', 'clangers', 'free_kicks_for', 'free_kicks_against',
  'brownlow_votes', 'contested_possessions', 'uncontested_possessions', 'contested_marks',
  'marks_inside_50', 'one_percenters', 'bounces', 'goal_assists', 'percent_played', 'match_url',
];

function main() {
  const playerName = getArg('player', 'Nick Daicos');
  const teamName = getArg('team', 'Collingwood Magpies');
  const season = parseInt(getArg('season', '2025'), 10) || 2025;
  const baseUrl = getArg('base', 'http://localhost:3000');
  const outDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    playerName,
    teamName,
    season,
    footyWire: { basic: null, advanced: null },
    aflTables: null,
    comparison: null,
  };

  return (async () => {
    console.log('Fetching FootyWire basic game log...');
    const fwBasic = await fetchFootyWireGameLog(teamName, playerName, season, false);
    report.footyWire.basic = {
      url: fwBasic.url,
      ok: fwBasic.ok,
      status: fwBasic.status,
      headers: fwBasic.parsed?.headers || [],
      rowCount: fwBasic.parsed?.rows?.length ?? 0,
      sampleRow: fwBasic.parsed?.rows?.[0] || [],
    };
    if (fwBasic.ok && fwBasic.parsed) {
      console.log('  Headers:', report.footyWire.basic.headers.length, report.footyWire.basic.headers.slice(0, 15).join(', '));
      console.log('  Rows:', report.footyWire.basic.rowCount);
    } else {
      console.log('  Failed:', fwBasic.status || fwBasic.error);
    }

    console.log('Fetching FootyWire advanced game log (advv=Y)...');
    const fwAdv = await fetchFootyWireGameLog(teamName, playerName, season, true);
    report.footyWire.advanced = {
      url: fwAdv.url,
      ok: fwAdv.ok,
      status: fwAdv.status,
      headers: fwAdv.parsed?.headers || [],
      rowCount: fwAdv.parsed?.rows?.length ?? 0,
      sampleRow: fwAdv.parsed?.rows?.[0] || [],
    };
    if (fwAdv.ok && fwAdv.parsed) {
      console.log('  Headers:', report.footyWire.advanced.headers.length, report.footyWire.advanced.headers.slice(0, 20).join(', '));
      console.log('  Rows:', report.footyWire.advanced.rowCount);
    } else {
      console.log('  Failed:', fwAdv.status || fwAdv.error);
    }

    console.log('Fetching AFLTables via API (player-game-logs)...');
    const afl = await fetchAflTablesViaApi(playerName, season, baseUrl);
    if (afl.ok && afl.data) {
      report.aflTables = {
        source: afl.data.source,
        player_name: afl.data.player_name,
        gamesCount: (afl.data.games || []).length,
        statKeys: AFL_TABLES_STAT_KEYS,
        sampleGame: afl.data.games?.[0] || null,
      };
      console.log('  Games:', report.aflTables.gamesCount);
      console.log('  Stat keys:', report.aflTables.statKeys.length);
    } else {
      report.aflTables = { ok: false, error: afl.error || `status ${afl.status}` };
      console.log('  API not available or error:', report.aflTables.error);
    }

    // Comparison
    const fwBasicHeaders = (report.footyWire.basic?.headers || []).map((h) => h.trim().toUpperCase());
    const fwAdvHeaders = (report.footyWire.advanced?.headers || []).map((h) => h.trim().toUpperCase());
    const aflStatKeys = new Set((report.aflTables?.statKeys || []).map((k) => k.toUpperCase().replace(/_/g, ' ')));
    const headerToAfl = {
      K: 'kicks', HB: 'handballs', D: 'disposals', M: 'marks', G: 'goals', B: 'behinds',
      T: 'tackles', HO: 'hitouts', I50: 'inside_50s', CL: 'clearances', R50: 'rebounds',
      FF: 'free_kicks_for', FA: 'free_kicks_against', GA: 'goal_assists',
      CP: 'contested_possessions', UP: 'uncontested_possessions', CM: 'contested_marks',
      'MI5': 'marks_inside_50', '1%': 'one_percenters', BO: 'bounces',
      DE: 'disposal_efficiency', ED: 'effective_disposals', MG: 'metres_gained',
      SI: 'score_involvements', TO: 'turnovers', TOG: 'percent_played',
    };
    const inBoth = [];
    const onlyFootyWire = [];
    for (const h of [...new Set([...fwBasicHeaders, ...fwAdvHeaders])]) {
      const normalized = h.replace(/\s+/g, '_').replace(/%/g, 'pct');
      const aflKey = headerToAfl[h] || normalized.toLowerCase();
      if (aflStatKeys.has(aflKey.toUpperCase().replace(/_/g, ' '))) inBoth.push(h);
      else onlyFootyWire.push(h);
    }
    const onlyAflTables = AFL_TABLES_STAT_KEYS.filter(
      (k) => !fwBasicHeaders.some((h) => headerToAfl[h] === k) && !fwAdvHeaders.some((h) => headerToAfl[h] === k)
    );

    report.comparison = {
      footyWireBasicColumns: report.footyWire.basic?.headers?.length ?? 0,
      footyWireAdvancedColumns: report.footyWire.advanced?.headers?.length ?? 0,
      aflTablesStatKeys: AFL_TABLES_STAT_KEYS.length,
      inBoth,
      onlyFootyWire,
      onlyAflTables,
      notes: [
        'FootyWire pg- URL: pg-{team-slug}--{player-slug}?year=YEAR&advv=Y for advanced.',
        'AFLTables requires players index + player page scrape and name matching.',
      ],
    };

    const outPath = path.join(outDir, `afl-stats-source-comparison-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log('\nReport written to', outPath);

    // Optional: save raw FootyWire HTML for debugging
    if (fwBasic.ok && fwBasic.html) {
      const htmlPath = path.join(outDir, `footywire-pg-basic-${season}-sample.html`);
      fs.writeFileSync(htmlPath, fwBasic.html, 'utf8');
      console.log('FootyWire basic HTML sample:', htmlPath);
    }
    if (fwAdv.ok && fwAdv.html) {
      const htmlPath = path.join(outDir, `footywire-pg-advanced-${season}-sample.html`);
      fs.writeFileSync(htmlPath, fwAdv.html, 'utf8');
      console.log('FootyWire advanced HTML sample:', htmlPath);
    }

    return report;
  })();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
