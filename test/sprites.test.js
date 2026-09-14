const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const s = require('../lib/sprites');

const blank = () => Array.from({ length: 20 }, () => '.'.repeat(20));
const withPixel = (rows, x, y, ch) => rows.map((row, i) => (i === y ? row.slice(0, x) + ch + row.slice(x + 1) : row));

function makeMascot(overrides = {}) {
  return {
    name: 'Test',
    size: [20, 20],
    palette: { '.': null, o: '#f5a623', k: '#2b2d42' },
    bodyColor: 'o',
    anchors: { top: [16, 0], side: [16, 8], cheek: [13, 5] },
    frames: { a: withPixel(blank(), 0, 0, 'o'), b: withPixel(blank(), 1, 0, 'k') },
    states: { idle: ['a', 'b'], thinking: ['b'], working: [] },
    ...overrides,
  };
}

test('a well-formed mascot has no errors', () => {
  assert.deepEqual(s.validateMascot(makeMascot()), []);
});

test('validateMascot reports each kind of problem', () => {
  const has = (m, pattern) => assert.ok(s.validateMascot(m).some((e) => pattern.test(e)), pattern.toString());
  has(null, /not an object/);
  has(makeMascot({ size: [16, 16] }), /size must be \[20, 20\]/);
  has(makeMascot({ frames: { a: blank().slice(1) }, states: { idle: ['a'] } }), /frame a must have 20 rows/);
  has(makeMascot({ frames: { a: withPixel(blank(), 0, 0, 'z') }, states: { idle: ['a'] } }), /unknown color "z"/);
  has(makeMascot({ frames: { a: [...blank().slice(1), '...'] }, states: { idle: ['a'] } }), /row 19 must be 20 characters/);
  has(makeMascot({ states: { idle: ['missing'] } }), /missing frame "missing"/);
  has(makeMascot({ states: { thinking: ['a'] } }), /states.idle needs at least one frame/);
  has(makeMascot({ states: { idle: ['a'], dancing: ['a'] } }), /unknown state "dancing"/);
  has(makeMascot({ anchors: { top: [20, 0], side: [16, 8], cheek: [13, 5] } }), /anchors.top/);
  has(makeMascot({ bodyColor: 'x' }), /bodyColor/);
  has(makeMascot({ palette: { '.': null, o: 'orange', k: '#2b2d42' } }), /palette "o"/);
  const many = Object.fromEntries([['.', null], ...'abcdefghijklmnopq'.split('').map((c) => [c, '#000000'])]);
  has(makeMascot({ palette: { ...many, o: '#f5a623', k: '#2b2d42' } }), /at most 16 colors/);
});

test('loadMascot and listMascots read a mascots folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-mascots-'));
  fs.mkdirSync(path.join(dir, 'good'));
  fs.writeFileSync(path.join(dir, 'good', 'mascot.json'), JSON.stringify(makeMascot()));
  fs.mkdirSync(path.join(dir, 'bad'));
  fs.writeFileSync(path.join(dir, 'bad', 'mascot.json'), JSON.stringify(makeMascot({ size: [1, 1] })));
  fs.mkdirSync(path.join(dir, '_skip'));
  fs.writeFileSync(path.join(dir, '_accessories.json'), JSON.stringify({ palette: { r: '#ff0000' }, items: { dot: { rows: ['r'] } } }));
  assert.equal(s.loadMascot('good', dir).name, 'Test');
  assert.equal(s.loadMascot('bad', dir), null);
  assert.equal(s.loadMascot('nope', dir), null);
  assert.deepEqual(s.listMascots(dir), ['bad', 'good']);
  assert.deepEqual(s.loadAccessories(dir).items.dot.rows, ['r']);
  assert.deepEqual(s.loadAccessories(path.join(dir, 'none')), { palette: {}, items: {} });
});

test('frameFor cycles once per second and falls back to idle', () => {
  const m = makeMascot();
  assert.equal(s.frameFor(m, 'idle', 0), m.frames.a);
  assert.equal(s.frameFor(m, 'idle', 1000), m.frames.b);
  assert.equal(s.frameFor(m, 'idle', 2500), m.frames.a);
  assert.equal(s.frameFor(m, 'thinking', 5000), m.frames.b);
  assert.equal(s.frameFor(m, 'working', 0), m.frames.a);
  assert.equal(s.frameFor(m, 'error', 1000), m.frames.b);
});

test('toColors maps keys to hex or null', () => {
  const colors = s.toColors(withPixel(blank(), 2, 1, 'o'), makeMascot().palette);
  assert.equal(colors.length, 20);
  assert.equal(colors[1][2], '#f5a623');
  assert.equal(colors[0][0], null);
});

test('overlay draws opaque cells, clips at the edge and leaves the input untouched', () => {
  const base = s.toColors(blank(), {});
  const item = { rows: ['r.', 'rr'] };
  const out = s.overlay(base, item, { r: '#ff0000', '.': null }, [19, 18]);
  assert.equal(out[18][19], '#ff0000');
  assert.equal(out[19][19], '#ff0000');
  assert.equal(base[18][19], null);
  const beside = s.overlay(base, item, { r: '#ff0000' }, [0, 0]);
  assert.equal(beside[0][1], null);
  assert.equal(beside[1][1], '#ff0000');
});

test('mixHex and tint blend toward a color', () => {
  assert.equal(s.mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(s.mixHex('#ff0000', '#0000ff', 0), '#ff0000');
  const grid = [['#f5a623', '#2b2d42']];
  const tinted = s.tint(grid, '#F5A623', '#ff0000', 1);
  assert.deepEqual(tinted, [['#ff0000', '#2b2d42']]);
  assert.deepEqual(grid, [['#f5a623', '#2b2d42']]);
});

test('encodeRows handles the four cell cases and always starts with an escape', () => {
  const R = '\x1b[0m';
  const colors = [
    [null, '#ff0000', '#ff0000', null],
    [null, '#ff0000', '#0000ff', '#00ff00'],
  ];
  const [row] = s.encodeRows(colors);
  assert.equal(row, `${R}\u00a0${R}\x1b[38;2;255;0;0m█${R}\x1b[38;2;255;0;0m\x1b[48;2;0;0;255m▀${R}\x1b[38;2;0;255;0m▄${R}`);
  assert.equal(s.encodeRows([['#ff0000']])[0], `${R}\x1b[38;2;255;0;0m▀${R}`);
  assert.equal(s.encodeRows(s.toColors(blank(), {})).length, 10);
});
