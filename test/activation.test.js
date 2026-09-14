const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const a = require('../lib/activation');
const { DEFAULT_CONFIG } = require('../lib/config');

const ROOT = 'C:\\Users\\me\\.claude\\plugins\\cache\\claude-habitat\\claude-habitat\\0.2.0';
const OLD_ROOT = 'C:/Users/me/.claude/plugins/cache/claude-habitat/claude-habitat/0.1.0';
let file;

beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-settings-')), 'settings.json');
});

const write = (value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

test('settingsFile follows CLAUDE_HABITAT_SETTINGS', () => {
  process.env.CLAUDE_HABITAT_SETTINGS = file;
  assert.equal(a.settingsFile(), file);
  delete process.env.CLAUDE_HABITAT_SETTINGS;
  assert.equal(a.settingsFile(), path.join(os.homedir(), '.claude', 'settings.json'));
});

test('ourCommand uses an unquoted node and forward slashes', () => {
  assert.equal(a.ourCommand(ROOT), 'node "C:/Users/me/.claude/plugins/cache/claude-habitat/claude-habitat/0.2.0/render.js"');
});

test('isOurs and statusLineKind tell our status line apart', () => {
  assert.equal(a.isOurs({ type: 'command', command: a.ourCommand(OLD_ROOT) }), true);
  assert.equal(a.isOurs({ type: 'command', command: 'node "C:/Dev/claude-habitat/render.js"' }), true);
  assert.equal(a.isOurs({ type: 'command', command: 'npx ccstatusline' }), false);
  assert.equal(a.isOurs(undefined), false);
  assert.equal(a.statusLineKind({}), 'none');
  assert.equal(a.statusLineKind({ statusLine: { type: 'command', command: 'npx ccstatusline' } }), 'other');
  assert.equal(a.statusLineKind(a.withStatusLine({}, ROOT)), 'ours');
});

test('withStatusLine sets a one-second refresh', () => {
  assert.deepEqual(a.withStatusLine({ theme: 'dark' }, ROOT), {
    theme: 'dark',
    statusLine: { type: 'command', command: a.ourCommand(ROOT), refreshInterval: 1 },
  });
});

test('fixStalePath rewrites only our outdated command', () => {
  const stale = { statusLine: { type: 'command', command: a.ourCommand(OLD_ROOT), refreshInterval: 1 } };
  assert.equal(a.fixStalePath(stale, ROOT).statusLine.command, a.ourCommand(ROOT));
  assert.equal(a.fixStalePath(a.withStatusLine({}, ROOT), ROOT), null);
  assert.equal(a.fixStalePath({ statusLine: { type: 'command', command: 'x' } }, ROOT), null);
});

test('turning on then off leaves the file byte-for-byte as before', () => {
  write({ theme: 'dark', hooks: {} });
  const before = fs.readFileSync(file, 'utf8');
  const on = a.turnOn({ file, root: ROOT, config: DEFAULT_CONFIG });
  assert.equal(a.statusLineKind(a.readSettings(file)), 'ours');
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), before);
  assert.equal(on.previousStatusLine, null);
  a.turnOff({ file, config: on });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('a status line that is not ours is kept and restored in place', () => {
  const foreign = { type: 'command', command: 'npx ccstatusline' };
  write({ statusLine: foreign, theme: 'dark' });
  const before = fs.readFileSync(file, 'utf8');
  const on = a.turnOn({ file, root: ROOT, config: DEFAULT_CONFIG });
  assert.deepEqual(on.previousStatusLine, foreign);
  const again = a.turnOn({ file, root: ROOT, config: on });
  assert.deepEqual(again.previousStatusLine, foreign);
  const off = a.turnOff({ file, config: again });
  assert.equal(off.previousStatusLine, null);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('turnOff leaves someone else\'s status line alone', () => {
  write({ statusLine: { type: 'command', command: 'npx ccstatusline' } });
  const before = fs.readFileSync(file, 'utf8');
  a.turnOff({ file, config: DEFAULT_CONFIG });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('a missing settings file is created, a corrupt one is never touched', () => {
  a.turnOn({ file, root: ROOT, config: DEFAULT_CONFIG });
  assert.equal(a.statusLineKind(a.readSettings(file)), 'ours');
  fs.writeFileSync(file, '{ broken');
  assert.throws(() => a.turnOn({ file, root: ROOT, config: DEFAULT_CONFIG }));
  assert.equal(fs.readFileSync(file, 'utf8'), '{ broken');
});

test('turnOn writes atomically: no leftover .tmp file remains', () => {
  write({ theme: 'dark' });
  a.turnOn({ file, root: ROOT, config: DEFAULT_CONFIG });
  const names = fs.readdirSync(path.dirname(file)).sort();
  assert.deepEqual(names, ['settings.json', 'settings.json.bak']);
});

test('repairStatusLine fixes a stale path and reports whether it wrote', () => {
  write({ statusLine: { type: 'command', command: a.ourCommand(OLD_ROOT), refreshInterval: 1 } });
  assert.equal(a.repairStatusLine({ file, root: ROOT }), true);
  assert.equal(a.readSettings(file).statusLine.command, a.ourCommand(ROOT));
  assert.equal(a.repairStatusLine({ file, root: ROOT }), false);
});
