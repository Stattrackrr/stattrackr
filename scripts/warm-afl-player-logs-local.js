#!/usr/bin/env node

/**
 * Warm prod Upstash player-log cache via local Next.js (home IP reaches FootyWire).
 * Requires: npm run dev in another terminal, AFL_USE_UPSTASH_CACHE=true in .env.local
 *
 *   npm run warm:afl:player-logs:local
 *   AFL_WARM_PLAYER=Heeney npm run warm:afl:player-logs:local
 */

process.env.PROD_URL = 'http://localhost:3000';
require('./warm-afl-player-logs.js');
