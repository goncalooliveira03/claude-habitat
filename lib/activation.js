// Turns our status line on and off in ~/.claude/settings.json. A plugin cannot set the main
// statusLine itself, so this edits the user's settings, keeping a .bak and any status line it replaced.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseJson } = require('./io');

const REFRESH_SECONDS = 1;

const settingsFile = () => process.env.CLAUDE_HABITAT_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
// Unquoted node plus forward slashes: the command may run in Git Bash (eats backslashes) or PowerShell
// (a quoted first token is a string, not a command).
const ourCommand = (root) => `node "${root.replace(/\\/g, '/')}/render.js"`;

const isOurs = (statusLine) => Boolean(
  statusLine && typeof statusLine.command === 'string'
  && /claude-habitat/.test(statusLine.command) && /render\.js"?\s*$/.test(statusLine.command),
);

function statusLineKind(settings) {
  if (!settings.statusLine) return 'none';
  return isOurs(settings.statusLine) ? 'ours' : 'other';
}

const withStatusLine = (settings, root) => ({
  ...settings,
  statusLine: { type: 'command', command: ourCommand(root), refreshInterval: REFRESH_SECONDS },
});

function withoutStatusLine(settings, previous) {
  if (previous) return { ...settings, statusLine: previous };
  const { statusLine, ...rest } = settings;
  return rest;
}

function fixStalePath(settings, root) {
  if (!isOurs(settings.statusLine) || settings.statusLine.command === ourCommand(root)) return null;
  return { ...settings, statusLine: { ...settings.statusLine, command: ourCommand(root) } };
}

// Throws on invalid JSON on purpose: never overwrite a settings file we could not read.
const readSettings = (file) => (fs.existsSync(file) ? parseJson(fs.readFileSync(file, 'utf8')) : {});

function writeSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

function turnOn({ file = settingsFile(), root, config }) {
  const settings = readSettings(file);
  const kind = statusLineKind(settings);
  const previousStatusLine = kind === 'other' ? settings.statusLine : kind === 'ours' ? config.previousStatusLine : null;
  writeSettings(file, withStatusLine(settings, root));
  return { ...config, previousStatusLine };
}

function turnOff({ file = settingsFile(), config }) {
  const settings = readSettings(file);
  if (statusLineKind(settings) !== 'ours') return config;
  writeSettings(file, withoutStatusLine(settings, config.previousStatusLine));
  return { ...config, previousStatusLine: null };
}

function repairStatusLine({ file = settingsFile(), root }) {
  const fixed = fixStalePath(readSettings(file), root);
  if (!fixed) return false;
  writeSettings(file, fixed);
  return true;
}

module.exports = {
  settingsFile, ourCommand, isOurs, statusLineKind, withStatusLine, withoutStatusLine, fixStalePath,
  readSettings, writeSettings, turnOn, turnOff, repairStatusLine,
};
