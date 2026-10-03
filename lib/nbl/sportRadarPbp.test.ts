import assert from 'node:assert/strict';
import { parseNblPbpPoints } from './sportRadarPbp';

const fixture = {
  data: {
    fixture: {
      competitors: [
        { name: 'Tasmania JackJumpers', code: 'TAS', entityId: 'tas', isHome: true },
        { name: 'Melbourne United', code: 'MEL', entityId: 'mel', isHome: false },
      ],
    },
    pbp: {
      '1': {
        events: [
          { eventType: 'foul', eventSubType: 'personal', name: 'Josh Bannan', personId: 'jb', entityId: 'tas', periodId: 1 },
          { eventType: 'foul', eventSubType: 'drawn', name: 'Josh Bannan', personId: 'jb', entityId: 'tas', periodId: 1 },
          { eventType: 'foul', eventSubType: 'offensive', name: 'Josh Bannan', personId: 'jb', entityId: 'tas', periodId: 1 },
          { eventType: 'foul', eventSubType: 'categoryOneTechnical', name: 'Josh Bannan', personId: 'jb', entityId: 'tas', periodId: 1 },
          { eventType: 'foul', eventSubType: 'categoryTwoTechnical', name: 'Josh Bannan', personId: 'jb', entityId: 'tas', periodId: 1 },
          { eventType: '2pt', eventSubType: 'layup', name: 'Josh Bannan', personId: 'jb', entityId: 'tas', periodId: 1, success: true },
        ],
      },
    },
  },
};

const parsed = parseNblPbpPoints('test-fixture', fixture);
assert.ok(parsed);
const bannan = parsed.players.find((p) => p.name === 'Josh Bannan');
assert.ok(bannan);
assert.equal(bannan.fouls, 4);
assert.equal(bannan.total, 2);

console.log('sportRadarPbp fouls ok');
