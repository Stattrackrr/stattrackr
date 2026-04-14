#!/usr/bin/env node

/**
 * Discover teams from Soccerway competition standings pages.
 *
 * This is intentionally seeded with major competitions first. A global crawl of
 * every Soccerway team would be very large and slow, so this gives us a clean,
 * repeatable "what teams can we return right now?" sample.
 *
 * Usage:
 *   node scripts/extract-soccerway-teams.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const OUT_PATH = path.join(process.cwd(), 'data', 'soccerway-teams-sample.json');

const COMPETITIONS = [
  { country: 'England', competition: 'Premier League', url: 'https://www.soccerway.com/england/premier-league/standings/' },
  { country: 'England', competition: 'Championship', url: 'https://www.soccerway.com/england/championship/standings/' },
  { country: 'Spain', competition: 'LaLiga', url: 'https://www.soccerway.com/spain/primera-division/standings/' },
  { country: 'Germany', competition: 'Bundesliga', url: 'https://www.soccerway.com/germany/bundesliga/standings/' },
  { country: 'Italy', competition: 'Serie A', url: 'https://www.soccerway.com/italy/serie-a/standings/' },
  { country: 'France', competition: 'Ligue 1', url: 'https://www.soccerway.com/france/ligue-1/standings/' },
  { country: 'Netherlands', competition: 'Eredivisie', url: 'https://www.soccerway.com/netherlands/eredivisie/standings/' },
  { country: 'United States', competition: 'MLS', url: 'https://www.soccerway.com/usa/mls/' },
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTeamName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

async function extractCompetitionTeams(page, spec) {
  await page.goto(spec.url, { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(3000);

  return page.evaluate((meta) => {
    const rows = [];
    const seen = new Set();

    const candidateRows = Array.from(
      document.querySelectorAll('a.tableCellParticipant__name[href*="/team/"]')
    )
      .map((anchor) => ({
        href: anchor.getAttribute('href'),
        label: (anchor.textContent || '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((item) => item.href && item.label);

    for (const item of candidateRows) {
      const key = `${item.href}|${item.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        name: item.label,
        href: item.href,
      });
    }

    return {
      ...meta,
      title: document.title,
      heading: document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() || null,
      teamCount: rows.length,
      teams: rows,
    };
  }, spec);
}

async function main() {
  console.log('Launching browser for Soccerway team discovery...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });

    const competitions = [];
    const allTeams = [];
    const uniqueTeamMap = new Map();

    for (const spec of COMPETITIONS) {
      console.log(`  ${spec.country} - ${spec.competition}`);
      const result = await extractCompetitionTeams(page, spec);
      const normalizedTeams = result.teams
        .map((team) => ({
          ...team,
          name: normalizeTeamName(team.name),
          competition: spec.competition,
          country: spec.country,
        }))
        .filter((team) => team.name && team.href);

      competitions.push({
        ...result,
        teams: normalizedTeams,
        teamCount: normalizedTeams.length,
      });

      for (const team of normalizedTeams) {
        allTeams.push(team);
        const key = team.href;
        const existing = uniqueTeamMap.get(key);
        if (!existing) {
          uniqueTeamMap.set(key, {
            name: team.name,
            href: team.href,
            competitions: [{ country: spec.country, competition: spec.competition }],
          });
        } else {
          existing.competitions.push({ country: spec.country, competition: spec.competition });
        }
      }
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      source: 'soccerway.com',
      competitions,
      summary: {
        competitionCount: competitions.length,
        totalDiscoveredRows: allTeams.length,
        uniqueTeams: uniqueTeamMap.size,
      },
      uniqueTeams: Array.from(uniqueTeamMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    };

    const outDir = path.dirname(OUT_PATH);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), 'utf8');

    console.log('\nWrote team sample to:');
    console.log(`  ${OUT_PATH}`);
    console.log(`Competitions: ${payload.summary.competitionCount}`);
    console.log(`Team rows: ${payload.summary.totalDiscoveredRows}`);
    console.log(`Unique teams: ${payload.summary.uniqueTeams}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
