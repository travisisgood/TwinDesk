'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalize } = require('../settings');

test('new settings default to automatic dragging without enabling sharing', () => {
  const config = normalize({}).pcApps;
  assert.equal(config.moveKey, 'auto');
  assert.equal(config.moveWindows, false);
});

test('saved automatic and modifier preferences survive normalization', () => {
  for (const moveKey of ['auto', 'ControlRight', 'MetaLeft']) {
    const config = normalize({ pcApps: { moveWindows: true, moveKey } }).pcApps;
    assert.equal(config.moveKey, moveKey);
    assert.equal(config.moveWindows, true);
  }
  assert.equal(normalize({ pcApps: { moveKey: 'invalid' } }).pcApps.moveKey, 'auto');
});
