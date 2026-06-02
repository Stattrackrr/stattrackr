#!/usr/bin/env node
/** Probe FBref Nations League 2022-23 schedule page structure */
const { execSync } = require('child_process');
const path = require('path');

async function loadPuppeteer() {
  try {
    return require('puppeteer');
  } catch (e) {
    throw e;
  }
}

async function launchBrowser(puppeteer) {
  try {
    return await puppeteer.launch({ headless: true });
  } catch {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const executablePath of candidates) {
      try {
        return await puppeteer.launch({ headless: true, executablePath });
      } catch {
        // continue
      }
    }
    throw new Error('No Chrome available. Try: npx puppeteer browsers install chrome');
  }
}

async function main() {
  const puppeteer = await loadPuppeteer();
  const browser = await launchBrowser(puppeteer);
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  const url = 'https://fbref.com/en/comps/179/2022-2023/schedule/UEFA-Nations-League-Scores-and-Fixtures';
  console.log('Loading', url);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 4000));

  const info = await page.evaluate(() => {
    const allTables = [...document.querySelectorAll('table')].map((t) => ({
      id: t.id,
      className: t.className,
      hasStatsClass: t.classList.contains('stats_table'),
      caption: t.querySelector('caption')?.textContent?.trim().slice(0, 80) || null,
      rowCount: t.querySelectorAll('tbody tr').length,
      headerKeys: [...t.querySelectorAll('thead tr:last-child th')]
        .map((th) => th.getAttribute('data-stat') || th.textContent.trim())
        .slice(0, 25),
    }));
    const schedTable =
      document.querySelector('table[id^="sched_"]') ||
      document.querySelector('table.stats_table');
    let sample = null;
    if (schedTable) {
      const rows = [...schedTable.querySelectorAll('tbody tr')].slice(0, 4);
      sample = rows.map((tr) => ({
        className: tr.className,
        cells: [...tr.querySelectorAll('th,td')].slice(0, 12).map((td) => ({
          stat: td.getAttribute('data-stat'),
          text: (td.textContent || '').trim().slice(0, 40),
          href: td.querySelector('a')?.getAttribute('href') || null,
        })),
      }));
    }
    return {
      title: document.title,
      tableCount: allTables.length,
      tables: allTables,
      schedTableId: schedTable?.id || null,
      sampleRows: sample,
      bodyTextSnippet: document.body.textContent.replace(/\s+/g, ' ').slice(0, 300),
    };
  });

  console.log('TITLE:', info.title);
  console.log('TABLES:', info.tableCount);
  for (const t of info.tables) {
    console.log(`  id=${t.id || '(none)'} stats=${t.hasStatsClass} caption="${t.caption}" rows=${t.rowCount}`);
    if (t.headerKeys.length) console.log(`     header data-stat keys: ${t.headerKeys.join(', ')}`);
  }
  console.log('\nSchedule table id:', info.schedTableId);
  if (info.sampleRows) {
    console.log('Sample rows:');
    for (const r of info.sampleRows) {
      console.log(`  [${r.className}]`);
      for (const c of r.cells) {
        console.log(`    ${c.stat}: "${c.text}"${c.href ? `  href=${c.href}` : ''}`);
      }
    }
  }
  console.log('\nBody snippet:', info.bodyTextSnippet);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
