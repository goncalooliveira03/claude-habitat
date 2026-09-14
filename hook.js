// Claude Code hook: records the session's state for render.js. Registered with "async": true.
const fs = require('fs');
const path = require('path');
const { readStdin, parseJson, readJson, writeJsonAtomic, sessionFile, sessionsDir, appendLog } = require('./lib/io');
const { applyEvent } = require('./lib/state');
const { repairStatusLine } = require('./lib/activation');

const STALE_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

// Sessions that crashed never send SessionEnd; drop their records after a week.
function pruneSessions(now) {
  let names = [];
  try {
    names = fs.readdirSync(sessionsDir());
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(sessionsDir(), name);
    try {
      if (now - fs.statSync(file).mtimeMs > STALE_SESSION_MS) fs.rmSync(file, { force: true });
    } catch {
      // Removed by another session in the meantime.
    }
  }
}

function onSessionStart(now, root) {
  pruneSessions(now);
  try {
    // Plugin updates move the plugin folder; point our status line at the current one.
    repairStatusLine({ root });
  } catch (err) {
    appendLog('hook-error.log', `could not check settings.json: ${err.message}`);
  }
}

function handleHook(input, now, root = __dirname) {
  const file = sessionFile(input && input.session_id);
  if (!file) return;
  if (input.hook_event_name === 'SessionEnd') {
    fs.rmSync(file, { force: true });
    return;
  }
  if (input.hook_event_name === 'SessionStart') onSessionStart(now, root);
  const prev = readJson(file, null);
  // ponytail: async hooks may finish out of order, so the newest spawn wins; the tiny read→write race is accepted.
  if (prev && prev.updatedAt > now) return;
  writeJsonAtomic(file, applyEvent(prev, input, now));
}

if (require.main === module) {
  const spawnedAt = Date.now();
  readStdin().then((raw) => {
    try {
      handleHook(parseJson(raw), spawnedAt);
    } catch (err) {
      // Never disturb Claude Code: log and exit cleanly.
      appendLog('hook-error.log', err && err.stack ? err.stack : String(err));
    }
  });
}

module.exports = { STALE_SESSION_MS, pruneSessions, handleHook };
