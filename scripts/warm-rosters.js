#!/usr/bin/env node

/*
 * Warm upcoming rosters via internal endpoint.
 * - Uses ESPN scoreboard to find games and triggers /api/depth-chart for teams within window minutes of tip.
 * - Default window is 180 minutes (3 hours).
 *
 * Usage:
 *   # single run against local dev server
 *   node scripts/warm-rosters.js
 *
 *   # customize
 *   BASE_URL=https://your.app ROSTER_WINDOW_MIN=240 node scripts/warm-rosters.js
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const WINDOW_MIN = parseInt(process.env.ROSTER_WINDOW_MIN || '180', 10);

function ymd(d){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const da=String(d.getDate()).padStart(2,'0'); return `${y}${m}${da}`; }

async function tryDate(d){
  const url = `${BASE.replace(/\/$/,'')}/api/depth-chart/warm-tminus10?date=${ymd(d)}&window_min=${encodeURIComponent(String(WINDOW_MIN))}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const txt = await res.text();
  console.log(`[warm-rosters] ${res.status} ${url}`);
  console.log(txt);
  return { status: res.status, body: txt };
}

async function main(){
  try{
    const today = new Date();
    // Try today, then yesterday, then tomorrow
    const order = [0, -1, 1];
    for (const off of order){
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate()+off);
      const r = await tryDate(d);
      if (r.status === 200 && /"success"\s*:\s*true/.test(r.body)) return;
    }
    console.error('[warm-rosters] No games found for today/±1');
    process.exit(2);
  }catch(e){
    console.error('[warm-rosters] ERROR', e?.message || e);
    process.exit(1);
  }
}

main();
