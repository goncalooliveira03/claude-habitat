const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

beforeEach(() => {
  process.env.CLAUDE_HABITAT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-io-'));
});

const io = require('../lib/io');

test('dataDir follows CLAUDE_HABITAT_HOME', () => {
  assert.equal(io.dataDir(), process.env.CLAUDE_HABITAT_HOME);
  assert.equal(io.sessionsDir(), path.join(process.env.CLAUDE_HABITAT_HOME, 'sessions'));
  assert.equal(io.configFile(), path.join(process.env.CLAUDE_HABITAT_HOME, 'config.json'));
});

test('sessionFile rejects ids that are not safe file names', () => {
  assert.equal(io.sessionFile('abc-123_x'), path.join(io.sessionsDir(), 'abc-123_x.json'));
  assert.equal(io.sessionFile('../evil'), null);
  assert.equal(io.sessionFile(''), null);
  assert.equal(io.sessionFile(undefined), null);
});

test('parseJson strips a UTF-8 BOM', () => {
  assert.deepEqual(io.parseJson('\uFEFF{"a":1}'), { a: 1 });
});

test('readJson returns the fallback for missing or corrupt files', () => {
  const file = path.join(io.dataDir(), 'x.json');
  assert.deepEqual(io.readJson(file, { d: 1 }), { d: 1 });
  fs.writeFileSync(file, '{not json');
  assert.equal(io.readJson(file, null), null);
});

test('writeJsonAtomic round-trips and leaves no temp file', () => {
  const file = path.join(io.dataDir(), 'deep', 'value.json');
  io.writeJsonAtomic(file, { ok: true });
  assert.deepEqual(io.readJson(file, null), { ok: true });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['value.json']);
});

test('readStdin resolves with what was read so far if the stream errors', async () => {
  const { PassThrough } = require('stream');
  const stream = new PassThrough();
  const promise = io.readStdin(stream);
  stream.write('{"a":');
  stream.emit('error', new Error('boom'));
  assert.equal(await promise, '{"a":');
});

test('readStdin resolves with the full input on a normal end', async () => {
  const { PassThrough } = require('stream');
  const stream = new PassThrough();
  const promise = io.readStdin(stream);
  stream.write('abc');
  stream.end();
  assert.equal(await promise, 'abc');
});

test('appendLog starts over once the log passes the cap', () => {
  const file = path.join(io.dataDir(), 'test.log');
  fs.writeFileSync(file, 'x'.repeat(io.MAX_LOG_BYTES + 1));
  io.appendLog('test.log', 'fresh');
  const content = fs.readFileSync(file, 'utf8');
  assert.ok(content.endsWith(' fresh\n'));
  assert.ok(content.length < 100);
});
