// Data locations and small file helpers shared by every entry point.
// CLAUDE_HABITAT_HOME overrides the data folder (used by the tests).
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_LOG_BYTES = 100_000;
const SESSION_ID = /^[\w-]+$/;

const dataDir = () => process.env.CLAUDE_HABITAT_HOME || path.join(os.homedir(), '.claude', 'claude-habitat');
const sessionsDir = () => path.join(dataDir(), 'sessions');
const configFile = () => path.join(dataDir(), 'config.json');
// The id becomes a file name, so anything but word characters and dashes is refused.
const sessionFile = (id) => (SESSION_ID.test(id || '') ? path.join(sessionsDir(), `${id}.json`) : null);

function parseJson(text) {
  // Windows PowerShell 5.1 prefixes piped text with a UTF-8 BOM, which JSON.parse rejects.
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

function readJson(file, fallback) {
  try {
    return parseJson(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Write to a temp file and rename, so readers never see half a file.
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function appendLog(name, text) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const file = path.join(dataDir(), name);
    const line = `${new Date().toISOString()} ${text}\n`;
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    // ponytail: start over past the cap instead of rotating; old errors are rarely useful.
    if (size > MAX_LOG_BYTES) fs.writeFileSync(file, line);
    else fs.appendFileSync(file, line);
  } catch {
    // Nowhere left to report.
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { raw += chunk; });
    process.stdin.on('end', () => resolve(raw));
  });
}

module.exports = {
  MAX_LOG_BYTES, dataDir, sessionsDir, configFile, sessionFile, parseJson, readJson, writeJsonAtomic, appendLog, readStdin,
};
