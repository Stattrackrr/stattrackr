#!/usr/bin/env tsx
/**
 * Probe API-Tennis coverage: events, standings, a recent fixture week, and stat names.
 * Usage: npx tsx scripts/probe-api-tennis.ts
 */
import fs from 'fs';
import path from 'path';

function loadKey(): string {
  const envPath = path.join(process.cwd(), '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  const m = text.match(/^API_TENNIS_KEY=["']?([^"'\r\n]+)["']?/m);
  const key = (m?.[1] || process.env.API_TENNIS_KEY || '').trim();
  if (!key) throw new Error('API_TENNIS_KEY missing from .env.local');
  return key;
}

const KEY = loadKey();
const BASE = 'https://api.api-tennis.com/tennis/';

async function call(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ APIkey: KEY, ...params });
  const url = `${BASE}?${qs.toString()}`;
  const started = Date.now();
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const ms = Date.now() - started;
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { parseError: true, text: text.slice(0, 400) };
  }
  return { status: res.status, ms, json };
}

function summarizeStats(fixtures: any[]): { names: string[]; sample: any | null; finishedWithStats: number } {
  const names = new Set<string>();
  let sample: any = null;
  let finishedWithStats = 0;
  for (const fx of fixtures) {
    const stats = Array.isArray(fx.statistics) ? fx.statistics : [];
    if (stats.length) {
      finishedWithStats += 1;
      if (!sample) sample = fx;
      for (const st of stats) {
        names.add(`${st.stat_type || ''} / ${st.stat_name || ''} (${st.stat_period || ''})`);
      }
    }
  }
  return { names: [...names].sort(), sample, finishedWithStats };
}

async function main() {
  console.log('[probe] get_events');
  const events = await call({ method: 'get_events' });
  const eventList = Array.isArray(events.json?.result) ? events.json.result : [];
  console.log(`  HTTP ${events.status} ${events.ms}ms success=${events.json?.success} types=${eventList.length}`);
  console.log(eventList.map((e: any) => `${e.event_type_key}=${e.event_type_type}`).join('\n  '));

  console.log('\n[probe] get_standings ATP');
  const atp = await call({ method: 'get_standings', event_type: 'ATP' });
  const atpRows = Array.isArray(atp.json?.result) ? atp.json.result : [];
  console.log(`  HTTP ${atp.status} ${atp.ms}ms players=${atpRows.length} top3=`, atpRows.slice(0, 3));

  console.log('\n[probe] get_standings WTA');
  const wta = await call({ method: 'get_standings', event_type: 'WTA' });
  const wtaRows = Array.isArray(wta.json?.result) ? wta.json.result : [];
  console.log(`  HTTP ${wta.status} ${wta.ms}ms players=${wtaRows.length} top3=`, wtaRows.slice(0, 3));

  const atpSingles = eventList.find((e: any) => String(e.event_type_type).toLowerCase() === 'atp singles');
  const wtaSingles = eventList.find((e: any) => String(e.event_type_type).toLowerCase() === 'wta singles');
  console.log('\n[probe] singles keys', { atp: atpSingles, wta: wtaSingles });

  const ranges = [
    { label: 'last-7-days-atp', start: '2026-08-31', stop: '2026-09-07', event_type_key: String(atpSingles?.event_type_key || '265') },
    { label: 'month-atp', start: '2026-08-01', stop: '2026-08-31', event_type_key: String(atpSingles?.event_type_key || '265') },
  ];

  for (const range of ranges) {
    console.log(`\n[probe] get_fixtures ${range.label} ${range.start}..${range.stop}`);
    const fx = await call({
      method: 'get_fixtures',
      date_start: range.start,
      date_stop: range.stop,
      event_type_key: range.event_type_key,
    });
    const rows = Array.isArray(fx.json?.result) ? fx.json.result : [];
    console.log(`  HTTP ${fx.status} ${fx.ms}ms success=${fx.json?.success} matches=${rows.length} error=${fx.json?.error || fx.json?.message || ''}`);
    if (!rows.length) {
      console.log('  body', JSON.stringify(fx.json).slice(0, 500));
      continue;
    }
    const summary = summarizeStats(rows);
    const statuses = new Map<string, number>();
    for (const row of rows) {
      const k = String(row.event_status || '(blank)');
      statuses.set(k, (statuses.get(k) || 0) + 1);
    }
    console.log('  statuses', Object.fromEntries(statuses));
    console.log(`  withStats=${summary.finishedWithStats}`);
    console.log('  stat names:\n   ', summary.names.join('\n    '));
    if (summary.sample) {
      const s = summary.sample;
      console.log('  sample match', {
        event_key: s.event_key,
        date: s.event_date,
        p1: s.event_first_player,
        p2: s.event_second_player,
        result: s.event_final_result,
        status: s.event_status,
        tournament: s.tournament_name,
        round: s.tournament_round,
        season: s.tournament_season,
        statsCount: s.statistics?.length,
        scores: s.scores,
      });
      console.log('  sample stats', JSON.stringify(s.statistics, null, 2).slice(0, 4000));
    }
  }

  if (atpRows[0]?.player_key) {
    console.log('\n[probe] get_players', atpRows[0].player);
    const player = await call({ method: 'get_players', player_key: String(atpRows[0].player_key) });
    const p = Array.isArray(player.json?.result) ? player.json.result[0] : null;
    console.log('  HTTP', player.status, player.ms, 'ms');
    if (p) {
      console.log('  profile', {
        name: p.player_name,
        country: p.player_country,
        bday: p.player_bday,
        logo: p.player_logo,
        statsSeasons: Array.isArray(p.stats) ? p.stats.map((s: any) => `${s.season}:${s.type}`) : [],
      });
      console.log('  latest stats row', p.stats?.[0]);
    } else {
      console.log('  body', JSON.stringify(player.json).slice(0, 500));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
