const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const s = require('../lib/sprites');

const CORE_STATES = ['idle', 'thinking', 'working', 'success', 'error', 'attention'];
const ACCESSORIES = ['exclaim', 'alarm', 'zzz', 'sparkle', 'sweat', 'clone', 'hourglass'];
const readMascot = (name) => require(path.join(s.MASCOTS_DIR, name, 'mascot.json'));

test('every bundled mascot is valid and the cat is there', () => {
  const names = s.listMascots();
  assert.ok(names.includes('cat'));
  for (const name of names) assert.deepEqual(s.validateMascot(readMascot(name)), [], name);
});

test('every bundled mascot draws the core states', () => {
  for (const name of s.listMascots()) {
    const mascot = readMascot(name);
    for (const state of CORE_STATES) assert.ok(mascot.states[state] && mascot.states[state].length > 0, `${name}.${state}`);
  }
});

test('bundled mascots keep the accessory corner clear', () => {
  for (const name of s.listMascots()) {
    const mascot = readMascot(name);
    for (const [frame, rows] of Object.entries(mascot.frames)) {
      rows.slice(0, 13).forEach((row, y) => {
        [...row.slice(16)].forEach((ch, i) => assert.equal(mascot.palette[ch], null, `${name} ${frame} x${16 + i} y${y}`));
      });
    }
  }
});

test('the pack ships four mascots', () => {
  assert.deepEqual(s.listMascots(), ['cat', 'ghost', 'octopus', 'robot']);
});

test('the accessories file has every item the frame builder uses', () => {
  const { palette, items } = s.loadAccessories();
  for (const name of ACCESSORIES) {
    assert.ok(items[name], name);
    for (const row of items[name].rows) for (const ch of row) assert.ok(Object.hasOwn(palette, ch), `${name} uses "${ch}"`);
  }
});
