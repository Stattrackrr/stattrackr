#!/usr/bin/env tsx
/**
 * Build NBL27 roster from the official NBL Roster Tracker article,
 * matched to Rosetta player IDs where possible.
 *
 * Writes:
 *   data/nbl-roster-2026.json
 *   data/nbl-rosters-by-team-2026.json
 *
 * Usage: npx tsx scripts/fetch-nbl27-roster-from-tracker.ts
 */
import fs from 'fs';
import path from 'path';
import { fetchNblSeasonPlayers, fetchNblTeamRoster } from '../lib/nbl/rosettaPlayer';
import { fetchRosettaJson } from '../lib/nbl/rosettaHttp';
import {
  NBL_CLUBS,
  NBL_CURRENT_SEASON_YEAR,
  nblSeasonLabel,
  normalizeTeamKey,
} from '../lib/nblTeamCanonical';

const TRACKER_URL =
  'https://nbl.com.au/news/nbl27-roster-tracker-every-signing-extension-and-departure';

const YEAR = NBL_CURRENT_SEASON_YEAR; // 2026 = NBL27

const COACH_TO_TEAM: Record<string, string> = {
  'trevor gleeson': 'Adelaide 36ers',
  'will weaver': 'Brisbane Bullets',
  'adam forde': 'Cairns Taipans',
  'justin tatum': 'Illawarra Hawks',
  'jacob chance': 'Melbourne United',
  'gordon herbert': 'New Zealand Breakers',
  'john rillie': 'Perth Wildcats',
  'josh king': 'South East Melbourne Phoenix',
  'brian goorjian': 'Sydney Kings',
  'scott roth': 'Tasmania JackJumpers',
};

type TrackerPlayer = {
  name: string;
  status: 'contracted' | 'incoming';
  note: string | null;
};

type TrackerTeam = {
  team: string;
  headCoach: string;
  players: TrackerPlayer[];
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\u2019/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ');
}

function cleanText(value: string): string {
  return String(value || '')
    .replace(/[\u200b-\u200d\ufeff\u00a0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePlayerList(raw: string, status: TrackerPlayer['status']): TrackerPlayer[] {
  const cleaned = cleanText(raw.replace(/\n+/g, ' '));
  return cleaned
    .split(',')
    .map((part) => cleanText(part))
    .filter(Boolean)
    .map((part) => {
      // e.g. "Bul Kuol (Sydney Kings)", "John Jenkins III (IP)", "Kuol*"
      const noteMatch = part.match(/\(([^)]+)\)\s*$/);
      const note = noteMatch ? cleanText(noteMatch[1]) : null;
      let name = part.replace(/\([^)]*\)\s*$/, '').replace(/\*+$/g, '');
      name = cleanText(name.replace(/,+/g, ''));
      return { name, status, note };
    })
    .filter((p) => {
      if (!p.name) return false;
      if (/^head coach$/i.test(p.name)) return false;
      if (p.note && /head coach/i.test(p.note)) return false;
      return true;
    });
}

function parseTracker(text: string): TrackerTeam[] {
  const teams: TrackerTeam[] = [];
  // Split on Head coach blocks
  const parts = text.split(/Head coach:\s*/i).slice(1);
  for (const part of parts) {
    const coachLine = part.split('\n')[0]?.trim() || '';
    const coach = coachLine.replace(/\s+/g, ' ').trim();
    const coachKey = coach.toLowerCase();
    const team = COACH_TO_TEAM[coachKey];
    if (!team) {
      console.warn(`Unknown coach block: ${coach}`);
      continue;
    }

    const contractedMatch = part.match(/Contracted:\s*([\s\S]*?)(?:Incoming:|Departed:|Free Agents:|Potential depth chart:|$)/i);
    const incomingMatch = part.match(/Incoming:\s*([\s\S]*?)(?:Departed:|Free Agents:|Potential depth chart:|$)/i);

    const contracted = contractedMatch ? parsePlayerList(contractedMatch[1], 'contracted') : [];
    const incoming = incomingMatch
      ? parsePlayerList(incomingMatch[1], 'incoming')
      : [];

    // Dedupe by normalized name, prefer contracted over incoming
    const byName = new Map<string, TrackerPlayer>();
    for (const p of [...incoming, ...contracted]) {
      const key = normalizeTeamKey(p.name);
      if (!key) continue;
      byName.set(key, p);
    }

    teams.push({
      team,
      headCoach: coach,
      players: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return teams;
}

function normalizePlayerName(name: string): string {
  return cleanText(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameKeys(name: string): string[] {
  const full = normalizePlayerName(name);
  if (!full) return [];
  const parts = full.split(' ').filter(Boolean);
  const keys = new Set<string>([full]);
  if (parts.length >= 2) {
    keys.add(`${parts[0]} ${parts[parts.length - 1]}`);
    keys.add(`${parts[parts.length - 1]} ${parts[0]}`);
    // Dan <-> Daniel, Will <-> William, Johny <-> Johnny
    const aliases: Record<string, string[]> = {
      dan: ['daniel'],
      daniel: ['dan'],
      will: ['william'],
      william: ['will'],
      johny: ['johnny'],
      johnny: ['johny'],
      chris: ['christopher'],
      joe: ['joseph'],
    };
    const first = parts[0];
    const last = parts[parts.length - 1];
    for (const alt of aliases[first] || []) {
      keys.add(`${alt} ${last}`);
    }
  }
  return [...keys];
}

type IdHit = {
  playerId: string;
  name: string;
  team: string | null;
  teamCode: string | null;
  teamId: string | null;
  position: string | null;
  jersey: string | null;
  imageUrl: string | null;
};

async function buildRosettaIndex(): Promise<Map<string, IdHit>> {
  const index = new Map<string, IdHit>();

  const add = (hit: IdHit) => {
    for (const key of nameKeys(hit.name)) {
      if (!index.has(key)) index.set(key, hit);
    }
  };

  // Current season + per-club
  const season = (await fetchNblSeasonPlayers(YEAR)) || [];
  for (const r of season) {
    add({
      playerId: r.player.id,
      name: r.player.full_name || `${r.player.first_name || ''} ${r.player.last_name || ''}`.trim(),
      team: r.team?.name ?? null,
      teamCode: r.team?.team_code ?? null,
      teamId: r.team?.id ?? null,
      position: r.playing_position ?? r.player.playing_position ?? null,
      jersey: r.jersey_number != null ? String(r.jersey_number) : r.player.latest_jersey_number != null ? String(r.player.latest_jersey_number) : null,
      imageUrl: r.player.external_player_image ?? r.player.image ?? null,
    });
  }
  for (const club of NBL_CLUBS) {
    const rows = (await fetchNblTeamRoster(club.id, YEAR)) || [];
    for (const r of rows) {
      add({
        playerId: r.player.id,
        name: r.player.full_name || `${r.player.first_name || ''} ${r.player.last_name || ''}`.trim(),
        team: r.team?.name ?? club.name,
        teamCode: r.team?.team_code ?? club.code,
        teamId: r.team?.id ?? club.id,
        position: r.playing_position ?? r.player.playing_position ?? null,
        jersey: r.jersey_number != null ? String(r.jersey_number) : null,
        imageUrl: r.player.external_player_image ?? r.player.image ?? null,
      });
    }
  }

  // Prior season rosters for ID continuity
  for (const y of [2025, 2024, 2023]) {
    const file = path.join(process.cwd(), 'data', `nbl-roster-${y}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        players?: Array<{
          playerId: string;
          name: string;
          team?: string;
          teamCode?: string | null;
          teamId?: string | null;
          position?: string | null;
          jersey?: string | null;
          imageUrl?: string | null;
        }>;
      };
      for (const p of json.players || []) {
        add({
          playerId: p.playerId,
          name: p.name,
          team: p.team ?? null,
          teamCode: p.teamCode ?? null,
          teamId: p.teamId ?? null,
          position: p.position ?? null,
          jersey: p.jersey ?? null,
          imageUrl: p.imageUrl ?? null,
        });
      }
    } catch {
      /* ignore */
    }
  }

  // Global player directory
  const global = await fetchRosettaJson<Array<{ player?: Record<string, unknown> }>>('nbl/players');
  if (global.ok && Array.isArray(global.data)) {
    for (const row of global.data) {
      const p = row.player || {};
      const name = String(p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim());
      const id = String(p.id || '');
      if (!id || !name) continue;
      add({
        playerId: id,
        name,
        team: null,
        teamCode: null,
        teamId: null,
        position: (p.latest_playing_position as string) || (p.playing_position as string) || null,
        jersey:
          p.latest_jersey_number != null
            ? String(p.latest_jersey_number)
            : p.jersey_number != null
              ? String(p.jersey_number)
              : null,
        imageUrl: (p.external_player_image as string) || (p.image as string) || null,
      });
    }
  }

  return index;
}

async function main() {
  console.log(`Fetching NBL27 roster tracker…`);
  const res = await fetch(TRACKER_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html',
    },
  });
  if (!res.ok) throw new Error(`Tracker HTTP ${res.status}`);
  const html = await res.text();
  const text = stripHtml(html);
  const trackerTeams = parseTracker(text);
  if (trackerTeams.length < 8) {
    throw new Error(`Failed to parse tracker teams (got ${trackerTeams.length})`);
  }

  console.log(`Parsed ${trackerTeams.length} teams from tracker`);
  const index = await buildRosettaIndex();
  console.log(`Rosetta name index size: ${index.size}`);

  const flatPlayers: Array<{
    playerId: string | null;
    name: string;
    team: string;
    teamCode: string | null;
    teamId: string | null;
    position: string | null;
    jersey: string | null;
    imageUrl: string | null;
    trackerStatus: 'contracted' | 'incoming';
    trackerNote: string | null;
    idSource: 'rosetta' | 'unmatched';
  }> = [];

  const byTeam = [];

  for (const club of NBL_CLUBS) {
    const block = trackerTeams.find((t) => t.team === club.name);
    if (!block) {
      console.warn(`No tracker block for ${club.name}`);
      continue;
    }
    const teamPlayers = [];
    for (const tp of block.players) {
      let hit: IdHit | null = null;
      for (const key of nameKeys(tp.name)) {
        if (index.has(key)) {
          hit = index.get(key)!;
          break;
        }
      }
      const row = {
        playerId: hit?.playerId ?? null,
        name: hit?.name || tp.name,
        team: club.name,
        teamCode: club.code,
        teamId: club.id,
        position: hit?.position ?? null,
        jersey: hit?.jersey ?? null,
        imageUrl: hit?.imageUrl ?? null,
        trackerStatus: tp.status,
        trackerNote: tp.note,
        idSource: hit ? ('rosetta' as const) : ('unmatched' as const),
      };
      teamPlayers.push(row);
      flatPlayers.push(row);
    }
    teamPlayers.sort((a, b) => a.name.localeCompare(b.name));
    byTeam.push({
      team: club.name,
      teamCode: club.code,
      teamId: club.id,
      headCoach: block.headCoach,
      playerCount: teamPlayers.length,
      players: teamPlayers,
    });
    const unmatched = teamPlayers.filter((p) => !p.playerId).map((p) => p.name);
    console.log(
      `${club.code}: ${teamPlayers.length} players` +
        (unmatched.length ? ` (unmatched: ${unmatched.join(', ')})` : '')
    );
  }

  flatPlayers.sort((a, b) => a.name.localeCompare(b.name));

  const rosterFile = path.join(process.cwd(), 'data', `nbl-roster-${YEAR}.json`);
  fs.writeFileSync(
    rosterFile,
    JSON.stringify(
      {
        year: YEAR,
        seasonLabel: nblSeasonLabel(YEAR),
        generatedAt: new Date().toISOString(),
        source: 'nbl.com.au roster tracker + rosetta.nbl.com.au',
        trackerUrl: TRACKER_URL,
        playerCount: flatPlayers.length,
        matchedPlayerIds: flatPlayers.filter((p) => p.playerId).length,
        unmatchedPlayers: flatPlayers.filter((p) => !p.playerId).length,
        players: flatPlayers,
      },
      null,
      2
    )
  );

  const byTeamFile = path.join(process.cwd(), 'data', `nbl-rosters-by-team-${YEAR}.json`);
  fs.writeFileSync(
    byTeamFile,
    JSON.stringify(
      {
        year: YEAR,
        seasonLabel: nblSeasonLabel(YEAR),
        generatedAt: new Date().toISOString(),
        source: 'nbl.com.au roster tracker + rosetta.nbl.com.au',
        trackerUrl: TRACKER_URL,
        teamCount: byTeam.length,
        teams: byTeam,
      },
      null,
      2
    )
  );

  console.log(
    `Wrote ${rosterFile} (${flatPlayers.length} players, ${flatPlayers.filter((p) => p.playerId).length} matched IDs)`
  );
  console.log(`Wrote ${byTeamFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
