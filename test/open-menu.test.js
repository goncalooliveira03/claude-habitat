const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MENU, launchers, openMenu } = require('../open-menu');

const MENU_PATH = 'C:\\Users\\me\\claude-habitat\\menu.js';

test('tries Windows Terminal first, then a plain console window', () => {
  const [wt, cmd] = launchers(MENU_PATH);
  assert.deepEqual(wt, { command: 'wt.exe', args: ['-w', '0', 'nt', '--title', 'claude-habitat', 'node', MENU_PATH], verbatim: false });
  assert.deepEqual(cmd, { command: 'cmd.exe', args: [`/c start "claude-habitat" cmd /k node "${MENU_PATH}"`], verbatim: true });
  assert.equal(MENU, path.join(__dirname, '..', 'menu.js'));
});

test('stops at the first launcher that works', () => {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, verbatim: options.windowsVerbatimArguments });
    return { status: 0 };
  };
  assert.match(openMenu(run, MENU_PATH), /Windows Terminal tab/);
  assert.deepEqual(calls, [{ command: 'wt.exe', verbatim: false }]);
});

test('falls back when wt.exe is missing and explains when nothing works', () => {
  const missingWt = (command) => (command === 'wt.exe' ? { error: new Error('ENOENT') } : { status: 0 });
  assert.match(openMenu(missingWt, MENU_PATH), /console window/);
  const nothing = () => ({ status: 1 });
  assert.equal(openMenu(nothing, MENU_PATH), `Could not open a terminal. Run this yourself: node "${MENU_PATH}"`);
});

test('the /habitat command runs open-menu.js with node pre-approved', () => {
  const command = fs.readFileSync(path.join(__dirname, '..', 'commands', 'habitat.md'), 'utf8');
  assert.match(command, /allowed-tools: Bash\(node \*\)/);
  assert.ok(command.includes('!`node "${CLAUDE_PLUGIN_ROOT}/open-menu.js"`'));
});
