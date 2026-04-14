#!/usr/bin/env node

/**
 * Extract a structured Soccerway match sample.
 *
 * Current approach:
 * - Team stats: fetch Soccerway's internal GraphQL endpoint using the match event id
 * - Player stats: render player-stat tabs with Puppeteer and read the visible table
 * - Events: parse summary-page text into a first-pass event list
 *
 * Usage:
 *   node scripts/extract-soccerway-match.js
 *   node scripts/extract-soccerway-match.js --url=https://www.soccerway.com/match/.../summary/
 *   node scripts/extract-soccerway-match.js --out=data/my-soccerway-match.json
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const DEFAULT_URL = 'https://www.soccerway.com/match/dortmund-nP1i5US1/vfb-stuttgart-nJQmYp1B/summary/';
const DEFAULT_OUTPUT = path.join(process.cwd(), 'data', 'soccerway-match-sample.json');
const PLAYER_STAT_CATEGORIES = ['top', 'shots', 'attack', 'passes', 'defense', 'goalkeeping', 'general'];
const ODDS_GEO = {
  countryCode: 'AU',
  subdivisionCode: 'AUNSW',
};

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : fallback;
}

function normalizeMatchBaseUrl(url) {
  const match = String(url).match(/^(https?:\/\/www\.soccerway\.com\/match\/[^/]+\/[^/]+\/)(?:summary\/(?:stats|player-stats|lineups)?(?:\/[^/]+)?\/?)?/i);
  if (match) return match[1];
  return url.endsWith('/') ? url : `${url}/`;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractEventId(html) {
  const match = html.match(/"event_id_c":"([^"]+)"/i);
  return match ? match[1] : null;
}

function extractMetaProperty(html, propertyName) {
  const match = html.match(new RegExp(`<meta[^>]+property=["']${propertyName}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, 'i'));
  return match ? decodeHtml(match[1]) : null;
}

function parseScoreFromOgTitle(ogTitle) {
  const match = String(ogTitle || '').match(/^(.*?)\s*-\s*(.*?)\s+(\d+):(\d+)$/);
  if (!match) return null;
  return {
    homeTeam: match[1].trim(),
    awayTeam: match[2].trim(),
    homeScore: Number(match[3]),
    awayScore: Number(match[4]),
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText} for ${url}`);
  }

  return response.text();
}

async function fetchTeamStats(eventId) {
  const endpoint = `https://2020.ds.lsapp.eu/pq_graphql?_hash=dsos2&eventId=${encodeURIComponent(eventId)}&projectId=2020`;
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
      Referer: 'https://www.soccerway.com/',
    },
  });

  if (!response.ok) {
    throw new Error(`Team stats fetch failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const participants = payload?.data?.findEventById?.eventParticipants || [];

  return {
    endpoint,
    participants: participants.map((participant, index) => ({
      side: participant?.type?.side || (index === 0 ? 'HOME' : index === 1 ? 'AWAY' : null),
      participantId: participant?.id || null,
      stats: Array.isArray(participant?.stats)
        ? participant.stats.flatMap((group) =>
            Array.isArray(group?.values)
              ? group.values.map((entry) => ({
                  name: entry?.name || null,
                  type: entry?.type || null,
                  label: entry?.label || null,
                  value: entry?.value ?? null,
                }))
              : []
          )
        : [],
    })),
    raw: payload,
  };
}

async function fetchOdds(eventId, participantMap) {
  const endpoint = `https://global.ds.lsapp.eu/odds/pq_graphql?_hash=oce&eventId=${encodeURIComponent(eventId)}&projectId=2020&geoIpCode=${ODDS_GEO.countryCode}&geoIpSubdivisionCode=${ODDS_GEO.subdivisionCode}`;
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
      Referer: 'https://www.soccerway.com/',
    },
  });

  if (!response.ok) {
    throw new Error(`Odds fetch failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const root = payload?.data?.findOddsByEventId;
  const bookmakers = Array.isArray(root?.settings?.bookmakers)
    ? root.settings.bookmakers.map((entry) => ({
        id: entry?.bookmaker?.id ?? null,
        name: entry?.bookmaker?.name || null,
        numOrder: entry?.numOrder ?? null,
        premiumStatusId: entry?.premiumStatusId ?? null,
        linkPrematchOddsType: entry?.linkPrematchOddsType ?? null,
      }))
    : [];

  const bookmakerMap = new Map(bookmakers.map((entry) => [entry.id, entry.name]));
  const marketRows = Array.isArray(root?.odds) ? root.odds : [];
  const groupedMarketMap = new Map();

  for (const market of marketRows) {
    const marketKey = `${market?.bettingType || 'UNKNOWN'}__${market?.bettingScope || 'UNKNOWN'}`;
    const bookmakerName = bookmakerMap.get(market?.bookmakerId) || null;
    const normalizedOdds = Array.isArray(market?.odds)
      ? market.odds.map((item) => ({
          participantId: item?.eventParticipantId ?? null,
          participant: item?.eventParticipantId ? participantMap.get(item.eventParticipantId) || null : null,
          selection:
            item?.selection ||
            (typeof item?.bothTeamsToScore === 'boolean' ? (item.bothTeamsToScore ? 'YES' : 'NO') : null) ||
            item?.score ||
            item?.winner ||
            item?.position ||
            (market?.bettingType === 'HOME_DRAW_AWAY' && !item?.eventParticipantId ? 'DRAW' : null),
          value: item?.value ?? null,
          opening: item?.opening ?? null,
          active: item?.active ?? null,
          handicap: item?.handicap?.value ?? null,
          handicapType: item?.handicap?.type ?? null,
          score: item?.score ?? null,
          winner: item?.winner ?? null,
          bothTeamsToScore: item?.bothTeamsToScore ?? null,
          position: item?.position ?? null,
        }))
      : [];

    const existingGroup = groupedMarketMap.get(marketKey);
    const offer = {
      bookmakerId: market?.bookmakerId ?? null,
      bookmakerName,
      hasLiveBettingOffers: Boolean(market?.hasLiveBettingOffers),
      odds: normalizedOdds,
    };

    if (!existingGroup) {
      groupedMarketMap.set(marketKey, {
        key: marketKey,
        bettingType: market?.bettingType || null,
        bettingScope: market?.bettingScope || null,
        offerCount: 1,
        offers: [offer],
      });
    } else {
      existingGroup.offerCount += 1;
      existingGroup.offers.push(offer);
    }
  }

  return {
    endpoint,
    geo: ODDS_GEO,
    bookmakers,
    markets: marketRows.map((market) => ({
      bookmakerId: market?.bookmakerId ?? null,
      bookmakerName: bookmakerMap.get(market?.bookmakerId) || null,
      bettingType: market?.bettingType || null,
      bettingScope: market?.bettingScope || null,
      hasLiveBettingOffers: Boolean(market?.hasLiveBettingOffers),
      odds: Array.isArray(market?.odds)
        ? market.odds.map((item) => ({
            participantId: item?.eventParticipantId ?? null,
            participant: item?.eventParticipantId ? participantMap.get(item.eventParticipantId) || null : null,
            selection:
              item?.selection ||
              (typeof item?.bothTeamsToScore === 'boolean' ? (item.bothTeamsToScore ? 'YES' : 'NO') : null) ||
              item?.score ||
              item?.winner ||
              item?.position ||
              (market?.bettingType === 'HOME_DRAW_AWAY' && !item?.eventParticipantId ? 'DRAW' : null),
            value: item?.value ?? null,
            opening: item?.opening ?? null,
            active: item?.active ?? null,
            handicap: item?.handicap?.value ?? null,
            handicapType: item?.handicap?.type ?? null,
            score: item?.score ?? null,
            winner: item?.winner ?? null,
            bothTeamsToScore: item?.bothTeamsToScore ?? null,
            position: item?.position ?? null,
          }))
        : [],
    })),
    groupedMarkets: Array.from(groupedMarketMap.values()).sort((a, b) => {
      const typeCompare = String(a.bettingType || '').localeCompare(String(b.bettingType || ''));
      if (typeCompare !== 0) return typeCompare;
      return String(a.bettingScope || '').localeCompare(String(b.bettingScope || ''));
    }),
    raw: payload,
  };
}

function parseSummaryEvents(lines) {
  const events = [];
  const minuteRegex = /^(\d{1,3}(?:\+\d{1,2})?)['’′]?$/;
  const periodRegex = /^(MATCH|1ST HALF|2ND HALF|EXTRA TIME|PENALTIES)$/i;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (periodRegex.test(line)) {
      events.push({ type: 'period', label: line });
      i += 1;
      continue;
    }

    if (/^\d+\s*-\s*\d+$/.test(line)) {
      events.push({ type: 'scoreline', label: line });
      i += 1;
      continue;
    }

    const minuteMatch = line.match(minuteRegex);
    if (minuteMatch) {
      const details = [];
      let j = i + 1;
      while (j < lines.length && !periodRegex.test(lines[j]) && !minuteRegex.test(lines[j]) && !/^\d+\s*-\s*\d+$/.test(lines[j])) {
        details.push(lines[j]);
        j += 1;
      }
      events.push({
        type: 'event',
        minute: minuteMatch[1],
        details,
      });
      i = j;
      continue;
    }

    i += 1;
  }

  return events;
}

async function extractSummaryData(page, summaryUrl) {
  await page.goto(summaryUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(3000);

  return page.evaluate(() => {
    const textLines = (document.body?.innerText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const uniqueTeamLinks = [];
    const seenTeamLinks = new Set();
    for (const anchor of Array.from(document.querySelectorAll('a[href*="/team/"]'))) {
      const href = anchor.getAttribute('href');
      const label = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
      if (!href || !label || seenTeamLinks.has(href)) continue;
      seenTeamLinks.add(href);
      uniqueTeamLinks.push({ href, label });
      if (uniqueTeamLinks.length >= 6) break;
    }

    const uniquePlayerLinks = [];
    const seenPlayerLinks = new Set();
    for (const anchor of Array.from(document.querySelectorAll('a[href*="/player/"]'))) {
      const href = anchor.getAttribute('href');
      const label = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
      if (!href || !label || seenPlayerLinks.has(`${href}:${label}`)) continue;
      seenPlayerLinks.add(`${href}:${label}`);
      uniquePlayerLinks.push({ href, label });
      if (uniquePlayerLinks.length >= 50) break;
    }

    return {
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() || null,
      textLines,
      teamLinks: uniqueTeamLinks,
      playerLinks: uniquePlayerLinks,
    };
  });
}

async function extractPlayerCategoryTable(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(2500);

  return page.evaluate(() => {
    const table = document.querySelector('table');
    const tabLinks = Array.from(document.querySelectorAll('a[href*="/summary/player-stats/"]'))
      .map((anchor) => ({
        href: anchor.getAttribute('href'),
        label: (anchor.textContent || '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((item) => item.href && item.label);

    if (!table) {
      return {
        headers: [],
        rows: [],
        tabLinks,
      };
    }

    const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
      Array.from(row.querySelectorAll('th, td')).map((cell) => cell.textContent.replace(/\s+/g, ' ').trim())
    );

    const headers = rows[0] || [];
    const bodyRows = rows.slice(1).filter((row) => row.some((cell) => cell));

    return {
      headers,
      rows: bodyRows,
      tabLinks,
      className: table.className || null,
    };
  });
}

function mapPlayerRows(headers, rows) {
  if (!headers.length) return rows.map((cells) => ({ rawCells: cells }));

  return rows.map((cells) => {
    const row = {};
    headers.forEach((header, index) => {
      const key = String(header || `col_${index}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || `col_${index}`;
      row[key] = cells[index] ?? null;
    });
    row.rawCells = cells;
    row.player = cells[0] || null;
    return row;
  });
}

async function main() {
  const inputUrl = getArg('url', DEFAULT_URL);
  const outPath = getArg('out', DEFAULT_OUTPUT);
  const baseUrl = normalizeMatchBaseUrl(inputUrl);
  const summaryUrl = `${baseUrl}summary/`;

  console.log('Fetching summary HTML...');
  console.log(`  ${summaryUrl}`);

  const summaryHtml = await fetchHtml(summaryUrl);
  const eventId = extractEventId(summaryHtml);
  if (!eventId) {
    throw new Error('Could not find Soccerway event id in summary HTML');
  }

  const ogTitle = extractMetaProperty(summaryHtml, 'og:title');
  const ogDescription = extractMetaProperty(summaryHtml, 'og:description');
  const score = parseScoreFromOgTitle(ogTitle);

  console.log('Fetching team stats JSON...');
  const teamStatsResult = await fetchTeamStats(eventId);

  console.log('Fetching odds JSON...');
  let oddsResult = null;
  try {
    const participantNameMap = new Map(
      teamStatsResult.participants
        .map((participant, index) => [
          participant.participantId,
          participant.side === 'HOME'
            ? score?.homeTeam || null
            : participant.side === 'AWAY'
              ? score?.awayTeam || null
              : index === 0
                ? score?.homeTeam || null
                : index === 1
                  ? score?.awayTeam || null
                  : null,
        ])
        .filter(([participantId]) => participantId)
    );
    oddsResult = await fetchOdds(eventId, participantNameMap);
  } catch (error) {
    console.warn('Odds fetch failed, continuing without odds data:', error instanceof Error ? error.message : error);
  }

  console.log('Launching browser for summary + player tables...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let summaryData;
  let playerStats = {};

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });

    summaryData = await extractSummaryData(page, summaryUrl);

    for (const category of PLAYER_STAT_CATEGORIES) {
      const categoryUrl = `${baseUrl}summary/player-stats/${category}/`;
      console.log(`  player-stats/${category}`);
      const tableData = await extractPlayerCategoryTable(page, categoryUrl);
      playerStats[category] = {
        url: categoryUrl,
        headers: tableData.headers,
        rows: mapPlayerRows(tableData.headers, tableData.rows),
        rawRowCount: tableData.rows.length,
        tabLinks: tableData.tabLinks,
        className: tableData.className || null,
      };
    }
  } finally {
    await browser.close();
  }

  const orderedTeams = summaryData.teamLinks.slice(0, 2).map((team) => team.label);
  const teamStats = teamStatsResult.participants.map((participant, index) => ({
    side: participant.side,
    team: participant.side === 'HOME'
      ? orderedTeams[0] || null
      : participant.side === 'AWAY'
        ? orderedTeams[1] || null
        : orderedTeams[index] || null,
    stats: participant.stats,
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'soccerway.com',
    inputUrl,
    baseUrl,
    eventId,
    match: {
      ogTitle,
      ogDescription,
      title: summaryData.title,
      heading: summaryData.h1,
      score,
      teams: orderedTeams,
    },
    summary: {
      url: summaryUrl,
      rawLines: summaryData.textLines,
      parsedEvents: parseSummaryEvents(summaryData.textLines),
      teamLinks: summaryData.teamLinks,
      playerLinks: summaryData.playerLinks,
    },
    teamStats: {
      endpoint: teamStatsResult.endpoint,
      participants: teamStats,
    },
    odds: oddsResult
      ? {
          endpoint: oddsResult.endpoint,
          geo: oddsResult.geo,
          bookmakers: oddsResult.bookmakers,
          summary: {
            bookmakerCount: oddsResult.bookmakers.length,
            marketCount: oddsResult.markets.length,
            groupedMarketCount: oddsResult.groupedMarkets.length,
          },
          markets: oddsResult.markets,
          groupedMarkets: oddsResult.groupedMarkets,
        }
      : null,
    playerStats,
  };

  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\nWrote structured sample to:');
  console.log(`  ${outPath}`);
  console.log(`\nMatch: ${report.match.ogTitle || report.match.heading}`);
  console.log(`Event id: ${eventId}`);
  console.log(`Team stat entries: ${teamStats.map((team) => `${team.team || team.side}=${team.stats.length}`).join(', ')}`);
  console.log(`Odds markets: ${report.odds?.summary?.marketCount || 0}`);
  console.log(`Parsed events: ${report.summary.parsedEvents.length}`);
  console.log(`Player stat categories: ${Object.keys(playerStats).join(', ')}`);
 }

 main().catch((error) => {
  console.error(error);
  process.exit(1);
});
