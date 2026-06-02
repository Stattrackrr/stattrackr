#!/usr/bin/env node
/**
 * Probe FotMob: capture all API calls + responses on a known Nations League match.
 * Also test fetch from page context for NL League A.
 */
const puppeteer = require('puppeteer');
const path = require('path');

async function launchBrowser() {
  try { return await puppeteer.launch({ headless: true }); } catch {}
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  for (const exec of candidates) {
    try { return await puppeteer.launch({ headless: true, executablePath: exec }); } catch {}
  }
  throw new Error('No Chrome available');
}

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // 1. Load NL League A fixtures and grab leagues JSON from page-context fetch
  console.log('Loading NL League A fixtures (season 2022-2023)...');
  await page.goto('https://www.fotmob.com/leagues/9806/matches/uefa-nations-league?season=2022-2023', {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });
  await new Promise((r) => setTimeout(r, 4000));

  console.log('\n--- Test 1: get a match id from fixtures.allMatches ---');
  const leagueRes = await page.evaluate(async () => {
    try {
      const res = await fetch('/api/data/leagues?id=9806&ccode3=USA&season=2022%2F2023');
      const parsed = await res.json();
      const all = parsed?.fixtures?.allMatches || [];
      return {
        totalMatches: all.length,
        firstMatch: all[0],
        completedSample: all.find((m) => m.status?.finished || m.status?.cancelled === false && m.status?.started),
      };
    } catch (e) { return { error: String(e) }; }
  });
  console.log(JSON.stringify(leagueRes, null, 2).slice(0, 2500));

  const matchId = leagueRes?.firstMatch?.id;
  console.log(`\nUsing matchId=${matchId} for pub.fotmob.com test...`);

  if (matchId) {
    const detailRes = await page.evaluate(async (id) => {
      const res = await fetch(`/api/data/match?id=${id}`);
      const parsed = await res.json();
      return {
        topKeys: Object.keys(parsed),
        stats: parsed.stats,
      };
    }, matchId);
    console.log('detail (full):', JSON.stringify(detailRes, null, 2).slice(0, 3000));

    console.log('\n--- Also try /api/data/playerStats etc ---');
    const otherEndpoints = [
      `/api/data/playerStats?matchId=${matchId}`,
      `/api/data/lineups?matchId=${matchId}`,
      `/api/data/lineup?id=${matchId}`,
      `/api/data/playerData?matchId=${matchId}`,
      `/api/data/playerStats/match?id=${matchId}`,
      `/api/data/matchStats?matchId=${matchId}`,
    ];
    for (const u of otherEndpoints) {
      const r = await page.evaluate(async (uu) => {
        try {
          const res = await fetch(uu);
          const text = await res.text();
          let parsed = null;
          try { parsed = JSON.parse(text); } catch {}
          return {
            url: uu,
            status: res.status,
            len: text.length,
            topKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 12) : null,
            preview: text.slice(0, 120),
          };
        } catch (e) { return { url: uu, error: String(e) }; }
      }, u);
      console.log('   ', JSON.stringify(r));
    }
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
