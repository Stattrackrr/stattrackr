#!/usr/bin/env node

/**
 * Ingest DvP for all teams script
 *
 * Usage:
 *   BASE_URL=https://your.app node scripts/ingest-dvp.js [--season 2025] [--games 82] [--refresh]
 */

const https = require('https');
const http = require('http');

function parseArgs(){
  const args = process.argv.slice(2);
  const out = { season: null, games: 82, refresh: false, base: process.env.BASE_URL || 'http://localhost:3000' };
  for (let i=0;i<args.length;i++){
    const a = args[i];
    if (a === '--season') out.season = parseInt(args[++i], 10);
    else if (a === '--games') out.games = parseInt(args[++i], 10);
    else if (a === '--refresh') out.refresh = true;
    else if (a === '--base' || a === '--url') out.base = args[++i];
  }
  return out;
}

function currentSeason(){
  const now = new Date();
  const m = now.getMonth();
  const d = now.getDate();
  if (m === 9 && d >= 15) return now.getFullYear();
  return m >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}

function fetchJson(url){
  return new Promise((resolve, reject)=>{
    const isHttps = url.startsWith('https://');
    const lib = isHttps ? https : http;
    const req = lib.get(url, (res)=>{
      let data='';
      res.on('data', c=> data+=c);
      res.on('end', ()=>{
        try{ resolve(JSON.parse(data)); }catch{ resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
  });
}

(async ()=>{
  const { season, games, refresh, base } = parseArgs();
  const y = season || currentSeason();
  const qs = `season=${y}&games=${Math.min(games||82,82)}${refresh?'&refresh=1':''}`;
  const endpoints = [
    `${base.replace(/\/$/,'')}/api/dvp/ingest-nba-all?${qs}`,
    `${base.replace(/\/$/,'')}/api/dvp/ingest-all?${qs}`,
  ];
  for (const url of endpoints){
    try{
      console.log('Ingest:', url);
      const js = await fetchJson(url);
      console.log('Result:', (js && js.success) ? 'ok' : 'fail', js?.ok ?? js?.total ?? '');
    }catch(e){ console.error('Error:', e?.message||e); }
  }
})();
