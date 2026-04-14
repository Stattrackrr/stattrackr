#!/usr/bin/env node

/**
 * Proof-of-concept Soccerway scraper.
 *
 * Usage:
 *   node scripts/test-soccerway-scrape.js
 *   node scripts/test-soccerway-scrape.js --url=https://www.soccerway.com/match/...
 *
 * This script does not build the final ingestion pipeline yet. It fetches a
 * Soccerway match across multiple tabs and writes a JSON report describing what
 * the site exposes for:
 * - summary metadata
 * - match/stat/player-stat labels
 * - event markers
 * - available tabs
 * - internal page hints (preconnects, assets, event id)
 *
 * The goal is to help us confirm what can be scraped before wiring a real model
 * or UI around it.
 */

 const fs = require('fs');
 const path = require('path');

 const DEFAULT_URL = 'https://www.soccerway.com/match/dortmund-nP1i5US1/vfb-stuttgart-nJQmYp1B/summary/';
 const DEFAULT_OUTPUT = path.join(process.cwd(), 'data', 'soccerway-scrape-report.json');
 const TAB_IDENTS = ['summary', 'stats', 'player-stats', 'lineups'];

 function getArg(name, fallback) {
   const prefix = `--${name}=`;
   const raw = process.argv.find((arg) => arg.startsWith(prefix));
   return raw ? raw.slice(prefix.length) : fallback;
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

 function stripTags(value) {
   return decodeHtml(
     String(value || '')
       .replace(/<script[\s\S]*?<\/script>/gi, ' ')
       .replace(/<style[\s\S]*?<\/style>/gi, ' ')
       .replace(/<[^>]+>/g, ' ')
   );
 }

 function unique(values) {
   return [...new Set(values.filter(Boolean))];
 }

 function extractTitle(html) {
   const match = html.match(/<title>([\s\S]*?)<\/title>/i);
   return match ? decodeHtml(match[1]) : null;
 }

 function extractMetaProperty(html, propertyName) {
   const match = html.match(new RegExp(`<meta[^>]+property=["']${propertyName}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, 'i'));
   return match ? decodeHtml(match[1]) : null;
 }

 function extractMetaDescription(html) {
   const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i);
   return match ? decodeHtml(match[1]) : null;
 }

 function extractCanonical(html) {
   const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i);
   return match ? decodeHtml(match[1]) : null;
 }

 function extractJsonAssignments(html) {
   const assignments = [];
   const patterns = [
     /window\.footballMenuData\s*=\s*(\{[\s\S]*?\});/i,
     /window\.environment\s*=\s*(\{[\s\S]*?\});/i,
   ];

   for (const pattern of patterns) {
     const match = html.match(pattern);
     if (!match) continue;
     const source = match[0].split('=')[0].trim();
     assignments.push({
       source,
       preview: match[1].slice(0, 1200),
     });
   }

   return assignments;
 }

 function extractStatLabels(html) {
   const labelRegex = /TRANS_SOCCER_STATISTICS_([A-Z_]+)":"([^"]+)"/g;
   const labels = [];
   let match;

   while ((match = labelRegex.exec(html))) {
     labels.push({
       key: match[1],
       label: decodeHtml(match[2]),
     });
   }

   return labels;
 }

 function extractPlayerStatLabels(html) {
   const labelRegex = /TRANS_SOCCER_PLAYER_STATISTICS_([A-Z_]+)":"([^"]+)"/g;
   const labels = [];
   let match;

   while ((match = labelRegex.exec(html))) {
     labels.push({
       key: match[1],
       label: decodeHtml(match[2]),
     });
   }

   return labels;
 }

 function extractShortPlayerStatLabels(html) {
   const labelRegex = /TRANS_SOCCER_PLAYER_STATISTICS_SHORT_([A-Z_]+)":"([^"]+)"/g;
   const labels = [];
   let match;

   while ((match = labelRegex.exec(html))) {
     labels.push({
       key: match[1],
       label: decodeHtml(match[2]),
     });
   }

   return labels;
 }

 function extractEventLabels(html) {
   const labelRegex = /TRANS_SOCCER_MATCH_SCORER_TYPE_([A-Z_]+)":"([^"]+)"/g;
   const labels = [];
   let match;

   while ((match = labelRegex.exec(html))) {
     labels.push({
       key: match[1],
       label: decodeHtml(match[2]),
     });
   }

   return labels;
 }

 function locateKeywordSnippets(html, keywords) {
   const snippets = [];

   for (const keyword of keywords) {
     let fromIndex = 0;
     let hits = 0;

     while (hits < 3) {
       const index = html.toLowerCase().indexOf(keyword.toLowerCase(), fromIndex);
       if (index === -1) break;
       const rawSnippet = html.slice(Math.max(0, index - 300), index + 500);
       const cleaned = stripTags(rawSnippet);
       if (cleaned && cleaned.length > 20) {
         snippets.push({
           keyword,
           snippet: cleaned,
         });
         hits += 1;
       }
       fromIndex = index + keyword.length;
     }
   }

   return snippets;
 }

 function extractLinks(html, pattern, limit = 40) {
   const matches = [...html.matchAll(pattern)].map((match) => decodeHtml(match[1] || match[0]));
   return unique(matches).slice(0, limit);
 }

 function extractPreconnects(html) {
   return extractLinks(html, /<link[^>]+rel="preconnect"[^>]+href="([^"]+)"/gi, 20);
 }

 function extractScriptAssets(html) {
   return extractLinks(html, /<script[^>]+src="([^"]+)"/gi, 80);
 }

 function extractEventId(html) {
   const match = html.match(/"event_id_c":"([^"]+)"/i);
   return match ? match[1] : null;
 }

 function extractTabIdentifiers(html) {
   const tabs = [];
   const regex = /TRANS_DETAIL_BOOKMARK_URL_IDENT_([A-Z_]+)":"([^"]+)"/g;
   let match;
   while ((match = regex.exec(html))) {
     tabs.push({
       key: match[1],
       ident: decodeHtml(match[2]),
     });
   }
   return tabs;
 }

 function normalizeMatchBaseUrl(url) {
   const match = String(url).match(/^(https?:\/\/www\.soccerway\.com\/match\/[^/]+\/[^/]+\/)(?:summary\/(?:stats|player-stats|lineups)\/?)?/i);
   if (match) return match[1];
   return url.endsWith('/') ? url : `${url}/`;
 }

 function buildTabUrl(baseUrl, tabIdent) {
   if (tabIdent === 'summary') {
     return `${baseUrl}summary/`;
   }
   return `${baseUrl}summary/${tabIdent}/`;
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

 function buildPageReport(url, html) {
   const statLabels = extractStatLabels(html);
   const playerStatLabels = extractPlayerStatLabels(html);
   const shortPlayerStatLabels = extractShortPlayerStatLabels(html);
   const eventLabels = extractEventLabels(html);

   return {
     url,
     title: extractTitle(html),
     canonicalUrl: extractCanonical(html),
     metaDescription: extractMetaDescription(html),
     ogTitle: extractMetaProperty(html, 'og:title'),
     ogDescription: extractMetaProperty(html, 'og:description'),
     htmlLength: html.length,
     eventId: extractEventId(html),
     preconnects: extractPreconnects(html),
     scriptAssets: extractScriptAssets(html)
       .filter((asset) => /detail|player|stats|match|graphql|container/i.test(asset))
       .slice(0, 40),
     tabIdentifiers: extractTabIdentifiers(html),
     statLabelCount: statLabels.length,
     playerStatLabelCount: playerStatLabels.length,
     shortPlayerStatLabelCount: shortPlayerStatLabels.length,
     eventLabelCount: eventLabels.length,
     statLabels,
     playerStatLabels,
     shortPlayerStatLabels,
     eventLabels,
     likelyCoverage: inferCoverage(statLabels),
     playerLinksSample: extractLinks(html, /href="(\/player\/[^"]+)"/gi, 30),
     teamLinksSample: extractLinks(html, /href="(\/team\/[^"]+)"/gi, 30),
     matchLinksSample: extractLinks(html, /href="(\/match\/[^"]+)"/gi, 30),
     snippets: locateKeywordSnippets(html, [
       'Corner kicks',
       'Shots on goal',
       'Yellow cards',
       'Red cards',
       'Assists',
       'Goals',
       'Goalkeeper saves',
       'lineups',
       'player stats',
     ]),
     tableTagCount: (html.match(/<table/gi) || []).length,
   };
 }

 function inferCoverage(statLabels) {
   const labelSet = new Set(statLabels.map((item) => item.label.toLowerCase()));
   const includesAny = (candidates) => candidates.some((candidate) => labelSet.has(candidate.toLowerCase()));

   return {
     teamGoals: true,
     teamShots: includesAny(['Goal attempts', 'Shots on goal', 'Shots off goal']),
     teamShotsOnTarget: includesAny(['Shots on goal']),
     teamCorners: includesAny(['Corner kicks']),
     teamCards: includesAny(['Yellow cards', 'Red cards']),
     playerGoalsFromEvents: true,
     playerAssistsFromEvents: true,
     playerCardsFromEvents: true,
     playerShotsLikely: includesAny(['Shots on goal', 'Shots off goal']),
     playerShotsOnTargetLikely: includesAny(['Shots on goal']),
   };
 }

 async function main() {
   const url = getArg('url', DEFAULT_URL);
   const outPath = getArg('out', DEFAULT_OUTPUT);
   const baseUrl = normalizeMatchBaseUrl(url);

   console.log('Fetching Soccerway pages...');
   console.log(`  base: ${baseUrl}`);

   const pages = {};
   for (const tabIdent of TAB_IDENTS) {
     const tabUrl = buildTabUrl(baseUrl, tabIdent);
     console.log(`  ${tabIdent}: ${tabUrl}`);
     const html = await fetchHtml(tabUrl);
     pages[tabIdent] = buildPageReport(tabUrl, html);
   }

   const summaryPage = pages.summary;

   const report = {
     generatedAt: new Date().toISOString(),
     source: 'soccerway.com',
     inputUrl: url,
     baseUrl,
     title: summaryPage?.title || null,
     canonicalUrl: summaryPage?.canonicalUrl || null,
     ogTitle: summaryPage?.ogTitle || null,
     ogDescription: summaryPage?.ogDescription || null,
     eventId: summaryPage?.eventId || null,
     availableTabs: TAB_IDENTS,
     pages,
     combinedCoverage: {
       teamStats: {
         statsPage: pages.stats?.likelyCoverage || null,
       },
       playerStats: {
         labelsDetected: pages['player-stats']?.playerStatLabelCount || 0,
         shortLabelsDetected: pages['player-stats']?.shortPlayerStatLabelCount || 0,
         playerShots: (pages['player-stats']?.playerStatLabels || []).some((item) => item.key === 'SHOTS_ON_GOAL' || item.key === 'SHOTS_OFF_GOAL'),
         playerShotsOnTarget: (pages['player-stats']?.playerStatLabels || []).some((item) => item.key === 'SHOTS_ON_GOAL'),
         playerGoals: (pages['player-stats']?.playerStatLabels || []).some((item) => item.key === 'GOALS'),
         playerAssists: (pages['player-stats']?.playerStatLabels || []).some((item) => item.key === 'ASSISTS'),
         playerCards: (pages['player-stats']?.playerStatLabels || []).some((item) => item.key === 'YELLOW_CARDS' || item.key === 'RED_CARDS'),
         goalkeeperSaves: (pages['player-stats']?.playerStatLabels || []).some((item) => item.key === 'GOALKEEPER_SAVES'),
       },
       events: {
         summaryHasGoalEvents: (pages.summary?.eventLabels || []).some((item) => item.key === 'GOAL'),
         summaryHasCardEvents: (pages.summary?.eventLabels || []).some((item) => item.key === 'YELLOW' || item.key === 'RED'),
       },
     },
     jsonAssignments: [], // kept for backwards compatibility; page-level assignments live inside report.pages
   };

   const outDir = path.dirname(outPath);
   if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
   fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

   console.log(`\nWrote scrape report to:`);
   console.log(`  ${outPath}`);
   console.log(`\nPages fetched: ${Object.keys(pages).join(', ')}`);
   console.log(`Summary event id: ${report.eventId || 'n/a'}`);
   console.log(`\nStats tab labels: ${pages.stats?.statLabelCount || 0}`);
   console.log(`Player-stats labels: ${pages['player-stats']?.playerStatLabelCount || 0}`);
   console.log(`Player-stats short labels: ${pages['player-stats']?.shortPlayerStatLabelCount || 0}`);
   console.log(`Summary event labels: ${pages.summary?.eventLabelCount || 0}`);
   console.log(`\nCombined coverage:`);
   console.log(`  playerShots: ${report.combinedCoverage.playerStats.playerShots ? 'yes' : 'no'}`);
   console.log(`  playerShotsOnTarget: ${report.combinedCoverage.playerStats.playerShotsOnTarget ? 'yes' : 'no'}`);
   console.log(`  playerGoals: ${report.combinedCoverage.playerStats.playerGoals ? 'yes' : 'no'}`);
   console.log(`  playerAssists: ${report.combinedCoverage.playerStats.playerAssists ? 'yes' : 'no'}`);
   console.log(`  playerCards: ${report.combinedCoverage.playerStats.playerCards ? 'yes' : 'no'}`);
   console.log(`  goalkeeperSaves: ${report.combinedCoverage.playerStats.goalkeeperSaves ? 'yes' : 'no'}`);
 }

 main().catch((error) => {
   console.error(error);
   process.exit(1);
 });
