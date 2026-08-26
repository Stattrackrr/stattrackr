#!/usr/bin/env tsx
/** Print NBL play-type tags for a season (default 2025 / NBL26). */
import { buildNblPlayTypesPayload, NBL_PLAY_TYPE_IDS } from '../lib/nbl/playTypes';

const year = Number(process.argv.find((a) => a.startsWith('--year='))?.slice(7) || 2025);
const payload = buildNblPlayTypesPayload({ year, stat: 'points' });

console.log(`${payload.seasonLabel} tagged ${payload.taggedCount} players\n`);
for (const id of NBL_PLAY_TYPE_IDS) {
  const group = payload.players.filter((p) => p.type === id);
  const names = group
    .slice()
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, 8)
    .map((p) => `${p.name} (${p.points ?? '—'}p ${p.assists ?? '—'}a ${p.usgPct ?? '—'}u)`)
    .join(', ');
  console.log(`${id.padEnd(14)} ${String(group.length).padStart(3)}  ${names}`);
}

const harvey = payload.players.find((p) => /tyler harvey/i.test(p.name));
if (harvey) {
  console.log(
    `\nTyler Harvey: ${harvey.type}  ${harvey.points}p ${harvey.assists}a  usg ${harvey.usgPct ?? '—'}`
  );
}
