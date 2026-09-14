// Mascot files: validation, loading, frame choice, compositing and half-block encoding.
const fs = require('fs');
const path = require('path');
const { readJson } = require('./io');
const { STATES } = require('./state');

const SIZE = 20;
const MAX_COLORS = 16;
const HEX = /^#[0-9a-fA-F]{6}$/;
const ANCHORS = ['top', 'side', 'cheek'];
const RESET = '\x1b[0m';
const NBSP = '\u00a0';
const MASCOTS_DIR = path.join(__dirname, '..', 'mascots');

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

function paletteErrors(m) {
  const errors = [];
  const palette = asObject(m.palette);
  for (const [key, value] of Object.entries(palette)) {
    if (key.length !== 1) errors.push(`palette key "${key}" must be one character`);
    if (value !== null && !HEX.test(value)) errors.push(`palette "${key}" must be null or #rrggbb`);
  }
  if (Object.values(palette).filter((v) => v !== null).length > MAX_COLORS) errors.push(`at most ${MAX_COLORS} colors`);
  if (!Object.hasOwn(palette, m.bodyColor) || !palette[m.bodyColor]) errors.push('bodyColor must name a color in the palette');
  return errors;
}

function anchorErrors(m) {
  const anchors = asObject(m.anchors);
  const inside = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isInteger(n) && n >= 0 && n < SIZE);
  return ANCHORS.filter((name) => !inside(anchors[name])).map((name) => `anchors.${name} must be [x, y] inside the sprite`);
}

function frameErrors(m) {
  const errors = [];
  const palette = asObject(m.palette);
  for (const [name, rows] of Object.entries(asObject(m.frames))) {
    if (!Array.isArray(rows) || rows.length !== SIZE) {
      errors.push(`frame ${name} must have ${SIZE} rows`);
      continue;
    }
    rows.forEach((row, y) => {
      if (typeof row !== 'string' || [...row].length !== SIZE) return errors.push(`frame ${name} row ${y} must be ${SIZE} characters`);
      const unknown = [...row].find((ch) => !Object.hasOwn(palette, ch));
      if (unknown) errors.push(`frame ${name} row ${y} uses unknown color "${unknown}"`);
      return undefined;
    });
  }
  return errors;
}

function stateErrors(m) {
  const errors = [];
  const frames = asObject(m.frames);
  const states = asObject(m.states);
  if (!Array.isArray(states.idle) || states.idle.length === 0) errors.push('states.idle needs at least one frame');
  for (const [state, sequence] of Object.entries(states)) {
    if (!STATES.includes(state)) errors.push(`unknown state "${state}"`);
    if (!Array.isArray(sequence)) {
      errors.push(`states.${state} must be a list`);
      continue;
    }
    sequence.filter((f) => !Object.hasOwn(frames, f)).forEach((f) => errors.push(`states.${state} refers to missing frame "${f}"`));
  }
  return errors;
}

function validateMascot(m) {
  if (!m || typeof m !== 'object') return ['mascot is not an object'];
  const errors = [];
  if (typeof m.name !== 'string' || !m.name) errors.push('name must be a non-empty string');
  if (!Array.isArray(m.size) || m.size[0] !== SIZE || m.size[1] !== SIZE) errors.push(`size must be [${SIZE}, ${SIZE}]`);
  return [...errors, ...paletteErrors(m), ...anchorErrors(m), ...frameErrors(m), ...stateErrors(m)];
}

function loadMascot(name, dir = MASCOTS_DIR) {
  const mascot = readJson(path.join(dir, name, 'mascot.json'), null);
  return mascot && validateMascot(mascot).length === 0 ? mascot : null;
}

function listMascots(dir = MASCOTS_DIR) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && fs.existsSync(path.join(dir, entry.name, 'mascot.json')))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function loadAccessories(dir = MASCOTS_DIR) {
  const data = readJson(path.join(dir, '_accessories.json'), null);
  return { palette: asObject(data && data.palette), items: asObject(data && data.items) };
}

function frameFor(mascot, state, now) {
  const sequence = Array.isArray(mascot.states[state]) && mascot.states[state].length ? mascot.states[state] : mascot.states.idle;
  return mascot.frames[sequence[Math.floor(now / 1000) % sequence.length]];
}

const toColors = (rows, palette) => rows.map((row) => [...row].map((ch) => palette[ch] || null));

function overlay(colors, item, palette, [x, y]) {
  const out = colors.map((row) => [...row]);
  item.rows.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      const color = palette[ch];
      if (color && out[y + dy] && x + dx < out[y + dy].length) out[y + dy][x + dx] = color;
    });
  });
  return out;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function mixHex(a, b, t) {
  const [from, to] = [rgb(a), rgb(b)];
  return `#${from.map((c, i) => Math.round(c + (to[i] - c) * t).toString(16).padStart(2, '0')).join('')}`;
}

function tint(colors, fromHex, toHex, amount) {
  const target = fromHex.toLowerCase();
  return colors.map((row) => row.map((c) => (c && c.toLowerCase() === target ? mixHex(c, toHex, amount) : c)));
}

const fg = (hex) => `\x1b[38;2;${rgb(hex).join(';')}m`;
const bg = (hex) => `\x1b[48;2;${rgb(hex).join(';')}m`;

function cell(top, bottom) {
  if (!top && !bottom) return `${RESET}${NBSP}`;
  if (top && bottom) return top.toLowerCase() === bottom.toLowerCase() ? `${RESET}${fg(top)}█` : `${RESET}${fg(top)}${bg(bottom)}▀`;
  return top ? `${RESET}${fg(top)}▀` : `${RESET}${fg(bottom)}▄`;
}

function encodeRows(colors) {
  const rows = [];
  for (let y = 0; y < colors.length; y += 2) {
    const below = colors[y + 1] || [];
    rows.push(`${colors[y].map((top, x) => cell(top, below[x] || null)).join('')}${RESET}`);
  }
  return rows;
}

module.exports = {
  SIZE, MASCOTS_DIR, RESET, NBSP, validateMascot, loadMascot, listMascots, loadAccessories,
  frameFor, toColors, overlay, mixHex, tint, encodeRows,
};
