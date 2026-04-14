#!/usr/bin/env node

/**
 * Browser-assisted Soccerway probe.
 *
 * Uses Puppeteer to open a Soccerway match and inspect the fully rendered DOM,
 * plus capture likely JSON/API calls that power the page.
 *
 * Usage:
 *   node scripts/test-soccerway-browser-scrape.js
 *   node scripts/test-soccerway-browser-scrape.js --url=https://www.soccerway.com/match/.../summary/
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const DEFAULT_URL = 'https://www.soccerway.com/match/dortmund-nP1i5US1/vfb-stuttgart-nJQmYp1B/summary/';
const DEFAULT_OUTPUT = path.join(process.cwd(), 'data', 'soccerway-browser-report.json');
const TAB_IDENTS = ['summary', 'stats', 'player-stats', 'lineups'];

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : fallback;
}

function normalizeMatchBaseUrl(url) {
  const match = String(url).match(/^(https?:\/\/www\.soccerway\.com\/match\/[^/]+\/[^/]+\/)(?:summary\/(?:stats|player-stats|lineups)?\/?)?/i);
  if (match) return match[1];
  return url.endsWith('/') ? url : `${url}/`;
}

function buildTabUrl(baseUrl, tabIdent) {
  if (tabIdent === 'summary') return `${baseUrl}summary/`;
  return `${baseUrl}summary/${tabIdent}/`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function summarizeJsonShape(value, depth = 0) {
  if (depth > 2) return Array.isArray(value) ? '[array]' : typeof value;
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      firstItem: value.length ? summarizeJsonShape(value[0], depth + 1) : null,
    };
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).slice(0, 20)) {
      out[key] = summarizeJsonShape(value[key], depth + 1);
    }
    return out;
  }
  return value === null ? null : typeof value;
}

async function capturePage(page, url) {
  const networkEvents = [];
  const seenUrls = new Set();

  const onResponse = async (response) => {
    try {
      const req = response.request();
      const targetUrl = response.url();
      const contentType = response.headers()['content-type'] || '';
      const isInterestingUrl = /pq_graphql|graphql|api|feed|participant|lineup|stat|match/i.test(targetUrl);
      const isInterestingType = /json|graphql/i.test(contentType);
      if (!isInterestingUrl && !isInterestingType) return;
      if (seenUrls.has(`${req.method()}:${targetUrl}`)) return;
      seenUrls.add(`${req.method()}:${targetUrl}`);

      let bodyPreview = null;
      let jsonShape = null;
      if (/json|graphql/i.test(contentType)) {
        const text = await response.text().catch(() => null);
        if (text) {
          bodyPreview = text.slice(0, 2000);
          const parsed = safeParseJson(text);
          if (parsed) jsonShape = summarizeJsonShape(parsed);
        }
      }

      networkEvents.push({
        url: targetUrl,
        method: req.method(),
        resourceType: req.resourceType(),
        status: response.status(),
        contentType,
        postDataPreview: req.postData() ? req.postData().slice(0, 1000) : null,
        bodyPreview,
        jsonShape,
      });
    } catch {
      // Ignore noisy response parsing failures.
    }
  };

  page.on('response', onResponse);

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(4000);

  const dom = await page.evaluate(() => {
    const pickText = (selector) => {
      const el = document.querySelector(selector);
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
    };

    const getLinks = (selector, limit = 30) =>
      Array.from(document.querySelectorAll(selector))
        .map((el) => el.getAttribute('href'))
        .filter(Boolean)
        .slice(0, limit);

    const tables = Array.from(document.querySelectorAll('table')).slice(0, 12).map((table, tableIndex) => {
      const rows = Array.from(table.querySelectorAll('tr')).slice(0, 10).map((row) =>
        Array.from(row.querySelectorAll('th, td')).map((cell) => cell.textContent.replace(/\s+/g, ' ').trim())
      );
      return {
        tableIndex,
        className: table.className || null,
        rowCount: table.querySelectorAll('tr').length,
        rows,
      };
    });

    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
      .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 60);

    const bodyText = document.body ? document.body.innerText.replace(/\s+/g, ' ').trim() : '';
    const keywordSnippets = ['Shots on goal', 'Corner kicks', 'Yellow cards', 'Player stats', 'Lineups', 'Assists', 'Goals']
      .map((keyword) => {
        const idx = bodyText.toLowerCase().indexOf(keyword.toLowerCase());
        if (idx === -1) return null;
        return {
          keyword,
          snippet: bodyText.slice(Math.max(0, idx - 180), idx + 320),
        };
      })
      .filter(Boolean);

    return {
      title: document.title,
      h1: pickText('h1'),
      bodyTextLength: bodyText.length,
      headings,
      tables,
      keywordSnippets,
      playerLinks: getLinks('a[href*="/player/"]'),
      teamLinks: getLinks('a[href*="/team/"]'),
      matchLinks: getLinks('a[href*="/match/"]'),
      tabLinks: getLinks('a[href*="/summary/"]', 50),
    };
  });

  page.off('response', onResponse);

  return {
    url,
    dom,
    networkEvents: networkEvents.slice(0, 80),
  };
}

async function main() {
  const url = getArg('url', DEFAULT_URL);
  const outPath = getArg('out', DEFAULT_OUTPUT);
  const baseUrl = normalizeMatchBaseUrl(url);

  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });

    const tabs = {};
    for (const tabIdent of TAB_IDENTS) {
      const tabUrl = buildTabUrl(baseUrl, tabIdent);
      console.log(`Opening ${tabIdent}: ${tabUrl}`);
      tabs[tabIdent] = await capturePage(page, tabUrl);
    }

    const report = {
      generatedAt: new Date().toISOString(),
      source: 'soccerway.com',
      baseUrl,
      tabs,
    };

    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(`\nWrote browser report to:`);
    console.log(`  ${outPath}`);
    for (const tabIdent of TAB_IDENTS) {
      const tab = tabs[tabIdent];
      console.log(`\n${tabIdent}:`);
      console.log(`  title: ${tab.dom.title}`);
      console.log(`  headings: ${tab.dom.headings.length}`);
      console.log(`  tables: ${tab.dom.tables.length}`);
      console.log(`  playerLinks: ${tab.dom.playerLinks.length}`);
      console.log(`  teamLinks: ${tab.dom.teamLinks.length}`);
      console.log(`  networkEvents: ${tab.networkEvents.length}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
