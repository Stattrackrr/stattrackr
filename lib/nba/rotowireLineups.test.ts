import assert from 'node:assert/strict';
import test from 'node:test';
import { etTimeToUtc, mergeRotowireDay, parseRotowireLineups, rotowireFetchDue } from '@/lib/nba/rotowireLineups';

const player = (cls: string, pos: string, name: string, inj?: string) => `
        <li class="lineup__player ${cls}" title="x">
            <div class="lineup__pos" >${pos}</div>
            <a title="${name}" href="/basketball/player/x-1">${name.split(' ')[1]}</a>
            ${inj ? `<span class="lineup__inj">${inj}</span>` : ''}        </li>`;

const list = (side: string, status: string, starters: string[], out: string) => `
<ul class="lineup__list is-${side}">
  <li class="lineup__status ${status}"><div class="dot"></div>${status === 'is-confirmed' ? 'Confirmed Lineup' : 'Expected Lineup'}</li>
  ${starters.join('')}
  <li><button class="see-proj-minutes">Projected Minutes</button></li>
  <li class="lineup__title is-middle">MAY NOT PLAY</li>
  ${out}
</ul>`;

const five = (names: string[]) => names.map((n, i) => player('is-pct-play-100', ['PG', 'SG', 'SF', 'PF', 'C'][i]!, n));

const PAGE = `<h1>Starting lineups for October 20, 2026</h1>
<div class="lineup is-nba" data-lnum="1">
  <div class="lineup__time">7:00 PM ET</div>
  <div class="lineup__abbr">BOS</div><div class="lineup__abbr">DET</div>
  ${list('visit', 'is-expected', five(['Derrick White', 'Paul George', 'Jayson Tatum', 'Jordan Walsh', 'Mitchell Robinson']), player('is-pct-play-0 has-injury-status', 'G', 'Devin Carter', 'Out'))}
  ${list('home', 'is-confirmed', five(['Cade Cunningham', 'Duncan Robinson', 'Ausar Thompson', 'John Collins', 'Jalen Duren']), player('is-pct-play-50 has-injury-status', 'F', 'Taurean Prince', 'Ques'))}
</div>
<div class="lineup is-nba is-tools is-picks"><div class="lineup__abbr">X</div></div>
<div class="lineup is-nba" data-lnum="2">
  <div class="lineup__time">10:30 PM ET</div>
  <div class="lineup__abbr">GS</div><div class="lineup__abbr">PHO</div>
  ${list('visit', 'is-expected', five(['Stephen Curry', 'Brandin Podziemski', 'Jimmy Butler', 'Draymond Green', 'Al Horford']), '')}
  ${list('home', 'is-expected', five(['Collin Gillespie', 'Devin Booker', 'Dillon Brooks', 'Ryan Dunn', 'Mark Williams']), player('is-pct-play-75 has-injury-status', 'G', 'Jalen Green', 'Prob'))}
</div>`;

test('rotowire: parses date, tip times, teams, starters and may-not-play tags', () => {
  const page = parseRotowireLineups(PAGE);
  assert.equal(page.date, '2026-10-20');
  assert.equal(page.games.length, 2, 'tool blocks are skipped');
  const [a, b] = page.games;
  assert.equal(a!.tipAt, '2026-10-20T23:00:00.000Z', '7pm EDT');
  assert.equal(a!.away.team, 'BOS');
  assert.equal(a!.home.team, 'DET');
  assert.equal(a!.away.confirmed, false);
  assert.equal(a!.home.confirmed, true);
  assert.deepEqual(a!.away.starters.map((p) => p.name), ['Derrick White', 'Paul George', 'Jayson Tatum', 'Jordan Walsh', 'Mitchell Robinson']);
  assert.deepEqual(a!.away.starters[4], { name: 'Mitchell Robinson', pos: 'C', playPct: 100, tag: null });
  assert.deepEqual(a!.away.mayNotPlay, [{ name: 'Devin Carter', pos: 'G', playPct: 0, tag: 'Out' }]);
  assert.deepEqual(a!.home.mayNotPlay, [{ name: 'Taurean Prince', pos: 'F', playPct: 50, tag: 'Ques' }]);
  assert.equal(b!.away.team, 'GSW', 'RotoWire short codes map to ours');
  assert.equal(b!.home.team, 'PHX');
  assert.equal(b!.away.mayNotPlay.length, 0);
  assert.equal(b!.tipAt, '2026-10-21T02:30:00.000Z');
});

test('rotowire: ET tip times convert across daylight saving', () => {
  assert.equal(etTimeToUtc('2026-12-25', '12:00 PM ET'), '2026-12-25T17:00:00.000Z', 'EST');
  assert.equal(etTimeToUtc('2026-10-20', '12:30 AM'), '2026-10-20T04:30:00.000Z');
  assert.equal(etTimeToUtc('2026-10-20', 'TBD'), null);
});

test('rotowire: fetch throttle tightens toward tip', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const at = (minAgo: number, tipInMin: number[]) => ({
    fetchedAt: new Date(now - minAgo * 60_000).toISOString(),
    tips: tipInMin.map((m) => new Date(now + m * 60_000).toISOString()),
  });
  assert.equal(rotowireFetchDue(null, now).due, true);
  assert.equal(rotowireFetchDue(at(10, [60]), now).due, true, 'inside 90 min: every run');
  assert.equal(rotowireFetchDue(at(10, [300]), now).due, false, 'within 12h: every 30 min');
  assert.equal(rotowireFetchDue(at(30, [300]), now).due, true);
  assert.equal(rotowireFetchDue(at(60, [-30, 20 * 60]), now).due, false, 'next tip far off: every 3h');
  assert.equal(rotowireFetchDue(at(180, []), now).due, true);
});

test('rotowire: log keeps a snapshot per change and nothing after tip', () => {
  const page = parseRotowireLineups(PAGE) as ReturnType<typeof parseRotowireLineups> & { date: string };
  const t0 = Date.parse('2026-10-20T20:00:00Z');
  const first = mergeRotowireDay(null, page, t0);
  assert.equal(first.changed, 4);
  const again = mergeRotowireDay(first.log, page, t0 + 30 * 60_000);
  assert.equal(again.changed, 0);
  assert.equal(again.log.games['BOS@DET']!.teams.BOS!.length, 1);
  assert.equal(again.log.games['BOS@DET']!.teams.BOS![0]!.seenAt, new Date(t0 + 30 * 60_000).toISOString());

  const swapped = structuredClone(page);
  swapped.games[0]!.away.starters[3] = { name: 'Sam Hauser', pos: 'PF', playPct: 100, tag: null };
  const later = mergeRotowireDay(again.log, swapped, t0 + 60 * 60_000);
  assert.equal(later.changed, 1);
  assert.equal(later.log.games['BOS@DET']!.teams.BOS!.length, 2);

  const afterTip = mergeRotowireDay(later.log, page, Date.parse('2026-10-20T23:05:00Z'));
  assert.equal(afterTip.log.games['BOS@DET']!.teams.BOS!.length, 2, 'BOS@DET tipped: not recorded');
  assert.equal(afterTip.changed, 0, 'late game unchanged');
});
