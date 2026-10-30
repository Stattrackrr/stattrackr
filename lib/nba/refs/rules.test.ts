import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crewEffect, parseAssignments, refTendencies, REF_SHRINK_GAMES, teamFromLabel, type OfficiatedGame } from './rules';

const PAGE = `
<header class="entry-header"><h1 class="entry-title">NBA Referee Assignments</h1>            <div class="entry-meta">October 30, 2026</div></header>
<div class="nba-refs-content"><table class="table"><thead><tr><th>Game</th><th>Crew Chief</th><th>Referee</th><th>Umpire</th><th>Alternate</th></tr></thead>
<tbody>
  <tr>
    <td>Charlotte @ Washington</td>
    <td>  <a href="x.pdf" target="_blank">
          James Capers (#19)        </a>   </td>
    <td><a href="y.pdf">Sean Corbin (#33)</a></td>
    <td><a href="z.pdf">Brandon Schwab (#49)</a></td>
    <td></td>
  </tr>
  <tr><td>L.A. Lakers @ LA Clippers</td><td>Marc Davis (#8)</td><td>Ed Malloy (#7)</td><td>Biniam Maru (#94)</td><td>Someone Else (#1)</td></tr>
</tbody></table></div>`;

test('assignments page: date, teams from city names, crew without the alternate', () => {
  const r = parseAssignments(PAGE);
  assert.equal(r.date, '2026-10-30');
  assert.deepEqual(r.games, [
    { away: 'CHA', home: 'WAS', officials: ['James Capers', 'Sean Corbin', 'Brandon Schwab'] },
    { away: 'LAL', home: 'LAC', officials: ['Marc Davis', 'Ed Malloy', 'Biniam Maru'] },
  ]);
  assert.equal(teamFromLabel('Golden State'), 'GSW');
  assert.equal(teamFromLabel('New Orleans'), 'NOP');
  assert.equal(teamFromLabel('Utah'), 'UTA');
});

test('tendencies: a whistle-happy official shows extra free throws, shrunk by games worked; only earlier games count', () => {
  const games: OfficiatedGame[] = [];
  for (let i = 0; i < 60; i += 1) {
    const heavy = i % 2 === 0;
    games.push({ gameId: `g${i}`, date: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}`, officials: [heavy ? 'Heavy' : 'Light', 'Mid A', 'Mid B'], fta: heavy ? 50 : 40, fouls: heavy ? 44 : 38, points: 225 });
  }
  const { byOfficial } = refTendencies(games, '2026-12-31');
  const heavy = byOfficial.get('Heavy')!;
  assert.equal(heavy.games, 30);
  assert.ok(Math.abs(heavy.fta - (30 * 5) / (30 + REF_SHRINK_GAMES)) < 1e-9);
  assert.ok(byOfficial.get('Light')!.fta < 0);
  assert.ok(Math.abs(byOfficial.get('Mid A')!.fta) < 1e-9);
  const crew = crewEffect(['Heavy', 'Mid A', 'Unknown'], byOfficial);
  assert.ok(Math.abs(crew.fta - heavy.fta / 3) < 1e-9);
  assert.equal(refTendencies(games, '2026-11-01').byOfficial.size, 0);
});
