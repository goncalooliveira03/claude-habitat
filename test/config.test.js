const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

beforeEach(() => {
  process.env.CLAUDE_HABITAT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-config-'));
});

const { DEFAULT_CONFIG, normalizeConfig, loadConfig, saveConfig } = require('../lib/config');

test('normalizeConfig fills defaults for garbage input', () => {
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ mascot: 42, info: 'x' }), DEFAULT_CONFIG);
});

test('normalizeConfig keeps valid values and rejects unsafe mascot names', () => {
  const config = normalizeConfig({ mascot: 'robot', info: { cost: false }, previousStatusLine: { type: 'command', command: 'x' } });
  assert.equal(config.mascot, 'robot');
  assert.deepEqual(config.info, { state: true, model: true, cost: false });
  assert.deepEqual(config.previousStatusLine, { type: 'command', command: 'x' });
  assert.equal(normalizeConfig({ mascot: '../../etc' }).mascot, 'cat');
});

test('saveConfig then loadConfig round-trips', () => {
  saveConfig({ ...DEFAULT_CONFIG, mascot: 'ghost' });
  assert.equal(loadConfig().mascot, 'ghost');
});

test('loadConfig logs and falls back when config.json is corrupt', () => {
  fs.writeFileSync(path.join(process.env.CLAUDE_HABITAT_HOME, 'config.json'), '{oops');
  assert.deepEqual(loadConfig(), DEFAULT_CONFIG);
  const log = fs.readFileSync(path.join(process.env.CLAUDE_HABITAT_HOME, 'render-error.log'), 'utf8');
  assert.match(log, /config\.json is not valid JSON/);
});
