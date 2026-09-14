// Text rows shown beside the mascot. No emoji: a row wider than the terminal drops every row after it.
const ANSI = /(\x1b\[[0-9;]*m)/;
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BAR_CELLS = 10;
const SEP = ` ${DIM}·${RESET} `;

const STATE_TEXT = {
  idle: 'idle', thinking: 'thinking…', working: 'working', success: 'done that', error: 'a tool failed',
  attention: 'needs you', compacting: 'compacting…', done: 'all done', sleeping: 'sleeping',
};

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const visibleLength = (text) => [...text.replace(new RegExp(ANSI.source, 'g'), '')].length;

function truncate(text, width) {
  if (width <= 0) return '';
  if (visibleLength(text) <= width) return text;
  let out = '';
  let seen = 0;
  for (const part of text.split(ANSI)) {
    if (ANSI.test(part)) {
      out += part;
      continue;
    }
    for (const ch of part) {
      if (seen >= width - 1) break;
      out += ch;
      seen += 1;
    }
  }
  return `${out}…${RESET}`;
}

function stateText({ state, tool, target }) {
  if (state === 'working' && tool) return target ? `${tool} ${target}` : tool;
  return STATE_TEXT[state] || STATE_TEXT.idle;
}

function contextBar(percent) {
  const filled = Math.min(BAR_CELLS, Math.max(0, Math.round(percent / 10)));
  return '▓'.repeat(filled) + '░'.repeat(BAR_CELLS - filled);
}

function modelRow(input) {
  const name = (input.model && input.model.display_name) || 'Claude';
  const pct = num(input.context_window && input.context_window.used_percentage) ?? 0;
  const color = pct >= 90 ? RED : pct >= 60 ? YELLOW : '';
  return `${name}${SEP}ctx ${color}${contextBar(pct)} ${Math.round(pct)}%${RESET}`;
}

function costRow(input) {
  const limits = input.rate_limits || {};
  const cost = num(input.cost && input.cost.total_cost_usd);
  const fiveHour = num(limits.five_hour && limits.five_hour.used_percentage);
  const week = num(limits.seven_day && limits.seven_day.used_percentage);
  const parts = [];
  if (cost !== null) parts.push(`$${cost.toFixed(2)}`);
  if (fiveHour !== null) parts.push(`${fiveHour > 90 ? YELLOW : ''}5h ${Math.round(fiveHour)}%${RESET}`);
  if (week !== null) parts.push(`week ${Math.round(week)}%`);
  return parts.length ? parts.join(SEP) : null;
}

function infoRows(input, resolved, config) {
  const rows = [];
  if (config.info.state) rows.push(`${BOLD}${stateText(resolved)}${RESET}`);
  if (config.info.model) rows.push(modelRow(input));
  const cost = config.info.cost ? costRow(input) : null;
  if (cost) rows.push(cost);
  return rows;
}

module.exports = { num, visibleLength, truncate, stateText, contextBar, infoRows };
