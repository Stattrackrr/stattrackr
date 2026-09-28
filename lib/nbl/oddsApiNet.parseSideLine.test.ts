import assert from 'node:assert/strict';
import { parseNblOddsApiNetSideLine } from './oddsApiNet';

function check(
  item: { line?: string | number; side?: string; selection_name?: string },
  expected: { side: 'over' | 'under'; value: number } | null
) {
  assert.deepEqual(parseNblOddsApiNetSideLine(item), expected);
}

// Current odds-api.net contract: numeric line + separate side.
check({ line: '24.5', side: 'over' }, { side: 'over', value: 24.5 });
check({ line: 24.5, side: 'under' }, { side: 'under', value: 24.5 });
check({ line: '20', side: 'over' }, { side: 'over', value: 20 });

// Milestone threshold in line field.
check({ line: '20+', side: 'over' }, { side: 'over', value: 20 });
check({ line: '20+' }, { side: 'over', value: 20 });

// Legacy inline Over/Under in line.
check({ line: 'Over 19.5' }, { side: 'over', value: 19.5 });
check({ line: 'Under 6.5' }, { side: 'under', value: 6.5 });

// Selection-name fallback.
check(
  { selection_name: 'Over 20.5', side: 'over' },
  { side: 'over', value: 20.5 }
);
check({ selection_name: 'Player 15+ points' }, { side: 'over', value: 15 });

// Numeric line alone → over (milestone-style).
check({ line: '19.5' }, { side: 'over', value: 19.5 });

console.log('parseNblOddsApiNetSideLine ok');
