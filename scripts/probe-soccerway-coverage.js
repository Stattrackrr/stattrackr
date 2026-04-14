#!/usr/bin/env node

/**
 * Probe Soccerway coverage across competitions and match states.
 *
 * The goal is to understand what we can reliably scrape before building more
 * product logic on top of the source.
 *
 * Usage:
 *   node scripts/probe-soccerway-coverage.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const OUTPUT_PATH = path.join(process.cwd(), 'data', 'soccerway-coverage-report.json');

const COMPETITIONS = [
  { key: 'premier-league', label: 'Premier League', region: 'England', url: 'https://www.soccerway.com/england/premier-league/' },
  { key: 'mls', label: 'MLS', region: 'USA', url: 'https://www.soccerway.com/usa/mls/' },
  { key: 'champions-league', label: 'Champions League', region: 'Europe', url: 'https://www.soccerway.com/europe/champions-league/' },
  { key: 'world-cup', label: 'World Cup', region: 'World', url: 'https://www.soccerway.com/world/world-cup/' },
  { key: 'copa-libertadores', label: 'Copa Libertadores', region: 'South America', url: 'https://www.soccerway.com/south-america/copa-libertadores/' },
  { key: 'afc-champions-league', label: 'AFC Champions League', region: 'Asia', url: 'https://www.soccerway.com/asia/afc-champions-league/' },
];

const TAB_BUILDERS = {
  summary: (baseUrl) => `${baseUrl}summary/`,
  stats: (baseUrl) => `${baseUrl}summary/stats/`,
  playerStats: (baseUrl) => `${baseUrl}summary/player-stats/top/`,
  lineups: (baseUrl) => `${baseUrl}summary/lineups/`,
  odds: (baseUrl) => `${baseUrl}odds/`,
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMatchBaseUrl(url) {
  const match = String(url).match(/^(https?:\/\/www\.soccerway\.com\/match\/[^/]+\/[^/]+\/)/i);
  if (match) return match[1];
  return url.endsWith('/') ? url : `${url}/`;
}

function buildAbsoluteUrl(href) {
  if (!href) return null;
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('/')) return `https://www.soccerway.com${href}`;
  return `https://www.soccerway.com/${href}`;
}

async function collectMatchLinks(page, url, sampleKey) {
  const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(3000);

  const result = await page.evaluate((stateKey) => {
    const bodyText = document.body?.innerText || '';
    const links = Array.from(document.querySelectorAll('a[href*="/match/"]'))
      .map((anchor) => ({
        href: anchor.getAttribute('href'),
        label: (anchor.textContent || '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((item) => item.href);

    return {
      title: document.title,
      heading: document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() || null,
      stateKey,
      hasError: /requested page can't be displayed/i.test(bodyText),
      links,
    };
  }, sampleKey);

  const unique = [];
  const seen = new Set();
  for (const item of result.links) {
    const abs = buildAbsoluteUrl(item.href);
    if (!abs) continue;
    const key = normalizeMatchBaseUrl(abs);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      url: `${key}summary/`,
      label: item.label || null,
    });
  }

  return {
    status: response?.status() ?? null,
    title: result.title,
    heading: result.heading,
    hasError: result.hasError,
    matches: unique,
  };
}

async function probeTab(page, url, tabKey) {
  const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(2500);

  return page.evaluate(
    ({ requestedUrl, tabName, status }) => {
      const bodyText = document.body?.innerText || '';
      const text = bodyText.replace(/\s+/g, ' ').trim();
      const teamLinks = document.querySelectorAll('a[href*="/team/"]').length;
      const playerLinks = document.querySelectorAll('a[href*="/player/"]').length;
      const tableCount = document.querySelectorAll('table').length;

      const availabilityByTab = {
        summary:
          /match info|live score|full-time|scheduled|kick-off/i.test(text) &&
          !/requested page can't be displayed/i.test(text),
        stats:
          /expected goals|ball possession|total shots|corner kicks|fouls/i.test(text) &&
          !/requested page can't be displayed/i.test(text),
        playerStats:
          (playerLinks > 0 || tableCount > 0) &&
          /player stats|rating|shots|passes|defense|goalkeeping/i.test(text) &&
          !/requested page can't be displayed/i.test(text),
        lineups:
          (playerLinks > 0 || /lineups|substitutes|bench|coach/i.test(text)) &&
          !/requested page can't be displayed/i.test(text),
        odds:
          /bookmaker|1x2|over\/under|both teams to score|draw no bet/i.test(text) &&
          !/requested page can't be displayed/i.test(text),
      };

      return {
        requestedUrl,
        finalUrl: window.location.href,
        tabName,
        status,
        title: document.title,
        heading: document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() || null,
        hasError: /requested page can't be displayed/i.test(text),
        available: Boolean(availabilityByTab[tabName]),
        teamLinks,
        playerLinks,
        tableCount,
        bodySnippet: text.slice(0, 1200),
      };
    },
    { requestedUrl: url, tabName: tabKey, status: response?.status() ?? null }
  );
}

async function probeMatch(page, matchUrl, sampleKey) {
  const baseUrl = normalizeMatchBaseUrl(matchUrl);
  const tabResults = {};

  for (const [tabKey, buildUrl] of Object.entries(TAB_BUILDERS)) {
    const tabUrl = buildUrl(baseUrl);
    tabResults[tabKey] = await probeTab(page, tabUrl, tabKey);
  }

  const summaryText = tabResults.summary?.bodySnippet || '';
  const state =
    /full-time/i.test(summaryText) ? 'finished'
      : /scheduled|kick-off/i.test(summaryText) ? 'upcoming'
        : /live/i.test(summaryText) ? 'live'
          : sampleKey;

  return {
    sampleKey,
    detectedState: state,
    matchUrl: `${baseUrl}summary/`,
    matchTitle: tabResults.summary?.title || null,
    tabs: tabResults,
    coverage: {
      summary: Boolean(tabResults.summary?.available),
      stats: Boolean(tabResults.stats?.available),
      playerStats: Boolean(tabResults.playerStats?.available),
      lineups: Boolean(tabResults.lineups?.available),
      odds: Boolean(tabResults.odds?.available),
    },
  };
}

async function main() {
  console.log('Launching browser for Soccerway coverage probe...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });

    const competitions = [];

    for (const competition of COMPETITIONS) {
      console.log(`\nCompetition: ${competition.label}`);
      const sources = {
        upcoming: await collectMatchLinks(page, `${competition.url}fixtures/`, 'upcoming'),
        recent: await collectMatchLinks(page, competition.url, 'recent'),
        finished: await collectMatchLinks(page, `${competition.url}results/`, 'finished'),
      };

      const sampledMatches = [];
      const usedBaseUrls = new Set();

      for (const sampleKey of ['upcoming', 'recent', 'finished']) {
        const source = sources[sampleKey];
        const match = source.matches.find((entry) => {
          const key = normalizeMatchBaseUrl(entry.url);
          if (usedBaseUrls.has(key)) return false;
          usedBaseUrls.add(key);
          return true;
        });

        if (!match) {
          sampledMatches.push({
            sampleKey,
            detectedState: null,
            matchUrl: null,
            matchTitle: null,
            tabs: {},
            coverage: {
              summary: false,
              stats: false,
              playerStats: false,
              lineups: false,
              odds: false,
            },
            missingReason: 'No match URL found for sample state',
          });
          continue;
        }

        console.log(`  ${sampleKey}: ${match.url}`);
        sampledMatches.push(await probeMatch(page, match.url, sampleKey));
      }

      const coverageTotals = sampledMatches.reduce(
        (acc, sample) => {
          for (const key of Object.keys(acc)) {
            if (sample.coverage[key]) acc[key] += 1;
          }
          return acc;
        },
        { summary: 0, stats: 0, playerStats: 0, lineups: 0, odds: 0 }
      );

      competitions.push({
        ...competition,
        sources,
        sampledMatches,
        coverageTotals,
      });
    }

    const summary = competitions.reduce(
      (acc, competition) => {
        acc.competitionCount += 1;
        acc.sampledMatches += competition.sampledMatches.length;
        for (const key of Object.keys(acc.tabAvailability)) {
          acc.tabAvailability[key] += competition.coverageTotals[key];
        }
        return acc;
      },
      {
        competitionCount: 0,
        sampledMatches: 0,
        tabAvailability: {
          summary: 0,
          stats: 0,
          playerStats: 0,
          lineups: 0,
          odds: 0,
        },
      }
    );

    const report = {
      generatedAt: new Date().toISOString(),
      source: 'soccerway.com',
      competitions,
      summary,
    };

    const outDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2), 'utf8');

    console.log(`\nWrote coverage report to:`);
    console.log(`  ${OUTPUT_PATH}`);
    console.log(`Competitions: ${summary.competitionCount}`);
    console.log(`Sampled matches: ${summary.sampledMatches}`);
    console.log(`Tab availability: ${JSON.stringify(summary.tabAvailability)}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
