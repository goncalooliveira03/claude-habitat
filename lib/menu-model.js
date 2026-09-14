// Menu state and key handling as pure functions; menu.js does the terminal and file work.
const { STATES } = require('./state');

const ITEMS = ['mascot', 'preview', 'context', 'info.state', 'info.model', 'info.cost', 'statusLine', 'quit'];
const CONTEXT_LEVELS = [20, 65, 85, 95];
const LABEL_WIDTH = 24;
const LABELS = {
  mascot: 'Mascot', preview: 'Preview state', context: 'Preview context', 'info.state': 'Info: state',
  'info.model': 'Info: model + context', 'info.cost': 'Info: cost + limits', statusLine: 'Status line', quit: 'Quit',
};
const STATUS_TEXT = { ours: 'on', none: 'off', other: 'off (another status line is set)', unreadable: 'unknown' };
const CONFIRM_MESSAGE = 'Another status line is set. Replace it? It comes back when you turn this off. (y/n)';
const UNREADABLE_MESSAGE = 'Fix ~/.claude/settings.json first: it is not valid JSON.';
const HELP = ' up/down move   left/right change   enter toggle   q quit';

const createModel = ({ mascots, config, statusLine }) => ({
  cursor: 0, mascots, config, statusLine, previewIndex: 0, contextIndex: 0, confirm: false, message: '',
});

const wrap = (index, length) => ((index % length) + length) % length;
const none = (model) => ({ model, effects: [] });

function toggleStatusLine(model) {
  if (model.statusLine === 'ours') return { model, effects: [{ type: 'turn-off' }] };
  if (model.statusLine === 'none') return { model, effects: [{ type: 'turn-on' }] };
  if (model.statusLine === 'other') return none({ ...model, confirm: true, message: CONFIRM_MESSAGE });
  return none({ ...model, message: UNREADABLE_MESSAGE });
}

function change(model, item, step, isEnter) {
  if (item === 'mascot') {
    const index = Math.max(0, model.mascots.indexOf(model.config.mascot));
    const mascot = model.mascots[wrap(index + step, model.mascots.length || 1)] || model.config.mascot;
    return { model: { ...model, config: { ...model.config, mascot } }, effects: [{ type: 'save-config' }] };
  }
  if (item === 'preview') return none({ ...model, previewIndex: wrap(model.previewIndex + step, STATES.length) });
  if (item === 'context') return none({ ...model, contextIndex: wrap(model.contextIndex + step, CONTEXT_LEVELS.length) });
  if (item.startsWith('info.')) {
    const key = item.slice('info.'.length);
    const info = { ...model.config.info, [key]: !model.config.info[key] };
    return { model: { ...model, config: { ...model.config, info } }, effects: [{ type: 'save-config' }] };
  }
  if (item === 'statusLine') return toggleStatusLine(model);
  if (item === 'quit' && isEnter) return { model, effects: [{ type: 'quit' }] };
  return none(model);
}

function reduce(model, key) {
  if (key === 'q') return { model, effects: [{ type: 'quit' }] };
  if (model.confirm) {
    if (key === 'y') return { model: { ...model, confirm: false, message: '' }, effects: [{ type: 'turn-on' }] };
    if (key === 'n' || key === 'escape') return none({ ...model, confirm: false, message: 'Kept your current status line.' });
    return none(model);
  }
  if (key === 'up' || key === 'down') {
    return none({ ...model, cursor: wrap(model.cursor + (key === 'up' ? -1 : 1), ITEMS.length), message: '' });
  }
  if (key === 'left' || key === 'right' || key === 'enter') {
    return change(model, ITEMS[model.cursor], key === 'left' ? -1 : 1, key === 'enter');
  }
  return none(model);
}

function valueOf(model, item) {
  if (item === 'mascot') return `< ${model.config.mascot} >`;
  if (item === 'preview') return `< ${STATES[model.previewIndex]} >`;
  if (item === 'context') return `< ${CONTEXT_LEVELS[model.contextIndex]}% >`;
  if (item.startsWith('info.')) return model.config.info[item.slice('info.'.length)] ? '[x]' : '[ ]';
  if (item === 'statusLine') return STATUS_TEXT[model.statusLine];
  return '';
}

function screenText(model) {
  const rows = ITEMS.map((item, i) => `${i === model.cursor ? ' > ' : '   '}${LABELS[item].padEnd(LABEL_WIDTH)}${valueOf(model, item)}`);
  return [' claude-habitat', '', ...rows, '', ` ${model.message}`, HELP];
}

const previewInput = (model) => ({
  session_id: 'preview',
  model: { display_name: 'Opus 5' },
  context_window: { used_percentage: CONTEXT_LEVELS[model.contextIndex] },
  cost: { total_cost_usd: 0.84 },
  rate_limits: { five_hour: { used_percentage: 31 }, seven_day: { used_percentage: 12 } },
});

// stateSince = now keeps timed states (success, error, done) on screen while previewing.
const previewRecord = (model, now) => ({
  state: STATES[model.previewIndex], tool: 'Edit', target: 'render.js', subagents: 0, stateSince: now, updatedAt: now,
});

module.exports = { ITEMS, CONTEXT_LEVELS, createModel, reduce, screenText, previewInput, previewRecord };
