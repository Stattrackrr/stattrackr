#!/usr/bin/env node

/**
 * Fetch weather context for upcoming AFL games using Open-Meteo.
 * Uses /api/afl/player-props/list?enrich=false to get game start times.
 *
 * Writes:
 *  - data/afl-weather-upcoming.json
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');

const TEAM_COORDS = {
  adelaide: { lat: -34.9285, lon: 138.6007 },
  brisbane: { lat: -27.4698, lon: 153.0251 },
  carlton: { lat: -37.8136, lon: 144.9631 },
  collingwood: { lat: -37.8136, lon: 144.9631 },
  essendon: { lat: -37.8136, lon: 144.9631 },
  fremantle: { lat: -31.9505, lon: 115.8605 },
  geelong: { lat: -38.1499, lon: 144.3617 },
  goldcoast: { lat: -28.0167, lon: 153.4000 },
  gws: { lat: -33.8688, lon: 151.2093 },
  hawthorn: { lat: -37.8136, lon: 144.9631 },
  melbourne: { lat: -37.8136, lon: 144.9631 },
  northmelbourne: { lat: -37.8136, lon: 144.9631 },
  portadelaide: { lat: -34.9285, lon: 138.6007 },
  richmond: { lat: -37.8136, lon: 144.9631 },
  stkilda: { lat: -37.8136, lon: 144.9631 },
  sydney: { lat: -33.8688, lon: 151.2093 },
  westcoast: { lat: -31.9505, lon: 115.8605 },
  westernbulldogs: { lat: -37.8136, lon: 144.9631 },
};

const TEAM_COORD_ALIASES = {
  adelaidecrows: 'adelaide',
  brisbanelions: 'brisbane',
  carltonblues: 'carlton',
  collingwoodmagpies: 'collingwood',
  essendonbombers: 'essendon',
  fremantledockers: 'fremantle',
  geelongcats: 'geelong',
  goldcoastsuns: 'goldcoast',
  greaterwesternsydneygiants: 'gws',
  gwsgiants: 'gws',
  hawthornhawks: 'hawthorn',
  melbournedemons: 'melbourne',
  northmelbournekangaroos: 'northmelbourne',
  portadelaidepower: 'portadelaide',
  richmondtigers: 'richmond',
  stkildasaints: 'stkilda',
  sydneyswans: 'sydney',
  westcoasteagles: 'westcoast',
  westernbulldogs: 'westernbulldogs',
  footscraybulldogs: 'westernbulldogs',
};

function normalizeTeam(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveTeamCoords(teamName) {
  const key = normalizeTeam(teamName);
  if (!key) return null;
  if (TEAM_COORDS[key]) return TEAM_COORDS[key];
  const alias = TEAM_COORD_ALIASES[key];
  if (alias && TEAM_COORDS[alias]) return TEAM_COORDS[alias];
  // Fallback contains-check for unusual display names.
  for (const base of Object.keys(TEAM_COORDS)) {
    if (key.includes(base) || base.includes(key)) return TEAM_COORDS[base];
  }
  return null;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  return res.json();
}

function isEligibleGame(game, nowMs = Date.now()) {
  const cutoffGraceMs = 15 * 60 * 1000;
  const t = Date.parse(String(game?.commenceTime || ''));
  if (!Number.isFinite(t)) return true;
  return t >= nowMs - cutoffGraceMs;
}

async function main() {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  let games = [];
  let gameSource = 'odds-api-live';
  const apiKey = String(process.env.ODDS_API_KEY || '').trim();
  if (apiKey) {
    const url =
      `https://api.the-odds-api.com/v4/sports/aussierules_afl/odds?regions=au&oddsFormat=american` +
      `&markets=h2h,spreads,totals&apiKey=${encodeURIComponent(apiKey)}`;
    const oddsPayload = await fetchJson(url);
    if (Array.isArray(oddsPayload)) {
      games = oddsPayload
        .map((ev) => ({
          gameId: ev.id,
          homeTeam: ev.home_team,
          awayTeam: ev.away_team,
          commenceTime: ev.commence_time,
        }))
        .filter((g) => g.gameId && g.homeTeam && g.awayTeam && g.commenceTime)
        .filter((g) => isEligibleGame(g));
    }
  }
  if (!games.length) {
    gameSource = 'props-list-fallback';
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const payload = await fetchJson(`${baseUrl}/api/afl/player-props/list?enrich=false`);
    games = (Array.isArray(payload?.games) ? payload.games : []).filter((g) => isEligibleGame(g));
  }
  const byGame = [];

  for (const g of games) {
    const home = String(g.homeTeam || '').trim();
    const away = String(g.awayTeam || '').trim();
    const commenceTime = String(g.commenceTime || '').trim();
    if (!home || !away || !commenceTime) continue;

    const coords = resolveTeamCoords(home);
    if (!coords) continue;

    const dt = new Date(commenceTime);
    if (!Number.isFinite(dt.getTime())) continue;
    const date = dt.toISOString().slice(0, 10);
    const hour = dt.getUTCHours();
    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&hourly=temperature_2m,precipitation,windspeed_10m&start_date=${date}&end_date=${date}&timezone=UTC`;

    const weather = await fetchJson(weatherUrl);
    const hours = weather?.hourly?.time || [];
    const tempArr = weather?.hourly?.temperature_2m || [];
    const rainArr = weather?.hourly?.precipitation || [];
    const windArr = weather?.hourly?.windspeed_10m || [];
    let idx = hours.findIndex((t) => String(t).includes(`T${String(hour).padStart(2, '0')}:`));
    if (idx < 0) idx = 0;

    byGame.push({
      gameId: g.gameId,
      homeTeam: home,
      awayTeam: away,
      commenceTime,
      weather: {
        temperatureC: Number.isFinite(Number(tempArr[idx])) ? Number(tempArr[idx]) : null,
        precipitationMm: Number.isFinite(Number(rainArr[idx])) ? Number(rainArr[idx]) : null,
        windKmh: Number.isFinite(Number(windArr[idx])) ? Number(windArr[idx]) : null,
      },
    });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'open-meteo.com',
    gameSource,
    games: byGame,
    count: byGame.length,
  };
  const outPath = path.join(dataDir, 'afl-weather-upcoming.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Wrote ${outPath} (${byGame.length} games)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
