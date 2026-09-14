const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../lib/menu-model');
const { DEFAULT_CONFIG } = require('../lib/config');
const { STATES } = require('../lib/state');

const make = (overrides = {}) => ({
  ...m.createModel({ mascots: ['cat', 'ghost', 'octopus', 'robot'], config: DEFAULT_CONFIG, statusLine: 'none' }),
  ...overrides,
});
const at = (item, overrides = {}) => make({ cursor: m.ITEMS.indexOf(item), ...overrides });
const press = (model, ...keys) => keys.reduce((acc, key) => {
  const { model: next, effects } = m.reduce(acc.model, key);
  return { model: next, effects: [...acc.effects, ...effects] };
}, { model, effects: [] });

test('cursor wraps around both ends', () => {
  assert.equal(press(make(), 'up').model.cursor, m.ITEMS.length - 1);
  assert.equal(press(make(), 'down', 'down').model.cursor, 2);
  assert.equal(press(at('quit'), 'down').model.cursor, 0);
});

test('mascot cycles and saves', () => {
  const right = press(at('mascot'), 'right');
  assert.equal(right.model.config.mascot, 'ghost');
  assert.deepEqual(right.effects, [{ type: 'save-config' }]);
  assert.equal(press(at('mascot'), 'left').model.config.mascot, 'robot');
  const unknown = at('mascot', { config: { ...DEFAULT_CONFIG, mascot: 'gone' } });
  assert.equal(press(unknown, 'enter').model.config.mascot, 'ghost');
});

test('preview state and context level cycle without saving', () => {
  const preview = press(at('preview'), 'left');
  assert.equal(preview.model.previewIndex, STATES.length - 1);
  assert.deepEqual(preview.effects, []);
  assert.equal(press(at('context'), 'right', 'right').model.contextIndex, 2);
});

test('info toggles flip and save', () => {
  const { model, effects } = press(at('info.cost'), 'enter');
  assert.equal(model.config.info.cost, false);
  assert.equal(model.config.info.state, true);
  assert.deepEqual(effects, [{ type: 'save-config' }]);
});

test('status line toggles on and off', () => {
  assert.deepEqual(press(at('statusLine'), 'enter').effects, [{ type: 'turn-on' }]);
  assert.deepEqual(press(at('statusLine', { statusLine: 'ours' }), 'enter').effects, [{ type: 'turn-off' }]);
  const unreadable = press(at('statusLine', { statusLine: 'unreadable' }), 'enter');
  assert.deepEqual(unreadable.effects, []);
  assert.match(unreadable.model.message, /settings\.json/);
});

test('replacing another status line asks first', () => {
  const asked = press(at('statusLine', { statusLine: 'other' }), 'enter');
  assert.equal(asked.model.confirm, true);
  assert.deepEqual(asked.effects, []);
  assert.deepEqual(press(asked.model, 'down').model.cursor, asked.model.cursor);
  assert.deepEqual(press(asked.model, 'y').effects, [{ type: 'turn-on' }]);
  const declined = press(asked.model, 'n');
  assert.equal(declined.model.confirm, false);
  assert.deepEqual(declined.effects, []);
});

test('q quits from anywhere and enter quits on the quit item', () => {
  assert.deepEqual(press(make(), 'q').effects, [{ type: 'quit' }]);
  assert.deepEqual(press(at('quit'), 'enter').effects, [{ type: 'quit' }]);
  assert.deepEqual(press(at('quit'), 'right').effects, []);
});

test('screenText marks the cursor and shows values', () => {
  const lines = m.screenText(at('mascot', { statusLine: 'ours', message: 'Hello' }));
  assert.ok(lines.some((line) => line.startsWith(' > Mascot') && line.includes('< cat >')));
  assert.ok(lines.some((line) => line.includes('Status line') && line.includes('on')));
  assert.ok(lines.some((line) => line.includes('[x]')));
  assert.ok(lines.includes(' Hello'));
});

test('preview input and record follow the chosen state and context', () => {
  const model = make({ previewIndex: STATES.indexOf('error'), contextIndex: 3 });
  assert.equal(m.previewInput(model).context_window.used_percentage, 95);
  const record = m.previewRecord(model, 123);
  assert.equal(record.state, 'error');
  assert.equal(record.stateSince, 123);
});
