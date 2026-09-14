// Status line entry: Claude Code runs this with session JSON on stdin, on events and every second.
const { readStdin, parseJson, readJson, sessionFile, appendLog } = require('./lib/io');
const { loadConfig } = require('./lib/config');
const { loadMascot, loadAccessories } = require('./lib/sprites');
const { buildFrame } = require('./lib/frame');

const DEFAULT_COLUMNS = 80;
const FALLBACK_MASCOT = 'cat';
const WARNING = 'claude-habitat ! see render-error.log';

function renderStatusLine(raw, now = Date.now(), columns = Number.parseInt(process.env.COLUMNS, 10) || DEFAULT_COLUMNS) {
  try {
    const input = parseJson(raw);
    const file = sessionFile(input.session_id);
    const config = loadConfig();
    const mascot = loadMascot(config.mascot) || loadMascot(FALLBACK_MASCOT);
    if (!mascot) throw new Error('no valid mascot found');
    const record = file ? readJson(file, null) : null;
    return buildFrame({ input, record, config, mascot, accessories: loadAccessories(), now, columns });
  } catch (err) {
    // Never show a stack trace in the status line.
    appendLog('render-error.log', err && err.stack ? err.stack : String(err));
    return WARNING;
  }
}

if (require.main === module) {
  readStdin().then((raw) => process.stdout.write(`${renderStatusLine(raw)}\n`));
}

module.exports = { renderStatusLine };
