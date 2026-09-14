const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { handleHook, pruneSessions, STALE_SESSION_MS } = require('../hook');
const { EVENTS } = require('../lib/state');
const { ourCommand } = require('../lib/activation');

const T = 1_700_000_000_000;
const ROOT = 'C:/Dev/claude-habitat-next';
let home;
let settings;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-hook-'));
  process.env.CLAUDE_HABITAT_HOME = home;
  settings = path.join(home, 'settings.json');
  process.env.CLAUDE_HABITAT_SETTINGS = settings;
});

const sessionPath = (id) => path.join(home, 'sessions', `${id}.json`);
const read = (id) => JSON.parse(fs.readFileSync(sessionPath(id), 'utf8'));

test('hooks.json registers every event as an async node hook', () => {
  const { hooks } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(hooks).sort(), [...EVENTS].sort());
  for (const event of EVENTS) {
    assert.deepEqual(hooks[event], [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hook.js'], async: true }] }]);
  }
});

test('plugin.json does not list the standard hooks file, which Claude Code already loads', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.hooks, undefined);
});

test('writes the session record for an event', () => {
  handleHook({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } }, T);
  assert.equal(read('s1').state, 'working');
  assert.equal(read('s1').target, 'npm test');
});

test('ignores unsafe session ids', () => {
  handleHook({ session_id: '../../boom', hook_event_name: 'Stop' }, T);
  assert.equal(fs.existsSync(path.join(home, 'sessions')), false);
});

test('an older hook finishing late does not overwrite a newer one', () => {
  handleHook({ session_id: 's1', hook_event_name: 'UserPromptSubmit' }, T + 100);
  handleHook({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Read' }, T);
  assert.equal(read('s1').state, 'thinking');
});

test('SessionEnd deletes the record', () => {
  handleHook({ session_id: 's1', hook_event_name: 'SessionStart' }, T);
  handleHook({ session_id: 's1', hook_event_name: 'SessionEnd' }, T + 1);
  assert.equal(fs.existsSync(sessionPath('s1')), false);
});

test('pruneSessions removes records older than a week', () => {
  handleHook({ session_id: 'old', hook_event_name: 'SessionStart' }, T);
  handleHook({ session_id: 'new', hook_event_name: 'SessionStart' }, T);
  const weekAgo = (Date.now() - STALE_SESSION_MS - 60_000) / 1000;
  fs.utimesSync(sessionPath('old'), weekAgo, weekAgo);
  pruneSessions(Date.now());
  assert.equal(fs.existsSync(sessionPath('old')), false);
  assert.equal(fs.existsSync(sessionPath('new')), true);
});

test('SessionStart repairs a stale status line path', () => {
  fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: ourCommand('C:/old/claude-habitat'), refreshInterval: 1 } }));
  handleHook({ session_id: 's1', hook_event_name: 'SessionStart' }, T, ROOT);
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).statusLine.command, ourCommand(ROOT));
});

test('a corrupt settings file does not stop the state from being written', () => {
  fs.writeFileSync(settings, '{ broken');
  handleHook({ session_id: 's1', hook_event_name: 'SessionStart' }, T, ROOT);
  assert.equal(read('s1').state, 'idle');
  assert.match(fs.readFileSync(path.join(home, 'hook-error.log'), 'utf8'), /settings/);
});

test('the script exits 0 and logs when stdin is garbage', () => {
  execFileSync(process.execPath, [path.join(__dirname, '..', 'hook.js')], { input: 'not json', env: process.env });
  assert.ok(fs.readFileSync(path.join(home, 'hook-error.log'), 'utf8').length > 0);
});
