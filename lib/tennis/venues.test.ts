import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tennisSurfaceLabel } from './venues';

test('surface label: hard courts at indoor events read Indoor Hard, outdoor hard stays Hard', () => {
  assert.equal(tennisSurfaceLabel('Hard', 'ATP Paris'), 'Indoor Hard');
  assert.equal(tennisSurfaceLabel('Hard', 'Rolex Paris Masters'), 'Indoor Hard');
  assert.equal(tennisSurfaceLabel('hard', 'Swiss Indoors Basel'), 'Indoor Hard');
  assert.equal(tennisSurfaceLabel('Hard', 'Vienna'), 'Indoor Hard');
  assert.equal(tennisSurfaceLabel('Hard', 'Shanghai'), 'Hard');
  assert.equal(tennisSurfaceLabel('Hard', 'WTA Guangzhou'), 'Hard', 'unknown venues are not assumed indoor');
  assert.equal(tennisSurfaceLabel('Hard', 'Courmayeur (Italy) - Qualification'), 'Indoor Hard');
  assert.equal(tennisSurfaceLabel('Hard', 'Sioux Falls'), 'Indoor Hard');
  assert.equal(tennisSurfaceLabel('Clay', 'Rome'), 'Clay');
  assert.equal(tennisSurfaceLabel('Indoor Hard', 'Basel'), 'Indoor Hard', 'already labelled');
  assert.equal(tennisSurfaceLabel('', 'Basel'), '');
});
