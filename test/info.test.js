const { test } = require('node:test');
const assert = require('node:assert/strict');
const info = require('../lib/info');
const { DEFAULT_CONFIG } = require('../lib/config');
const input = require('./fixtures/status-input.json');

const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');
const working = { state: 'working', tool: 'Edit', target: 'render.js', subagents: 0 };

test('visibleLength ignores color codes', () => {
  assert.equal(info.visibleLength('\x1b[1mhello\x1b[0m'), 5);
});

test('truncate keeps short text and cuts long text to the width', () => {
  assert.equal(info.truncate('short', 10), 'short');
  const cut = info.truncate('\x1b[33mabcdefghijkl\x1b[0m', 6);
  assert.equal(info.visibleLength(cut), 6);
  assert.equal(plain(cut), 'abcde…');
  assert.ok(cut.startsWith('\x1b[33m'));
  assert.equal(info.truncate('anything', 0), '');
});

test('stateText names the tool while working', () => {
  assert.equal(info.stateText(working), 'Edit render.js');
  assert.equal(info.stateText({ state: 'working', tool: null, target: null }), 'working');
  assert.equal(info.stateText({ state: 'attention' }), 'needs you');
});

test('contextBar fills one cell per 10% and clamps', () => {
  assert.equal(info.contextBar(42), '▓▓▓▓░░░░░░');
  assert.equal(info.contextBar(-5), '░░░░░░░░░░');
  assert.equal(info.contextBar(150), '▓▓▓▓▓▓▓▓▓▓');
});

test('infoRows builds the three rows from the status input', () => {
  const rows = info.infoRows(input, working, DEFAULT_CONFIG).map(plain);
  assert.deepEqual(rows, ['Edit render.js', 'Opus 5 · ctx ▓▓▓▓░░░░░░ 42%', '$0.84 · 5h 31% · week 12%']);
});

test('infoRows respects the toggles and missing data', () => {
  const noCost = { ...DEFAULT_CONFIG, info: { state: true, model: false, cost: false } };
  assert.deepEqual(info.infoRows(input, working, noCost).map(plain), ['Edit render.js']);
  const bare = { session_id: 'x' };
  assert.deepEqual(info.infoRows(bare, working, DEFAULT_CONFIG).map(plain), ['Edit render.js', 'Claude · ctx ░░░░░░░░░░ 0%']);
  const costOnly = { cost: { total_cost_usd: 1.5 } };
  assert.equal(plain(info.infoRows(costOnly, working, DEFAULT_CONFIG)[2]), '$1.50');
});

test('infoRows warns with color near the limits', () => {
  const hot = { ...input, context_window: { used_percentage: 95 }, rate_limits: { five_hour: { used_percentage: 93 } } };
  const [, model, cost] = info.infoRows(hot, working, DEFAULT_CONFIG);
  assert.ok(model.includes('\x1b[31m'));
  assert.ok(cost.includes('\x1b[33m5h 93%'));
  assert.equal(info.num('7'), null);
  assert.equal(info.num(Number.NaN), null);
});
