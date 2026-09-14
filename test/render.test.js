const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderStatusLine } = require('../render');
const input = require('./fixtures/status-input.json');

let home;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-render-'));
  process.env.CLAUDE_HABITAT_HOME = home;
});

const raw = JSON.stringify(input);

test('renders ten rows for a normal session', () => {
  assert.equal(renderStatusLine(raw, Date.now(), 100).split('\n').length, 10);
});

test('broken stdin prints one warning row and logs the error', () => {
  assert.equal(renderStatusLine('', Date.now(), 100), 'claude-habitat ! see render-error.log');
  assert.ok(fs.readFileSync(path.join(home, 'render-error.log'), 'utf8').length > 0);
  assert.equal(renderStatusLine('null', Date.now(), 100), 'claude-habitat ! see render-error.log');
});

test('unsafe session ids and unknown mascots still render', () => {
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ mascot: 'nope' }));
  const out = renderStatusLine(JSON.stringify({ ...input, session_id: '../../x' }), Date.now(), 100);
  assert.equal(out.split('\n').length, 10);
});

test('reads the session record written by the hook', () => {
  const now = Date.now();
  fs.mkdirSync(path.join(home, 'sessions'));
  fs.writeFileSync(path.join(home, 'sessions', 'test-session.json'), JSON.stringify({
    state: 'working', tool: 'Bash', target: 'npm test', subagents: 0, stateSince: now, updatedAt: now,
  }));
  assert.ok(renderStatusLine(raw, now, 100).includes('Bash npm test'));
});

test('an in-process render stays well under the frame budget', () => {
  const started = process.hrtime.bigint();
  for (let i = 0; i < 20; i += 1) renderStatusLine(raw, Date.now(), 100);
  const averageMs = Number(process.hrtime.bigint() - started) / 1e6 / 20;
  assert.ok(averageMs < 50, `average ${averageMs.toFixed(1)} ms`);
});
