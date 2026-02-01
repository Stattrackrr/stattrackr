#!/usr/bin/env node
/**
 * Instructions to apply Prediction Engine DB tables to Supabase
 * Run: node scripts/apply-prediction-engine-tables.mjs
 *
 * These tables are required for: coach_tendencies, arena_factors, referee_stats,
 * player_contracts, player_former_teams (prediction models use real data when available)
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '..', 'migrations', 'create_prediction_engine_tables.sql');

console.log('\n📦 PREDICTION ENGINE TABLES MIGRATION\n');
console.log('To fix "Could not find table" errors, run this SQL in Supabase:\n');
console.log('  1. Open Supabase Dashboard → SQL Editor');
console.log('  2. New query → paste the contents of:');
console.log('     migrations/create_prediction_engine_tables.sql');
console.log('  3. Run\n');
console.log('─'.repeat(60));
try {
  const sql = readFileSync(sqlPath, 'utf8');
  console.log(sql);
  console.log('─'.repeat(60));
} catch (e) {
  console.log('(Could not read migration file)\n');
}
