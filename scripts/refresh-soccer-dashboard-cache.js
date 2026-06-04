#!/usr/bin/env node

const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const teamHrefs = [];
  let pages = null;
  let persistPermanent = true;
  let skipViewCache = false;
  let skipSnapshots = false;
  let viewTeam = '';

  for (const arg of argv) {
    if (arg === '--no-permanent') {
      persistPermanent = false;
      continue;
    }
    if (arg === '--skip-view-cache') {
      skipViewCache = true;
      continue;
    }
    if (arg === '--skip-snapshots') {
      skipSnapshots = true;
      continue;
    }
    if (arg.startsWith('--pages=')) {
      const parsed = Number.parseInt(arg.slice('--pages='.length), 10);
      if (Number.isFinite(parsed) && parsed >= 0) pages = parsed;
      continue;
    }
    if (arg.startsWith('--view-team=')) {
      viewTeam = String(arg.slice('--view-team='.length) || '').trim();
      continue;
    }
    if (arg.startsWith('--')) continue;
    teamHrefs.push(arg);
  }

  return {
    teamHrefs,
    pages,
    persistPermanent,
    skipViewCache,
    skipSnapshots,
    viewTeam,
  };
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runStep(label, args) {
  console.log(`\n[Soccer Dashboard Refresh] ${label}`);
  console.log(`> ${getNpmCommand()} ${args.join(' ')}`);

  const result = spawnSync(getNpmCommand(), args, {
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
  if (result.error) {
    throw result.error;
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.teamHrefs.length === 0) {
    console.error(
      [
        'Usage: node scripts/refresh-soccer-dashboard-cache.js /team/manchester-city/Wtn9Stg0/ [/team/everton/USLsq4nh/]',
        '  [--pages=2] [--no-permanent] [--view-team=/team/manchester-city/Wtn9Stg0/]',
        '  [--skip-view-cache] [--skip-snapshots]',
      ].join('\n')
    );
    process.exit(1);
  }

  const resultsArgs = ['run', 'refresh:soccer:team-results-cache', '--', ...options.teamHrefs];
  if (options.pages != null) resultsArgs.push(`--pages=${options.pages}`);
  if (!options.persistPermanent) resultsArgs.push('--no-permanent');
  runStep('Refresh team results caches', resultsArgs);

  if (!options.skipViewCache) {
    const viewTeam = options.viewTeam || options.teamHrefs[0];
    runStep('Refresh fixture and lineup cache', ['run', 'refresh:soccer:view-cache', '--', viewTeam]);
  }

  if (!options.skipSnapshots) {
    runStep('Rebuild last-5 Premier League snapshots', ['run', 'build:soccer:last5:pl']);
    runStep('Rebuild Premier League matchup snapshot', ['run', 'build:soccer:team-matchup:pl']);
    runStep('Rebuild Premier League opponent breakdown snapshot', ['run', 'build:soccer:opponent-breakdown:pl']);
  }

  console.log('\n[Soccer Dashboard Refresh] Done');
}

try {
  main();
} catch (error) {
  console.error('[Soccer Dashboard Refresh] Failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
