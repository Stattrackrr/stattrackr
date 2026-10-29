import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NbaGameOdds } from '@/lib/nba/dash/oddsTypes';
import { gameLines, impliedTeamTotal } from './lines';
import { CLOSE_MS, dueKinds } from './schedule';

const H = 60 * 60 * 1000;
const TIP = Date.parse('2026-10-30T23:00:00Z');

const ra = (line: string, over: string, under: string) => ({ RA: [{ line, over, under }] });

const odds: NbaGameOdds = {
  gameId: 'g1',
  homeTeam: 'Philadelphia 76ers',
  awayTeam: 'Boston Celtics',
  commenceTime: new Date(TIP).toISOString(),
  bookmakers: [],
  playerProps: {
    draftkings: { 'VJ Edgecombe': ra('8.5', '+102', '-125'), 'Unknown Guy': { PTS: [{ line: '10.5', over: '-110', under: '-110' }] } },
    caesars: { 'VJ Edgecombe': ra('8.5', '+150', '-190') },
    fanduel: { 'VJ Edgecombe': ra('8.5', '-105', '-115'), 'Unknown Guy': { PTS: [{ line: '10.5', over: '-115', under: '-105' }] } },
    sportsbet: { 'VJ Edgecombe': ra('8.5', '+102', '-125') },
    pinnacle: { 'VJ Edgecombe': ra('8.5', '-110', '-110') },
    tab: { 'VJ Edgecombe': ra('9.5', '+130', '-160') },
    betr: { 'VJ Edgecombe': { RA: [{ line: '10', over: '+170', under: 'N/A', milestone: true }] } },
  },
  propBookTimes: { sportsbet: '2026-10-30T20:01:00.000Z', draftkings: '2026-10-30T20:03:00.000Z' },
};

test('prop log: every board player and stat at its main line, unmatched names kept', () => {
  const lines = gameLines(odds, [{ id: 'p1', name: 'VJ Edgecombe', teamCode: 'PHI' }]);
  const vj = lines.find((l) => l.player?.id === 'p1' && l.stat === 'ra')!;
  assert.equal(vj.mainLine, 8.5, 'the line most books are on');
  assert.equal(vj.nBooks, 5, 'two-way books at the main line: DraftKings, FanDuel, Caesars, Sportsbet, Pinnacle');
  assert.deepEqual(vj.bestAuOver, { price: 2.02, book: 'sportsbet' });
  assert.equal(vj.fairOverPinnacle, 0.5);
  assert.ok(vj.fairOverUs! > 0.45 && vj.fairOverUs! < 0.5, 'US fair is DraftKings and FanDuel only; Caesars at 0.38 would drag it down');
  assert.ok(vj.fairOverAu != null && vj.fairOverAll != null && vj.fairOverAllMult != null);
  const tab = vj.quotes.find((q) => q.book === 'tab')!;
  assert.equal(tab.line, 9.5, 'a book off the main line is logged at its own line');
  assert.equal(vj.quotes.some((q) => q.book === 'betr'), false, 'a milestone above the main line is not a main-line quote');
  assert.equal(vj.quotes.find((q) => q.book === 'sportsbet')!.sourceTs, '2026-10-30T20:01:00.000Z');
  assert.equal(vj.quotes.find((q) => q.book === 'fanduel')!.sourceTs, null, 'no source time is stored as unknown, not guessed');
  const unknown = lines.find((l) => l.boardName === 'Unknown Guy')!;
  assert.equal(unknown.player, null, 'unmatched names are logged, not dropped');
  assert.equal(unknown.stat, 'points');
});

test('prop log: snapshot schedule', () => {
  const at = (msBeforeTip: number) => new Date(TIP - msBeforeTip).toISOString();
  assert.deepEqual(dueKinds([], TIP, TIP - 10 * H), ['first']);
  const early = [{ id: 'a', kind: 'first' as const, capturedAt: at(10 * H) }];
  assert.deepEqual(dueKinds(early, TIP, TIP - 5 * H), ['t6h']);
  const late = [{ id: 'a', kind: 'first' as const, capturedAt: at(5 * H) }];
  assert.deepEqual(dueKinds(late, TIP, TIP - 4 * H), [], 'first seen inside 6h: no separate 6h snapshot');
  assert.deepEqual(dueKinds(late, TIP, TIP - 1.5 * H), ['t2h']);
  assert.deepEqual(dueKinds([], TIP, TIP - 1 * H), ['first', 't2h'], 'the 2h decision snapshot is always taken');
  const all = [...early, { id: 'b', kind: 't6h' as const, capturedAt: at(5 * H) }, { id: 'c', kind: 't2h' as const, capturedAt: at(H) }];
  assert.deepEqual(dueKinds(all, TIP, TIP - CLOSE_MS + 60_000), ['close']);
  assert.deepEqual(dueKinds(all, TIP, TIP + 60_000), [], 'nothing after tip');
});

test('prop log: implied team total from the market spread and total', () => {
  const market = { homeSpread: -6, total: 220 };
  assert.equal(impliedTeamTotal(market, true), 113);
  assert.equal(impliedTeamTotal(market, false), 107);
  assert.equal(impliedTeamTotal({ homeSpread: null, total: 220 }, true), null);
});
