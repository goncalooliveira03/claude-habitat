// Interactive settings menu: node menu.js (or /habitat inside Claude Code).
const readline = require('readline');
const { loadConfig, saveConfig } = require('./lib/config');
const { listMascots, loadMascot, loadAccessories } = require('./lib/sprites');
const { buildFrame } = require('./lib/frame');
const { settingsFile, readSettings, statusLineKind, turnOn, turnOff } = require('./lib/activation');
const { createModel, reduce, screenText, previewInput, previewRecord } = require('./lib/menu-model');
const { appendLog } = require('./lib/io');

const REDRAW_MS = 1000;
const MENU_WIDTH = 52;
const PREVIEW_COLUMNS = 70;
const ENTER_SCREEN = '\x1b[?1049h\x1b[?25l\x1b[2J';
const LEAVE_SCREEN = '\x1b[0m\x1b[?25h\x1b[?1049l';
const KEYS = { up: 'up', down: 'down', left: 'left', right: 'right', return: 'enter', escape: 'escape', y: 'y', n: 'n', q: 'q' };

function currentStatusLine() {
  try {
    return statusLineKind(readSettings(settingsFile()));
  } catch {
    return 'unreadable';
  }
}

function applyEffect(model, effect) {
  try {
    if (effect.type === 'save-config') {
      saveConfig(model.config);
      return model;
    }
    if (effect.type === 'turn-on') {
      const config = turnOn({ root: __dirname, config: model.config });
      saveConfig(config);
      return { ...model, config, statusLine: 'ours', message: 'Status line on. It appears after Claude\'s next message.' };
    }
    if (effect.type === 'turn-off') {
      const config = turnOff({ config: model.config });
      saveConfig(config);
      return { ...model, config, statusLine: currentStatusLine(), message: 'Status line off.' };
    }
  } catch (err) {
    appendLog('menu-error.log', err.stack || String(err));
    return { ...model, message: `Could not update settings: ${err.message}` };
  }
  return model;
}

function draw(model) {
  const now = Date.now();
  const mascot = loadMascot(model.config.mascot) || loadMascot('cat');
  const preview = mascot
    ? buildFrame({
      input: previewInput(model), record: previewRecord(model, now), config: model.config,
      mascot, accessories: loadAccessories(), now, columns: PREVIEW_COLUMNS,
    }).split('\n')
    : ['(no valid mascot found)'];
  const menu = screenText(model);
  const height = Math.max(menu.length, preview.length);
  const lines = Array.from({ length: height }, (_, i) => `${(menu[i] || '').padEnd(MENU_WIDTH)}${preview[i] || ''}\x1b[0m\x1b[K`);
  process.stdout.write(`\x1b[H${lines.join('\n')}\x1b[J`);
}

function main() {
  if (!process.stdin.isTTY) {
    process.stderr.write('Run the menu in a terminal: node menu.js\n');
    process.exit(1);
  }
  let model = createModel({ mascots: listMascots(), config: loadConfig(), statusLine: currentStatusLine() });
  let timer = null;
  const restore = () => {
    clearInterval(timer);
    process.stdin.setRawMode(false);
    process.stdout.write(LEAVE_SCREEN);
  };
  process.on('uncaughtException', (err) => {
    restore();
    appendLog('menu-error.log', err.stack || String(err));
    process.stderr.write(`claude-habitat menu crashed: ${err.message}\n`);
    process.exit(1);
  });

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdout.write(ENTER_SCREEN);
  process.stdin.on('keypress', (str, key = {}) => {
    const name = key.ctrl && key.name === 'c' ? 'q' : KEYS[key.name];
    if (!name) return;
    const result = reduce(model, name);
    let next = result.model;
    for (const effect of result.effects) {
      if (effect.type === 'quit') {
        restore();
        process.exit(0);
      }
      next = applyEffect(next, effect);
    }
    model = next;
    draw(model);
  });
  timer = setInterval(() => draw(model), REDRAW_MS);
  draw(model);
}

main();
