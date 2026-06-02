#!/usr/bin/env node
/** Probe Sofascore API via page-context fetch (bypasses 403). */
const puppeteer = require('puppeteer');
const path = require('path');

async function launchBrowser() {
  try { return await puppeteer.launch({ headless: true }); } catch {}
  for (const exec of [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]) {
    try { return await puppeteer.launch({ headless: true, executablePath: exec }); } catch {}
  }
  throw new Error('No Chrome');
}

async function fetchJson(page, url) {
  return page.evaluate(async (u) => {
    const res = await fetch(u, { headers: { Accept: 'application/json' } });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, len: text.length, preview: text.slice(0, 250), json };
  }, url);
}

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  console.log('Loading Sofascore NL page...');
  await page.goto('https://www.sofascore.com/tournament/football/europe/uefa-nations-league/10783', {
    waitUntil: 'networkidle2',
    timeout: 90000,
  });
  await new Promise((r) => setTimeout(r, 4000));

  const base = 'https://api.sofascore.com/api/v1';

  console.log('\n--- seasons ---');
  const seasons = await fetchJson(page, `${base}/unique-tournament/10783/seasons`);
  console.log('status', seasons.status, 'len', seasons.len);
  if (seasons.json?.seasons) {
    for (const s of seasons.json.seasons.slice(0, 8)) {
      console.log(`  id=${s.id} year=${s.year} name=${s.name}`);
    }
  } else {
    console.log(seasons.preview);
  }

  const seasonId = seasons.json?.seasons?.find((s) => String(s.year).includes('22'))?.id
    || seasons.json?.seasons?.[2]?.id;
  console.log('\nUsing seasonId', seasonId);

  console.log('\n--- events page 0 ---');
  const events = await fetchJson(
    page,
    `${base}/unique-tournament/10783/season/${seasonId}/events/last/0`
  );
  console.log('status', events.status);
  const evList = events.json?.events || [];
  console.log('events', evList.length);
  const finished = evList.find((e) => e.status?.type === 'finished');
  console.log('sample event id', finished?.id, finished?.homeTeam?.name, 'vs', finished?.awayTeam?.name);

  if (finished?.id) {
    console.log('\n--- lineups ---');
    const lineups = await fetchJson(page, `${base}/event/${finished.id}/lineups`);
    console.log('status', lineups.status, 'keys', lineups.json ? Object.keys(lineups.json) : null);
    const home = lineups.json?.home?.players?.[0];
    console.log('home player sample keys', home ? Object.keys(home) : null);
    console.log('home player sample', JSON.stringify(home, null, 2).slice(0, 1200));

    console.log('\n--- incident (goals/cards) ---');
    const inc = await fetchJson(page, `${base}/event/${finished.id}/incidents`);
    console.log('status', inc.status, 'incidents', inc.json?.incidents?.length);

    console.log('\n--- player statistics endpoint ---');
    const ps = await fetchJson(page, `${base}/event/${finished.id}/statistics`);
    console.log('status', ps.status, 'keys', ps.json ? Object.keys(ps.json) : null);
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
