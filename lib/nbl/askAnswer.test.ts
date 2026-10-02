import assert from 'node:assert/strict';
import { nblQuestionIntent, answerNblAsk } from './askAnswer';
import { findNblEnginePanel, NBL_ASK_BEST_PLAY_STAT } from './enginePicks';

assert.equal(
  nblQuestionIntent('if you had to bet on this player what line are u taking and why'),
  'take'
);
assert.equal(
  nblQuestionIntent(
    'hey mate, i just need a quick bet for this player, what is the best line and market i should be looking into?'
  ),
  'take'
);
assert.equal(nblQuestionIntent("What's the best line on Waardenburg?"), 'best_line');
assert.equal(nblQuestionIntent("What's the model on Waardenburg vs Cairns?"), 'model');
assert.equal(
  nblQuestionIntent('if you had to pick a prop for this player who are u taking and why?'),
  'take'
);
assert.equal(
  nblQuestionIntent('what other markets would u look into?'),
  'other_markets'
);

async function main() {
  const panel = findNblEnginePanel({
    playerName: 'Sam Waardenburg',
    opponent: 'Cairns',
    stat: NBL_ASK_BEST_PLAY_STAT,
    now: new Date('2026-10-03T04:00:00+10:00'),
  });
  assert.ok(panel.pick, 'expected a best-play pick for Waardenburg');

  const screenshot = await answerNblAsk({
    question: 'if you had to pick a prop for this player who are u taking and why?',
    playerName: 'Sam Waardenburg',
    opponent: 'Cairns',
    stat: 'points',
    allowLlm: false,
  });
  assert.match(screenshot.answer, /I'd take /i);
  assert.doesNotMatch(screenshot.answer, /^\s*AVOID/i);
  assert.ok(screenshot.breakdown.length > 0, 'take needs a why');

  const quick = await answerNblAsk({
    question:
      'hey mate, i just need a quick bet for this player, what is the best line and market i should be looking into?',
    playerName: 'Sam Waardenburg',
    opponent: 'Cairns',
    stat: 'points',
    allowLlm: false,
  });
  assert.match(quick.answer, /I'd take /i);
  assert.match(quick.answer, /\bPRA\b|\bPR\b|\bPTS\b|\bREB\b|\bAST\b|\b3PM\b/i);
  assert.doesNotMatch(quick.answer, /^\s*Best over is \d/i);
  assert.doesNotMatch(quick.answer, /^\s*AVOID/i);

  const books = await answerNblAsk({
    question: "What's the best line on Waardenburg?",
    playerName: 'Sam Waardenburg',
    opponent: 'Cairns',
    stat: 'points',
    allowLlm: false,
  });
  assert.match(books.answer, /Best over PTS is/i);
  assert.equal(books.breakdown.length, 0);

  const others = await answerNblAsk({
    question: 'what other markets would u look into?',
    playerName: 'Sam Waardenburg',
    opponent: 'Cairns',
    stat: 'points',
    allowLlm: false,
  });
  assert.match(others.answer, /I'd look at /i);
  assert.doesNotMatch(others.answer, /^\s*(Model:\s*)?AVOID/i);
  assert.doesNotMatch(others.answer, /wouldn'?t force another market/i);
  assert.match(others.answer, /\bPRA\b|\bPR\b|\bREB\b|\bAST\b|\b3PM\b/i);
  assert.ok(others.breakdown.length > 0, 'other markets need a list');

  const mcveigh = await answerNblAsk({
    question:
      'hey mate, i just need a quick bet for this player, what is the best line and market i should be looking into?',
    playerName: 'Jack McVeigh',
    opponent: 'Melbourne',
    stat: 'points',
    allowLlm: false,
  });
  assert.match(mcveigh.answer, /under /i);
  assert.doesNotMatch(mcveigh.answer, /over 1\.5/i);
  assert.doesNotMatch(mcveigh.answer, /I'd take \S+ over/i);

  console.log('nbl ask take vs best_line ok');
  console.log('take:', screenshot.answer);
  console.log('why:', screenshot.breakdown.join(' | '));
  console.log('books:', books.answer);
  console.log('others:', others.answer);
  console.log('other why:', others.breakdown.join(' | '));
  console.log('mcveigh:', mcveigh.answer);
  console.log('mcveigh why:', mcveigh.breakdown.join(' | '));
  console.log('best play:', panel.pick?.stat_label, panel.pick?.side, panel.pick?.tier, panel.pick?.line);
}

main();
