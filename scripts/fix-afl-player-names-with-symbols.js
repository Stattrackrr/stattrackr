#!/usr/bin/env node

/**
 * Find AFL players whose names contain symbols (hyphen, apostrophe, etc.)
 * and fix them to match FootyWire's canonical display format.
 *
 * Reads data/afl-league-player-stats-*.json, fetches FootyWire ft_players
 * for canonical names, and optionally updates the JSON files or writes a mapping.
 *
 *   node scripts/fix-afl-player-names-with-symbols.js
 *   node scripts/fix-afl-player-names-with-symbols.js --apply
 *   node scripts/fix-afl-player-names-with-symbols.js --season=2025
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');

const FOOTYWIRE_BASE = 'https://www.footywire.com';

// Names containing these are considered "with symbols" (hyphen, apostrophe, etc.)
const SYMBOL_REGEX = /[-'.,&]/;

// Unicode hyphens/dashes that may appear in names (e.g. from FootyWire HTML)
const UNICODE_DASHES = /[\u2010-\u2015\u2212\u00AD]/g;

function getArg(name, fallback) {
  const pref = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(pref));
  if (!raw) return fallback;
  return raw.slice(pref.length);
}

function normalizeForMatch(name) {
  return (name || '')
    .replace(UNICODE_DASHES, ' ')
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/[-']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Same words in any order (handles "Will Hoskin-Elliott" vs slug "hoskin-elliott-will"). */
function wordSetKey(name) {
  return normalizeForMatch(name)
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function slugToCanonical(slug) {
  return (slug || '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Parse FootyWire ft_players page for all player links.
 * Returns array of { playerSlug, linkText, team, canonicalFirstLast }.
 */
async function fetchFootyWirePlayerNames() {
  const url = `${FOOTYWIRE_BASE}/afl/footy/ft_players`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-AU,en;q=0.9',
      Referer: 'https://www.footywire.com/',
    },
  });
  if (!res.ok) throw new Error(`FootyWire ft_players failed: ${res.status}`);
  const html = await res.text();
  const players = [];
  const linkRe = /href=["'](?:pp|pg)-([^"'\-]+(?:-[^"'\-]+)*)--([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const teamSlug = (m[1] || '').trim().toLowerCase();
    const playerSlug = (m[2] || '').trim();
    let linkText = (m[3] || '').trim().replace(/\s+/g, ' ');
    linkText = linkText.replace(UNICODE_DASHES, '-');
    if (!playerSlug) continue;
    const slugNorm = playerSlug.toLowerCase().replace(/-/g, ' ');
    let canonicalFirstLast;
    if (linkText.includes(',')) {
      const [surname, first] = linkText.split(',').map((s) => s.trim());
      if (surname && first) canonicalFirstLast = `${first} ${surname}`.trim();
      else canonicalFirstLast = slugToCanonical(playerSlug);
    } else {
      canonicalFirstLast = linkText || slugToCanonical(playerSlug);
    }
    players.push({
      playerSlug,
      slugNorm,
      linkText,
      team: teamSlug,
      canonicalFirstLast: canonicalFirstLast || slugToCanonical(playerSlug),
    });
  }
  return players;
}

function loadLeagueStatsFiles() {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) return [];
  const files = fs.readdirSync(dataDir).filter((f) => f.startsWith('afl-league-player-stats-') && f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    const filePath = path.join(dataDir, f);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const season = data.season || f.replace(/\D/g, '') || null;
      const players = Array.isArray(data.players) ? data.players : [];
      out.push({ filePath, season, players, data });
    } catch (e) {
      console.warn(`  Skip ${f}: ${e.message}`);
    }
  }
  return out;
}

function collectNamesWithSymbols(leagueFiles) {
  const byNormalized = new Map();
  for (const { season, players } of leagueFiles) {
    for (const p of players) {
      const name = (p.name || '').trim();
      if (!name || !SYMBOL_REGEX.test(name)) continue;
      const norm = normalizeForMatch(name);
      if (!byNormalized.has(norm)) byNormalized.set(norm, { name, seasons: [], raw: p });
      byNormalized.get(norm).seasons.push(season);
    }
  }
  return Array.from(byNormalized.values());
}

function matchToFootyWire(ourEntry, fwPlayers, fwByWordSet) {
  const ourNorm = normalizeForMatch(ourEntry.name);
  const ourWordSet = wordSetKey(ourEntry.name);
  const ourWords = ourNorm.split(/\s+/).filter(Boolean);
  for (const fw of fwPlayers) {
    if (fw.slugNorm === ourNorm) return fw.canonicalFirstLast;
    if (normalizeForMatch(fw.canonicalFirstLast) === ourNorm) return fw.canonicalFirstLast;
  }
  const byWordSet = fwByWordSet.get(ourWordSet);
  if (byWordSet) return byWordSet.canonicalFirstLast;
  // Last resort: FW slug/canonical contains all our words (handles alternate hyphen/encoding)
  for (const fw of fwPlayers) {
    const fwNorm = normalizeForMatch(fw.canonicalFirstLast);
    const fwSlugNorm = fw.slugNorm;
    const hasAll =
      ourWords.length > 0 &&
      ourWords.every((w) => fwNorm.includes(w) || fwSlugNorm.includes(w));
    if (hasAll && fwNorm.split(/\s+/).filter(Boolean).length === ourWords.length) {
      return fw.canonicalFirstLast;
    }
  }
  return null;
}

function buildFootyWireWordSetIndex(fwPlayers) {
  const map = new Map();
  for (const fw of fwPlayers) {
    const key = wordSetKey(fw.canonicalFirstLast);
    if (!map.has(key)) map.set(key, fw);
  }
  return map;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const seasonArg = getArg('season', null);
  const dataDir = path.join(process.cwd(), 'data');

  console.log('Loading league player stats...');
  let leagueFiles = loadLeagueStatsFiles();
  if (leagueFiles.length === 0) {
    console.log('No afl-league-player-stats-*.json found. Run: npm run fetch:footywire-league-player-stats');
    process.exit(1);
  }
  if (seasonArg) {
    const year = parseInt(seasonArg, 10);
    leagueFiles = leagueFiles.filter((f) => f.season === year);
    if (leagueFiles.length === 0) {
      console.log(`No file for season ${seasonArg}`);
      process.exit(1);
    }
  }

  const withSymbols = collectNamesWithSymbols(leagueFiles);
  console.log(`Found ${withSymbols.length} unique player names with symbols (hyphen, apostrophe, etc.)`);

  if (withSymbols.length === 0) {
    console.log('Nothing to fix.');
    process.exit(0);
  }

  console.log('Fetching FootyWire ft_players for canonical names...');
  const fwPlayers = await fetchFootyWirePlayerNames();
  console.log(`  Parsed ${fwPlayers.length} players from FootyWire`);
  const fwByWordSet = buildFootyWireWordSetIndex(fwPlayers);

  const mapping = {};
  const report = [];
  for (const entry of withSymbols) {
    const canonical = matchToFootyWire(entry, fwPlayers, fwByWordSet);
    if (canonical && canonical !== entry.name) {
      mapping[entry.name] = canonical;
      report.push({ from: entry.name, to: canonical, status: 'fix' });
    } else if (canonical) {
      report.push({ from: entry.name, to: canonical, status: 'ok' });
    } else {
      report.push({ from: entry.name, to: null, status: 'noMatch' });
    }
  }

  console.log('');
  console.log('Players with symbols:');
  for (const r of report) {
    if (r.status === 'noMatch') {
      console.log(`  "${r.from}"  (no FootyWire match – keep as-is)`);
    } else if (r.status === 'fix') {
      console.log(`  "${r.from}"  →  "${r.to}"`);
    } else {
      console.log(`  "${r.from}"  (OK – matches FootyWire)`);
    }
  }

  const okCount = report.filter((r) => r.status === 'ok').length;
  const fixCount = report.filter((r) => r.status === 'fix').length;
  const noMatchCount = report.filter((r) => r.status === 'noMatch').length;
  console.log('');
  console.log(`Summary: ${okCount} already match, ${fixCount} to fix, ${noMatchCount} no match`);

  const mappingPath = path.join(dataDir, 'afl-player-name-fixes.json');
  const mappingContent = {
    generatedAt: new Date().toISOString(),
    source: 'footywire.com',
    description: 'Canonical display names for players whose names contain symbols (e.g. hyphen, apostrophe)',
    mapping,
  };
  fs.writeFileSync(mappingPath, JSON.stringify(mappingContent, null, 2), 'utf8');
  console.log(`\nWrote mapping to ${mappingPath} (${Object.keys(mapping).length} fixes)`);

  if (apply && Object.keys(mapping).length > 0) {
    console.log('\nApplying fixes to league stats files...');
    for (const { filePath, players, data } of leagueFiles) {
      let changed = 0;
      for (const p of players) {
        const fixed = mapping[p.name];
        if (fixed) {
          p.name = fixed;
          changed++;
        }
      }
      if (changed > 0) {
        data.players = players;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`  Updated ${path.basename(filePath)}: ${changed} names`);
      }
    }
  } else if (Object.keys(mapping).length > 0) {
    console.log('\nRun with --apply to update afl-league-player-stats-*.json in place.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
