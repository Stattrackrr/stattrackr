#!/usr/bin/env node
/** Quick test: fetch AFL Tables gbg page and see if we can find Massimo D'Ambrosio and round columns. */
const url = 'https://afltables.com/afl/stats/teams/hawthorn/2025_gbg.html';

fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  .then((r) => r.text())
  .then((html) => {
    const hasAmbrosio = html.includes("D'Ambrosio") || html.includes('Ambrosio');
    const tables = html.match(/<table[^>]*>/gi);
    console.log('Has Ambrosio in HTML:', hasAmbrosio);
    console.log('Table count:', tables ? tables.length : 0);
    if (html.includes('Ambrosio')) {
      const idx = html.indexOf('Ambrosio');
      const snippet = html.slice(Math.max(0, idx - 100), idx + 100);
      console.log('Context:', snippet.replace(/\s+/g, ' '));
    }
    const firstTableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
    if (firstTableMatch) {
      const firstTable = firstTableMatch[1];
      const trs = firstTable.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
      console.log('First table tr count:', trs ? trs.length : 0);
      for (let i = 0; i < Math.min(4, trs ? trs.length : 0); i++) {
        const rowHtml = trs[i].replace(/^<tr[^>]*>|<\/tr>$/gi, '');
        const cells = rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi);
        const text = (cells || []).slice(0, 8).map((c) => c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        console.log('Row', i, 'cell count:', cells ? cells.length : 0, 'first 8:', text);
      }
    }
  })
  .catch((e) => console.error(e));
