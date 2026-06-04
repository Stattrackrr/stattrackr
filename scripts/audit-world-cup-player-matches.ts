#!/usr/bin/env npx tsx
/**
 * Audit cross-competition player name matching for the World Cup dashboard.
 *
 * Verifies that World Cup players are correctly combined with their Euros
 * (statsbomb) and Nations League (api-football) stats, and flags any player at
 * risk of a wrong merge because of a shared/ambiguous name.
 *
 * Writes a full JSON report to data/world-cup-player-match-audit.json and
 * prints a summary (with the riskiest cases) to the console.
 *
 * Usage:
 *   npx tsx scripts/audit-world-cup-player-matches.ts
 *   npm run audit:world-cup:player-matches
 *
 * Exit code is non-zero when ambiguous (high-risk) matches are found, so it can
 * gate CI if desired.
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

const ENV_FILES = ['.env.local', '.env.development.local', '.env'];
for (const file of ENV_FILES) {
  const fullPath = path.resolve(process.cwd(), file);
  if (fs.existsSync(fullPath)) config({ path: fullPath, override: false });
}

function fmtEntry(e: {
  normalizedName: string;
  worldCup: { name: string; countryCode: string | null }[];
  international: { competition: string; name: string; nation: string | null; bdlPlayerId: string | null }[];
  reasons: string[];
}): string {
  const wc = e.worldCup.map((w) => `${w.name}${w.countryCode ? ` (${w.countryCode})` : ''}`).join(', ');
  const intl = e.international
    .map(
      (m) =>
        `${m.competition}:${m.name}${m.nation ? ` (${m.nation})` : ''}${m.bdlPlayerId ? ` bdl#${m.bdlPlayerId}` : ''}`
    )
    .join(', ');
  return `  • "${e.normalizedName}"\n      WC:   ${wc}\n      INTL: ${intl}\n      why:  ${e.reasons.join('; ')}`;
}

async function main() {
  const { auditWorldCupPlayerMatches } = await import('../lib/worldCupPlayerMatchAudit');

  console.log('[match-audit] auditing World Cup / Euros / Nations League name matching...');
  const report = await auditWorldCupPlayerMatches({ log: (msg) => console.log(msg) });

  const outPath = path.resolve(process.cwd(), 'data', 'world-cup-player-match-audit.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  const t = report.totals;
  console.log('\n================ World Cup match audit ================');
  console.log(`World Cup players (unique names): ${t.worldCupPlayers}`);
  console.log(`International rows scanned:        ${t.internationalRows}`);
  console.log(`Matched to Euros/Nations League:  ${t.matchedWorldCupPlayers}`);
  console.log(`  confident:        ${t.confident}`);
  console.log(`  country mismatch: ${t.countryMismatch}`);
  console.log(`  AMBIGUOUS (risk): ${t.ambiguous}`);
  console.log(`Unmatched WC players:             ${t.unmatched}`);
  console.log(`World Cup name collisions:        ${t.worldCupNameCollisions}`);
  console.log(`Intl rows with authoritative bdl_player_id: ${t.internationalWithBdlId}`);
  console.log(`Near-miss (same nation, likely SHOULD combine): ${t.nearMissSameNation}`);
  console.log(`Near-miss (different nation, name twins):        ${t.nearMissDiffNation}`);
  console.log(`\nFull report: ${outPath}`);

  if (report.ambiguous.length) {
    console.log(`\n--- AMBIGUOUS matches (review — could merge the wrong player) ---`);
    for (const e of report.ambiguous.slice(0, 30)) console.log(fmtEntry(e));
    if (report.ambiguous.length > 30) console.log(`  ...and ${report.ambiguous.length - 30} more (see JSON).`);
  }

  if (report.countryMismatch.length) {
    console.log(`\n--- COUNTRY MISMATCH (likely different person) ---`);
    for (const e of report.countryMismatch.slice(0, 20)) console.log(fmtEntry(e));
    if (report.countryMismatch.length > 20) console.log(`  ...and ${report.countryMismatch.length - 20} more (see JSON).`);
  }

  if (!report.ambiguous.length && !report.countryMismatch.length) {
    console.log('\nNo risky matches detected. Every matched World Cup player maps to a single, country-consistent international identity.');
  }

  if (report.nearMissSameNation.length) {
    console.log(`\n--- LIKELY MISSED COMBINES (similar name + same nation — review/add) ---`);
    for (const m of report.nearMissSameNation.slice(0, 40)) {
      console.log(
        `  • WC "${m.worldCupName}" (${m.worldCupNation ?? '?'})  ≈  ${m.competitions.join('/')}:"${m.candidateName}" (${
          m.candidateNation ?? '?'
        })  [${m.relation}${m.relation === 'fuzzy' ? ` d=${m.distance}` : ''}]`
      );
    }
    if (report.nearMissSameNation.length > 40) console.log(`  ...and ${report.nearMissSameNation.length - 40} more (see JSON).`);
  }

  // Non-zero exit when high-risk ambiguous matches exist.
  if (report.ambiguous.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[match-audit] failed', err);
  process.exitCode = 1;
});
