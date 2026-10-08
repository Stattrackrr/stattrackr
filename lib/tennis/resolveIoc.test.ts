import assert from 'node:assert/strict';
import test from 'node:test';
import { tennisIocFromStoredOrRoster } from './resolveIoc';

test('keeps a valid stored country', () => {
  assert.equal(
    tennisIocFromStoredOrRoster({ playerId: '1', name: 'Jannik Sinner', stored: 'ITA' }),
    'ITA'
  );
});

test('drops an unusable stored code so a roster lookup can fill it', () => {
  assert.equal(
    tennisIocFromStoredOrRoster({ playerId: '1', name: 'Jannik Sinner', stored: 'UNK' }),
    tennisIocFromStoredOrRoster({ playerId: '1', name: 'Jannik Sinner', stored: null })
  );
});
