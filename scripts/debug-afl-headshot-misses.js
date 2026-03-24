#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function normalizeName(input) {
  return String(input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function noApostrophes(input) {
  return normalizeName(input).replace(/'/g, '');
}

function withNickSwap(normName, from, to) {
  const words = normName.split(' ').filter(Boolean);
  if (words.length === 0) return null;
  if (words[0] !== from) return null;
  return [to, ...words.slice(1)].join(' ');
}

function main() {
  const season = process.argv.find((a) => a.startsWith('--season='))?.split('=')[1] || '2026';
  const filePath = path.join(process.cwd(), 'data', `afl-player-headshots-${season}.json`);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing file: ${filePath}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const byName = data.byName || {};
  const missing = Array.isArray(data.missing) ? data.missing : [];

  const byNorm = new Map();
  const byNoApostrophe = new Map();
  for (const name of Object.keys(byName)) {
    const norm = normalizeName(name);
    const noA = noApostrophes(name);
    if (norm && !byNorm.has(norm)) byNorm.set(norm, name);
    if (noA && !byNoApostrophe.has(noA)) byNoApostrophe.set(noA, name);
  }

  const nickPairs = [
    ['lachie', 'lachlan'],
    ['matt', 'matthew'],
    ['sam', 'samuel'],
    ['cam', 'cameron'],
    ['nick', 'nicholas'],
    ['ollie', 'oliver'],
    ['zac', 'zachary'],
    ['josh', 'joshua'],
    ['mitch', 'mitchell'],
    ['tom', 'thomas'],
  ];

  const resolved = [];
  const unresolved = [];
  const reasonCount = new Map();

  for (const name of missing) {
    const norm = normalizeName(name);
    const noA = noApostrophes(name);

    let alt = null;
    let reason = '';

    if (byNorm.has(norm)) {
      alt = byNorm.get(norm);
      reason = 'exact-normalized';
    } else if (byNoApostrophe.has(noA)) {
      alt = byNoApostrophe.get(noA);
      reason = 'apostrophe-variant';
    } else {
      for (const [a, b] of nickPairs) {
        const c1 = withNickSwap(norm, a, b);
        if (c1 && byNorm.has(c1)) {
          alt = byNorm.get(c1);
          reason = `nickname:${a}->${b}`;
          break;
        }
        const c2 = withNickSwap(norm, b, a);
        if (c2 && byNorm.has(c2)) {
          alt = byNorm.get(c2);
          reason = `nickname:${b}->${a}`;
          break;
        }
      }
    }

    if (alt) {
      resolved.push({ missing: name, alt, reason });
      reasonCount.set(reason, (reasonCount.get(reason) || 0) + 1);
    } else {
      unresolved.push(name);
    }
  }

  console.log(`Season ${season}`);
  console.log(`Total missing: ${missing.length}`);
  console.log(`Resolvable by alias/variant: ${resolved.length}`);
  console.log(`Likely true misses: ${unresolved.length}`);
  console.log('');
  console.log('Reason counts:');
  for (const [reason, count] of [...reasonCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }
  console.log('');
  console.log('Resolvable samples:');
  for (const row of resolved.slice(0, 40)) {
    console.log(`  ${row.missing} -> ${row.alt} (${row.reason})`);
  }
  console.log('');
  console.log('Likely true misses:');
  for (const name of unresolved) {
    console.log(`  ${name}`);
  }
}

main();
