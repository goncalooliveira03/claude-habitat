const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildFrame } = require('../lib/frame');
const { loadMascot, loadAccessories } = require('../lib/sprites');
const { DEFAULT_CONFIG } = require('../lib/config');
const { visibleLength } = require('../lib/info');
const input = require('./fixtures/status-input.json');

const T = 5_000_000;
const mascot = loadMascot('cat');
const accessories = loadAccessories();
const record = (state, extra = {}) => ({ state, tool: 'Edit', target: 'render.js', subagents: 0, stateSince: T, updatedAt: T, ...extra });
const build = (overrides = {}) => buildFrame({
  input, record: record('working'), config: DEFAULT_CONFIG, mascot, accessories, now: T, columns: 100, ...overrides,
}).split('\n');

test('builds 10 rows that each start with an escape code', () => {
  const rows = build();
  assert.equal(rows.length, 10);
  for (const row of rows) assert.ok(row.startsWith('\x1b[0m'));
});

test('centers the three info rows beside the mascot', () => {
  const rows = build();
  assert.ok(rows[3].includes('Edit render.js'));
  assert.ok(rows[4].includes('Opus 5'));
  assert.ok(rows[5].includes('$0.84'));
  assert.equal(visibleLength(rows[0]), 20);
});

test('no row is wider than the terminal', () => {
  const long = { ...input, model: { display_name: 'A very long model name that keeps going and going' } };
  for (const row of build({ input: long, columns: 80 })) assert.ok(visibleLength(row) <= 80, row);
});

test('narrow terminals get only the state text', () => {
  const rows = build({ columns: 50 });
  const text = rows.filter((row) => visibleLength(row) > 20);
  assert.equal(text.length, 1);
  assert.ok(text[0].includes('Edit render.js'));
});

test('context panic tints the body and raises the alarm', () => {
  const calm = build({ record: record('thinking') }).join('\n');
  const panic = build({ record: record('thinking'), input: { ...input, context_window: { used_percentage: 95 } } }).join('\n');
  assert.notEqual(calm, panic);
  assert.ok(!calm.includes('255;95;87'));
  assert.ok(panic.includes('255;95;87'));
});

test('subagents bring the clone and sleeping brings zzz', () => {
  assert.ok(build({ record: record('thinking', { subagents: 1 }) }).join('\n').includes('255;255;255'));
  assert.ok(!build({ record: record('thinking') }).join('\n').includes('255;255;255'));
  const asleep = build({ record: record('idle', { updatedAt: T - 11 * 60 * 1000, stateSince: T - 11 * 60 * 1000 }) });
  assert.ok(asleep.join('\n').includes('125;184;255'));
});
