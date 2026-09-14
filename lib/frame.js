// Builds the full status line: decorated mascot on the left, info rows centered on the right.
const { resolveState } = require('./state');
const { frameFor, toColors, overlay, tint, encodeRows } = require('./sprites');
const { infoRows, stateText, truncate, num } = require('./info');

const SPRITE_COLUMNS = 20;
const GAP = 2;
const NARROW_COLUMNS = 60;
const MOODS = [
  { min: 90, tintTo: '#ff3b30', amount: 0.6, item: 'alarm', anchor: 'top' },
  { min: 80, tintTo: '#ff8c00', amount: 0.35, item: 'sweat', anchor: 'cheek' },
  { min: 60, tintTo: null, amount: 0, item: 'sweat', anchor: 'cheek' },
];
const TOP_ITEM = { attention: 'exclaim', sleeping: 'zzz', compacting: 'zzz', success: 'sparkle', done: 'sparkle' };
const LIMIT_WARNING = 90;

function decorate({ mascot, accessories, resolved, contextPct, fiveHourPct, now }) {
  const place = (grid, name, anchor) => {
    const item = accessories.items[name];
    return item ? overlay(grid, item, accessories.palette, mascot.anchors[anchor]) : grid;
  };
  let grid = toColors(frameFor(mascot, resolved.state, now), mascot.palette);
  const mood = MOODS.find((m) => contextPct >= m.min);
  if (mood && mood.tintTo) grid = tint(grid, mascot.palette[mascot.bodyColor], mood.tintTo, mood.amount);
  if (mood) grid = place(grid, mood.item, mood.anchor);
  if (TOP_ITEM[resolved.state]) grid = place(grid, TOP_ITEM[resolved.state], 'top');
  if (resolved.subagents > 0) grid = place(grid, 'clone', 'side');
  else if (fiveHourPct > LIMIT_WARNING) grid = place(grid, 'hourglass', 'side');
  return grid;
}

function buildFrame({ input, record, config, mascot, accessories, now, columns }) {
  const resolved = resolveState(record, now);
  const limits = input.rate_limits || {};
  const grid = decorate({
    mascot,
    accessories,
    resolved,
    now,
    contextPct: num(input.context_window && input.context_window.used_percentage) ?? 0,
    fiveHourPct: num(limits.five_hour && limits.five_hour.used_percentage) ?? 0,
  });
  const sprite = encodeRows(grid);
  const text = columns < NARROW_COLUMNS ? [stateText(resolved)] : infoRows(input, resolved, config);
  const width = columns - SPRITE_COLUMNS - GAP;
  const start = Math.max(0, Math.floor((sprite.length - text.length) / 2));
  return sprite
    .map((row, i) => {
      const line = text[i - start];
      return line ? `${row}${' '.repeat(GAP)}${truncate(line, width)}` : row;
    })
    .join('\n');
}

module.exports = { SPRITE_COLUMNS, GAP, NARROW_COLUMNS, buildFrame };
