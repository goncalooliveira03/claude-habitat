# claude-habitat Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin that draws a 20×20 pixel-art mascot in the status line, reacting to session events, with a terminal menu to pick the mascot and turn the status line on or off.

**Architecture:** Async hooks write one state file per session. Claude Code runs `render.js` every second (`refreshInterval: 1`); it combines the status line JSON, the session state and the config into half-block pixel rows plus info rows. All logic sits in pure functions under `lib/`; `hook.js`, `render.js`, `menu.js` and `open-menu.js` are thin entry points.

**Tech Stack:** Node.js 20+ (CommonJS, stdlib only), `node:test`, Windows Terminal.

**Spec:** `docs/superpowers/specs/2026-09-13-claude-habitat-phase1-design.md`

## Global Constraints

- Node.js 20 or newer; no npm dependencies; CommonJS (`require`).
- Windows only for Phase 1.
- Sprite size exactly 20×20 pixels → 20 columns × 10 terminal rows; at most 16 colors per mascot plus `.` (transparent).
- Data folder: `~/.claude/claude-habitat/` (override with env `CLAUDE_HABITAT_HOME`, used by tests).
- `statusLine` command format: `node "<plugin root with forward slashes>/render.js"`, with `"refreshInterval": 1`. First token must not be quoted (the command may run in Git Bash or PowerShell); paths must use `/`.
- Terminal width comes from env `COLUMNS` (set by Claude Code); default 80.
- Info rows are truncated to `COLUMNS - 22`; below 60 columns only the mascot and the state text row are shown.
- Every status line row starts with an ANSI escape (`\x1b[0m`) so Claude Code cannot trim leading transparent cells.
- Info rows contain no emoji (their terminal width is unreliable and a too-wide row drops every row after it).
- `render.js` and `hook.js` never throw and always exit 0; errors go to `render-error.log` / `hook-error.log`, capped at 100 KB.
- All user-facing text in the plugin, README and commits is English, plain prose.
- Commits: conventional format (`feat:`, `test:`, `docs:` …), no `Co-Authored-By` trailer.
- Tests: `node --test` from the repo root; coverage `node --test --experimental-test-coverage`, target ≥80% lines on `lib/`.

## File Structure

```
claude-habitat/
├─ .claude-plugin/plugin.json        plugin manifest (name, version, hooks path)
├─ .claude-plugin/marketplace.json   single-plugin marketplace for /plugin install
├─ hooks/hooks.json                  every session event → node hook.js (async)
├─ commands/habitat.md               /habitat → runs open-menu.js
├─ lib/io.js                         data paths, JSON read/atomic write, capped logs, stdin
├─ lib/config.js                     defaults, normalize, load/save config.json
├─ lib/state.js                      event → session record; record + time → visible state
├─ lib/sprites.js                    mascot validation/loading, frames, overlay, tint, half-block encoding
├─ lib/info.js                       ANSI-aware width/truncate, state text, info rows
├─ lib/frame.js                      builds the whole status line string
├─ lib/activation.js                 settings.json statusLine on/off/restore/stale-path fix
├─ lib/menu-model.js                 pure menu state + key reducer + screen text
├─ mascots/_accessories.json         shared overlays (exclaim, alarm, zzz, sparkle, sweat, clone, hourglass)
├─ mascots/cat/mascot.json           default mascot
├─ mascots/octopus|robot|ghost/mascot.json
├─ hook.js                           hook entry
├─ render.js                         status line entry
├─ menu.js                           interactive menu entry
├─ open-menu.js                      opens menu.js in a new Windows Terminal tab
├─ test/*.test.js                    node:test suites
└─ README.md
```

Note: the spec lists a single `test.js`; the suites are split into `test/*.test.js` so no test file grows past a few hundred lines. `node --test` runs them all.

---

### Task 1: Plugin scaffold, file helpers and config

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `lib/io.js`, `lib/config.js`
- Test: `test/io.test.js`, `test/config.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `lib/io.js`: `dataDir(): string`, `sessionsDir(): string`, `configFile(): string`, `sessionFile(id: string): string|null` (null when `id` fails `/^[\w-]+$/`), `parseJson(text: string): any` (strips UTF-8 BOM), `readJson(file: string, fallback: any): any`, `writeJsonAtomic(file: string, value: any): void`, `appendLog(name: string, text: string): void`, `readStdin(): Promise<string>`, `MAX_LOG_BYTES = 100000`.
  - `lib/config.js`: `DEFAULT_CONFIG` (`{ mascot: 'cat', info: { state: true, model: true, cost: true }, previousStatusLine: null }`), `normalizeConfig(raw: any): Config`, `loadConfig(): Config`, `saveConfig(config: Config): void`.

- [ ] **Step 1: Create the plugin manifests**

`.claude-plugin/plugin.json`:
```json
{
  "name": "claude-habitat",
  "version": "0.1.0",
  "description": "A pixel-art mascot in your Claude Code status line that reacts to what Claude is doing. Windows only.",
  "author": {
    "name": "goncalooliveira03",
    "url": "https://github.com/goncalooliveira03"
  },
  "homepage": "https://github.com/goncalooliveira03/claude-habitat",
  "repository": "https://github.com/goncalooliveira03/claude-habitat",
  "license": "MIT",
  "keywords": ["statusline", "mascot", "pixel-art", "windows"],
  "hooks": "./hooks/hooks.json"
}
```

`.claude-plugin/marketplace.json`:
```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "claude-habitat",
  "description": "A pixel-art mascot for the Claude Code status line.",
  "owner": {
    "name": "goncalooliveira03",
    "url": "https://github.com/goncalooliveira03"
  },
  "plugins": [
    {
      "name": "claude-habitat",
      "description": "A pixel-art mascot in the status line that reacts to Claude's work. Windows only.",
      "source": "./",
      "category": "productivity"
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`test/io.test.js`:
```js
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
  assert.deepEqual(io.parseJson('﻿{"a":1}'), { a: 1 });
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

test('appendLog starts over once the log passes the cap', () => {
  const file = path.join(io.dataDir(), 'test.log');
  fs.writeFileSync(file, 'x'.repeat(io.MAX_LOG_BYTES + 1));
  io.appendLog('test.log', 'fresh');
  const content = fs.readFileSync(file, 'utf8');
  assert.ok(content.endsWith(' fresh\n'));
  assert.ok(content.length < 100);
});
```

`test/config.test.js`:
```js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

beforeEach(() => {
  process.env.CLAUDE_HABITAT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-config-'));
});

const { DEFAULT_CONFIG, normalizeConfig, loadConfig, saveConfig } = require('../lib/config');

test('normalizeConfig fills defaults for garbage input', () => {
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ mascot: 42, info: 'x' }), DEFAULT_CONFIG);
});

test('normalizeConfig keeps valid values and rejects unsafe mascot names', () => {
  const config = normalizeConfig({ mascot: 'robot', info: { cost: false }, previousStatusLine: { type: 'command', command: 'x' } });
  assert.equal(config.mascot, 'robot');
  assert.deepEqual(config.info, { state: true, model: true, cost: false });
  assert.deepEqual(config.previousStatusLine, { type: 'command', command: 'x' });
  assert.equal(normalizeConfig({ mascot: '../../etc' }).mascot, 'cat');
});

test('saveConfig then loadConfig round-trips', () => {
  saveConfig({ ...DEFAULT_CONFIG, mascot: 'ghost' });
  assert.equal(loadConfig().mascot, 'ghost');
});

test('loadConfig logs and falls back when config.json is corrupt', () => {
  fs.writeFileSync(path.join(process.env.CLAUDE_HABITAT_HOME, 'config.json'), '{oops');
  assert.deepEqual(loadConfig(), DEFAULT_CONFIG);
  const log = fs.readFileSync(path.join(process.env.CLAUDE_HABITAT_HOME, 'render-error.log'), 'utf8');
  assert.match(log, /config\.json is not valid JSON/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test`
Expected: FAIL with `Cannot find module '../lib/io'` and `'../lib/config'`.

- [ ] **Step 4: Implement `lib/io.js`**

```js
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
```

- [ ] **Step 5: Implement `lib/config.js`**

```js
// User settings for the plugin, stored in <data>/config.json.
const fs = require('fs');
const { configFile, readJson, writeJsonAtomic, appendLog } = require('./io');

const DEFAULT_CONFIG = Object.freeze({
  mascot: 'cat',
  info: Object.freeze({ state: true, model: true, cost: true }),
  previousStatusLine: null,
});

function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const info = src.info && typeof src.info === 'object' ? src.info : {};
  const flag = (key) => (typeof info[key] === 'boolean' ? info[key] : DEFAULT_CONFIG.info[key]);
  return {
    // The name becomes a folder under mascots/, so only lowercase letters, digits and dashes.
    mascot: typeof src.mascot === 'string' && /^[a-z0-9-]+$/.test(src.mascot) ? src.mascot : DEFAULT_CONFIG.mascot,
    info: { state: flag('state'), model: flag('model'), cost: flag('cost') },
    previousStatusLine: src.previousStatusLine && typeof src.previousStatusLine === 'object' ? src.previousStatusLine : null,
  };
}

function loadConfig() {
  const raw = readJson(configFile(), undefined);
  if (raw === undefined && fs.existsSync(configFile())) {
    appendLog('render-error.log', 'config.json is not valid JSON; using defaults');
  }
  return normalizeConfig(raw);
}

const saveConfig = (config) => writeJsonAtomic(configFile(), normalizeConfig(config));

module.exports = { DEFAULT_CONFIG, normalizeConfig, loadConfig, saveConfig };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test`
Expected: PASS, `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add .claude-plugin lib/io.js lib/config.js test/io.test.js test/config.test.js
git commit -m "feat: add plugin manifests, file helpers and config"
```

---

### Task 2: Session state machine

**Files:**
- Create: `lib/state.js`
- Test: `test/state.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (`lib/state.js`):
  - `EVENTS: string[]`: the 13 hook events the plugin registers.
  - `STATES: string[]`: `['idle','thinking','working','success','error','attention','compacting','done','sleeping']`.
  - `TIMED = { success: 2000, error: 3000, done: 5000 }`, `SLEEP_AFTER_MS = 600000`.
  - `applyEvent(prev: Record|null, input: HookInput, now: number): Record|null`. Returns `null` for `SessionEnd` (caller deletes the file).
  - `resolveState(record: Record|null, now: number): { state: string, tool: string|null, target: string|null, subagents: number }`.
  - `Record = { state, tool, target, subagents, stateSince, updatedAt }` (times in ms).

Rules (from the spec's state table):
- Event → state: `SessionStart`/`PostCompact` → idle, `UserPromptSubmit` → thinking, `PreToolUse` → working, `PostToolUse` → success, `PostToolUseFailure` → error, `PermissionRequest` → attention, `Notification` with `notification_type` `permission_prompt` or `idle_prompt` → attention (other types change nothing), `Stop` → done, `PreCompact` → compacting. `SubagentStart`/`SubagentStop` only move the counter (floor 0).
- Priority `attention 1, error 2, compacting 3, success 4, done 5, working 6, thinking 7, sleeping 8, idle 9`: while a timed state (success/error/done) is still inside its duration, an incoming state with a larger priority number is ignored. That way a parallel batch where one tool fails keeps showing the error for 3 s.
- Timed states expire into: success → thinking, error → thinking, done → idle. Idle with no event for 10 minutes shows as sleeping.

- [ ] **Step 1: Write the failing tests**

`test/state.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EVENTS, STATES, applyEvent, resolveState, SLEEP_AFTER_MS } = require('../lib/state');

const T = 1_000_000;
const ev = (hook_event_name, extra = {}) => ({ hook_event_name, ...extra });

test('EVENTS and STATES are complete', () => {
  assert.equal(EVENTS.length, 13);
  assert.ok(EVENTS.includes('PostToolUseFailure') && EVENTS.includes('SessionEnd'));
  assert.equal(STATES.length, 9);
});

test('each event maps to its state', () => {
  const cases = [
    ['SessionStart', 'idle'], ['UserPromptSubmit', 'thinking'], ['PreToolUse', 'working'],
    ['PostToolUse', 'success'], ['PostToolUseFailure', 'error'], ['PermissionRequest', 'attention'],
    ['Stop', 'done'], ['PreCompact', 'compacting'], ['PostCompact', 'idle'],
  ];
  for (const [event, state] of cases) {
    assert.equal(applyEvent(null, ev(event), T).state, state, event);
  }
});

test('notifications only matter when they ask for the user', () => {
  assert.equal(applyEvent(null, ev('Notification', { notification_type: 'permission_prompt' }), T).state, 'attention');
  assert.equal(applyEvent(null, ev('Notification', { notification_type: 'idle_prompt' }), T).state, 'attention');
  const thinking = applyEvent(null, ev('UserPromptSubmit'), T);
  assert.equal(applyEvent(thinking, ev('Notification', { notification_type: 'auth_success' }), T + 10).state, 'thinking');
});

test('SessionEnd returns null', () => {
  assert.equal(applyEvent(applyEvent(null, ev('SessionStart'), T), ev('SessionEnd'), T + 1), null);
});

test('PreToolUse records the tool and a short target', () => {
  const edit = applyEvent(null, ev('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'C:\\Dev\\x\\render.js' } }), T);
  assert.equal(edit.tool, 'Edit');
  assert.equal(edit.target, 'render.js');
  const bash = applyEvent(null, ev('PreToolUse', { tool_name: 'Bash', tool_input: { command: `git   status\n${'x'.repeat(80)}` } }), T);
  assert.equal(bash.target.length, 40);
  assert.ok(bash.target.startsWith('git status '));
  assert.ok(bash.target.endsWith('…'));
});

test('subagent counter never goes below zero and keeps the state', () => {
  let r = applyEvent(null, ev('UserPromptSubmit'), T);
  r = applyEvent(r, ev('SubagentStart'), T + 1);
  r = applyEvent(r, ev('SubagentStart'), T + 2);
  assert.equal(r.subagents, 2);
  assert.equal(r.state, 'thinking');
  r = applyEvent(r, ev('SubagentStop'), T + 3);
  r = applyEvent(r, ev('SubagentStop'), T + 4);
  r = applyEvent(r, ev('SubagentStop'), T + 5);
  assert.equal(r.subagents, 0);
});

test('a showing error is not replaced by a lower-priority success', () => {
  const failed = applyEvent(null, ev('PostToolUseFailure'), T);
  assert.equal(applyEvent(failed, ev('PostToolUse'), T + 500).state, 'error');
  assert.equal(applyEvent(failed, ev('PostToolUse'), T + 3000).state, 'success');
});

test('attention replaces a showing timed state because it has priority', () => {
  const ok = applyEvent(null, ev('PostToolUse'), T);
  assert.equal(applyEvent(ok, ev('PermissionRequest'), T + 100).state, 'attention');
});

test('stateSince restarts when the state is set again', () => {
  const first = applyEvent(null, ev('PostToolUse'), T);
  const again = applyEvent(first, ev('PostToolUse'), T + 1500);
  assert.equal(again.stateSince, T + 1500);
});

test('resolveState expires timed states', () => {
  const ok = applyEvent(null, ev('PostToolUse'), T);
  assert.equal(resolveState(ok, T + 1999).state, 'success');
  assert.equal(resolveState(ok, T + 2000).state, 'thinking');
  const failed = applyEvent(null, ev('PostToolUseFailure'), T);
  assert.equal(resolveState(failed, T + 2999).state, 'error');
  assert.equal(resolveState(failed, T + 3000).state, 'thinking');
  const done = applyEvent(null, ev('Stop'), T);
  assert.equal(resolveState(done, T + 4999).state, 'done');
  assert.equal(resolveState(done, T + 5000).state, 'idle');
});

test('resolveState falls asleep after 10 idle minutes', () => {
  const idle = applyEvent(null, ev('SessionStart'), T);
  assert.equal(resolveState(idle, T + SLEEP_AFTER_MS - 1).state, 'idle');
  assert.equal(resolveState(idle, T + SLEEP_AFTER_MS).state, 'sleeping');
  const working = applyEvent(null, ev('PreToolUse', { tool_name: 'Bash' }), T);
  assert.equal(resolveState(working, T + SLEEP_AFTER_MS * 2).state, 'working');
});

test('resolveState tolerates missing or corrupt records', () => {
  assert.deepEqual(resolveState(null, T), { state: 'idle', tool: null, target: null, subagents: 0 });
  assert.equal(resolveState({ state: 'bogus' }, T).state, 'idle');
  assert.equal(resolveState({ state: 'sleeping', updatedAt: T, stateSince: T }, T).state, 'sleeping');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/state.test.js`
Expected: FAIL with `Cannot find module '../lib/state'`.

- [ ] **Step 3: Implement `lib/state.js`**

```js
// Session state: hook events become a stored record; the record plus the clock gives what the mascot shows.
const path = require('path');

const EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest',
  'Notification', 'Stop', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'SessionEnd',
];
const STATES = ['idle', 'thinking', 'working', 'success', 'error', 'attention', 'compacting', 'done', 'sleeping'];
// Lower number wins while a timed state is still showing.
const PRIORITY = { attention: 1, error: 2, compacting: 3, success: 4, done: 5, working: 6, thinking: 7, sleeping: 8, idle: 9 };
const TIMED = { success: 2000, error: 3000, done: 5000 };
const AFTER = { success: 'thinking', error: 'thinking', done: 'idle' };
const SLEEP_AFTER_MS = 10 * 60 * 1000;
const ATTENTION_NOTIFICATIONS = ['permission_prompt', 'idle_prompt'];
const TARGET_MAX = 40;

const EVENT_STATE = {
  SessionStart: 'idle', PostCompact: 'idle', UserPromptSubmit: 'thinking', PreToolUse: 'working', PostToolUse: 'success',
  PostToolUseFailure: 'error', PermissionRequest: 'attention', Stop: 'done', PreCompact: 'compacting',
};

function stateForEvent(input) {
  if (input.hook_event_name === 'Notification') {
    return ATTENTION_NOTIFICATIONS.includes(input.notification_type) ? 'attention' : null;
  }
  return EVENT_STATE[input.hook_event_name] || null;
}

function toolTarget(toolInput) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  // path.win32 understands both separators, whatever platform the tests run on.
  const raw = input.file_path ? path.win32.basename(String(input.file_path)) : String(input.command || input.pattern || input.url || '');
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > TARGET_MAX ? `${oneLine.slice(0, TARGET_MAX - 1)}…` : oneLine;
}

const isShowing = (record, now) => Boolean(TIMED[record.state]) && now - record.stateSince < TIMED[record.state];

function subagentCount(event, current) {
  if (event === 'SubagentStart') return current + 1;
  if (event === 'SubagentStop') return Math.max(0, current - 1);
  return current;
}

function applyEvent(prev, input, now) {
  const event = input.hook_event_name;
  if (event === 'SessionEnd') return null;
  const base = prev || { state: 'idle', tool: null, target: null, subagents: 0, stateSince: now, updatedAt: now };
  const candidate = stateForEvent(input);
  const keep = !candidate || (isShowing(base, now) && PRIORITY[base.state] < PRIORITY[candidate]);
  const isTool = event === 'PreToolUse';
  return {
    state: keep ? base.state : candidate,
    tool: isTool ? input.tool_name || null : base.tool,
    target: isTool ? toolTarget(input.tool_input) : base.target,
    subagents: subagentCount(event, Number(base.subagents) || 0),
    stateSince: keep ? base.stateSince : now,
    updatedAt: now,
  };
}

function resolveState(record, now) {
  if (!record || !STATES.includes(record.state)) return { state: 'idle', tool: null, target: null, subagents: 0 };
  let state = record.state;
  if (TIMED[state] && now - record.stateSince >= TIMED[state]) state = AFTER[state];
  if (state === 'idle' && now - record.updatedAt >= SLEEP_AFTER_MS) state = 'sleeping';
  return { state, tool: record.tool || null, target: record.target || null, subagents: Number(record.subagents) || 0 };
}

module.exports = { EVENTS, STATES, TIMED, SLEEP_AFTER_MS, applyEvent, resolveState };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/state.test.js`
Expected: PASS, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/state.js test/state.test.js
git commit -m "feat: add session state machine with priorities and timed states"
```

---

### Task 3: Sprite engine

**Files:**
- Create: `lib/sprites.js`
- Test: `test/sprites.test.js`

**Interfaces:**
- Consumes: `readJson` from `lib/io.js`; `STATES` from `lib/state.js`.
- Produces (`lib/sprites.js`):
  - `SIZE = 20`, `MASCOTS_DIR` (absolute path of `mascots/`), `RESET = '\x1b[0m'`, `NBSP = ' '`.
  - `validateMascot(mascot: any): string[]`: empty array means valid.
  - `loadMascot(name: string, dir = MASCOTS_DIR): Mascot|null`: null when missing or invalid.
  - `listMascots(dir = MASCOTS_DIR): string[]`: sorted folder names that contain `mascot.json` (folders starting with `_` are skipped).
  - `loadAccessories(dir = MASCOTS_DIR): { palette: object, items: { [name]: { rows: string[] } } }`.
  - `frameFor(mascot: Mascot, state: string, now: number): string[]`: frame rows; unknown or empty state → `idle`; frame index `Math.floor(now / 1000) % sequence.length`.
  - `toColors(rows: string[], palette: object): (string|null)[][]`.
  - `overlay(colors, item: { rows: string[] }, palette: object, at: [x, y]): (string|null)[][]`: new grid, transparent and out-of-bounds cells skipped.
  - `mixHex(a: string, b: string, t: number): string`, `tint(colors, fromHex: string, toHex: string, amount: number)`: new grid.
  - `encodeRows(colors): string[]`: one string per two pixel rows (20 pixel rows → 10 strings); every cell begins with `RESET`; each row ends with `RESET`.

Cell encoding (top pixel, bottom pixel):
- both transparent → `RESET + NBSP`
- same color → `RESET + fg(color) + '█'`
- different colors → `RESET + fg(top) + bg(bottom) + '▀'`
- top only → `RESET + fg(top) + '▀'`; bottom only → `RESET + fg(bottom) + '▄'`
- `fg(#rrggbb)` = `\x1b[38;2;R;G;Bm`, `bg(#rrggbb)` = `\x1b[48;2;R;G;Bm`

- [ ] **Step 1: Write the failing tests**

`test/sprites.test.js`:
```js
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
  assert.equal(row, `${R} ${R}\x1b[38;2;255;0;0m█${R}\x1b[38;2;255;0;0m\x1b[48;2;0;0;255m▀${R}\x1b[38;2;0;255;0m▄${R}`);
  assert.equal(s.encodeRows([['#ff0000']])[0], `${R}\x1b[38;2;255;0;0m▀${R}`);
  assert.equal(s.encodeRows(s.toColors(blank(), {})).length, 10);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/sprites.test.js`
Expected: FAIL with `Cannot find module '../lib/sprites'`.

- [ ] **Step 3: Implement `lib/sprites.js`**

```js
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
const NBSP = ' ';
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/sprites.test.js`
Expected: PASS, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/sprites.js test/sprites.test.js
git commit -m "feat: add sprite validation, compositing and half-block encoding"
```

---

### Task 4: Accessories and the cat mascot

**Files:**
- Create: `mascots/_accessories.json`, `mascots/cat/mascot.json`
- Test: `test/mascots.test.js`

**Interfaces:**
- Consumes: `listMascots`, `validateMascot`, `loadAccessories`, `frameFor`, `toColors`, `encodeRows` from `lib/sprites.js`.
- Produces:
  - Accessory item names used by `lib/frame.js`: `exclaim`, `alarm`, `zzz`, `sparkle`, `sweat`, `clone`, `hourglass`.
  - Bundled-mascot rules every later mascot must pass: valid per `validateMascot`; non-empty `idle`, `thinking`, `working`, `success`, `error`, `attention`; columns 16–19 of rows 0–12 transparent in every frame (room for the `top` and `side` accessories).

- [ ] **Step 1: Write the failing test**

`test/mascots.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const s = require('../lib/sprites');

const CORE_STATES = ['idle', 'thinking', 'working', 'success', 'error', 'attention'];
const ACCESSORIES = ['exclaim', 'alarm', 'zzz', 'sparkle', 'sweat', 'clone', 'hourglass'];
const readMascot = (name) => require(path.join(s.MASCOTS_DIR, name, 'mascot.json'));

test('every bundled mascot is valid and the cat is there', () => {
  const names = s.listMascots();
  assert.ok(names.includes('cat'));
  for (const name of names) assert.deepEqual(s.validateMascot(readMascot(name)), [], name);
});

test('every bundled mascot draws the core states', () => {
  for (const name of s.listMascots()) {
    const mascot = readMascot(name);
    for (const state of CORE_STATES) assert.ok(mascot.states[state] && mascot.states[state].length > 0, `${name}.${state}`);
  }
});

test('bundled mascots keep the accessory corner clear', () => {
  for (const name of s.listMascots()) {
    const mascot = readMascot(name);
    for (const [frame, rows] of Object.entries(mascot.frames)) {
      rows.slice(0, 13).forEach((row, y) => {
        [...row.slice(16)].forEach((ch, i) => assert.equal(mascot.palette[ch], null, `${name} ${frame} x${16 + i} y${y}`));
      });
    }
  }
});

test('the accessories file has every item the frame builder uses', () => {
  const { palette, items } = s.loadAccessories();
  for (const name of ACCESSORIES) {
    assert.ok(items[name], name);
    for (const row of items[name].rows) for (const ch of row) assert.ok(Object.hasOwn(palette, ch), `${name} uses "${ch}"`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/mascots.test.js`
Expected: FAIL: `listMascots()` returns `[]`, so `names.includes('cat')` is false, and `items.exclaim` is missing.

- [ ] **Step 3: Create `mascots/_accessories.json`**

```json
{
  "palette": {
    ".": null,
    "k": "#2b2d42",
    "w": "#ffffff",
    "r": "#ff5f57",
    "y": "#ffd166",
    "b": "#7db8ff"
  },
  "items": {
    "exclaim": {
      "rows": ["rr", "rr", "rr", "..", "rr"]
    },
    "alarm": {
      "rows": ["r.r", "r.r", "r.r", "...", "r.r"]
    },
    "zzz": {
      "rows": ["bbb.", "..b.", ".b..", "bbb."]
    },
    "sparkle": {
      "rows": [".y.", "yyy", ".y."]
    },
    "sweat": {
      "rows": [".b", "bw", "bb"]
    },
    "clone": {
      "rows": [".kk.", "kwwk", "kwwk", "kkkk", "k..k"]
    },
    "hourglass": {
      "rows": ["kkk", "yyy", ".y.", "yyy", "kkk"]
    }
  }
}
```

- [ ] **Step 4: Create `mascots/cat/mascot.json`**

Frames: `idle_1` (open eyes), `idle_2` (blink, also used for compacting and sleeping), `think_1`/`think_2` (eyes glance right then left, small mouth), `work_1`/`work_2` (focused eyes, paws alternate), `ok_1` (happy closed eyes, open pink mouth), `fail_1` (worried eyes, frown), `alert_1` (wide eyes, small open mouth).

```json
{
  "name": "Cat",
  "size": [
    20,
    20
  ],
  "palette": {
    ".": null,
    "k": "#2b2d42",
    "o": "#f5a623",
    "d": "#c47f17",
    "p": "#eaa4bb",
    "w": "#fff4e0",
    "e": "#1b1b1b"
  },
  "bodyColor": "o",
  "anchors": {
    "top": [
      16,
      0
    ],
    "side": [
      16,
      8
    ],
    "cheek": [
      15,
      5
    ]
  },
  "frames": {
    "idle_1": [
      "....................",
      "..kk.......kk.......",
      ".kopk.....kpok......",
      ".koooooooooook......",
      "koooooooooooook.....",
      "koooooooooooook.....",
      "kooweoooooweook.....",
      "kooeeoooooeeook.....",
      "kopoooopoooopok.....",
      "koooookokoooook.....",
      ".kkkoooooookkk......",
      "k.koooooooooook.....",
      "k.kodooooooodok.....",
      ".kkoowwwwwwwook.....",
      ".kkoowwwwwwwook.....",
      "..koooooooooook.....",
      "..kooookkkooook.....",
      "..kooook.kooook.....",
      "..kppppk.kppppk.....",
      "...kkkk...kkkk......"
    ],
    "idle_2": [
      "....................",
      "..kk.......kk.......",
      ".kopk.....kpok......",
      ".koooooooooook......",
      "koooooooooooook.....",
      "koooooooooooook.....",
      "koooooooooooook.....",
      "kookkoooookkook.....",
      "kopoooopoooopok.....",
      "koooookokoooook.....",
      ".kkkoooooookkk......",
      "k.koooooooooook.....",
      "k.kodooooooodok.....",
      ".kkoowwwwwwwook.....",
      ".kkoowwwwwwwook.....",
      "..koooooooooook.....",
      "..kooookkkooook.....",
      "..kooook.kooook.....",
      "..kppppk.kppppk.....",
      "...kkkk...kkkk......"
    ],
    "think_1": [
      "....................",
      "..kk.......kk.......",
      ".kopk.....kpok......",
      ".koooooooooook......",
      "koooooooooooook.....",
      "koooooooooooook.....",
      "koooewoooooewok.....",
      "koooeeoooooeeok.....",
      "kopoooopoooopok.....",
      "kooooookooooook.....",
      ".kkkoooooookkk......",
      "k.koooooooooook.....",
      "k.kodooooooodok.....",
      ".kkoowwwwwwwook.....",
      ".kkoowwwwwwwook.....",
      "..koooooooooook.....",
      "..kooookkkooook.....",
      "..kooook.kooook.....",
      "..kppppk.kppppk.....",
      "...kkkk...kkkk......"
    ],
    "think_2": [
      "....................",
      "..kk.......kk.......",
      ".kopk.....kpok......",
      ".koooooooooook......",
      "koooooooooooook.....",
      "koooooooooooook.....",
      "koweoooooweoook.....",
      "koeeoooooeeoook.....",
      "kopoooopoooopok.....",
      "kooooookooooook.....",
      ".kkkoooooookkk......",
      "k.koooooooooook.....",
      "k.kodooooooodok.....",
      ".kkoowwwwwwwook.....",
      ".kkoowwwwwwwook.....",
      "..koooooooooook.....",
      "..kooookkkooook.....",
      "..kooook.kooook.....",
      "..kppppk.kppppk.....",
      "...kkkk...kkkk......"
    ],
    "work_1": [
      "....................",
      "..kk.......kk.......",
      ".kopk.....kpok......",
      ".koooooooooook......",
      "koooooooooooook.....",
      "koooooooooooook.....",
      "kooeeoooooeeook.....",
      "koooooooooooook.....",
      "kopoooopoooopok.....",
      "kooooookooooook.....",
      ".kkkoooooookkk......",
      "k.koooooooooook.....",
      "k.kodooooooodok.....",
      ".kkoowwwwwwwook.....",
      ".kkoowwwwwwwook.....",
      "..koooooooooook.....",
      "..kooookkkooook.....",
      "..kooook.kooook.....",
      "..kppppk.kppppk.....",
      "...kkkk...kkkk......"
    ],
    "ok_1": [
      "....................",
      "..kk.......kk.......",
      ".kopk.....kpok......",
      ".koooooooooook......",
      "koooooooooooook.....",
      "koooooooooooook.....",
      "kookkoooookkook.....",
      "kokookoookookok.....",
      "kopoooopoooopok.....",
      "kooooopppoooook.....",
      ".kkkoooooookkk......",
      "k.koooooooooook.....",
      "k.kodooooooodok.....",
      ".kkoowwwwwwwook.....",
      ".kkoowwwwwwwook.....",
      "..koooooooooook.....",
      "..kooookkkooook.....",
      "..kooook.kooook.....",
      "..kppppk.kppppk.....",
      "...kkkk...kkkk......"
    ],
    "fail_1": [
      "....................",
      "..kk.......kk.......",
      ".kopk.....kpok......",
      ".koooooooooook......",
      "koooooooooooook.....",
      "koooooooooooook.....",
      "kowwooooooowwok.....",
      "koekoooooookeok.....",
      "kopoooopoooopok.....",
      "koooookkkoooook.....",
      ".kkkoooooookkk......",
      "k.koooooooooook.....",
      "k.kodooooooodok.....",
      ".kkoowwwwwwwook.....",
      ".kkoowwwwwwwook.....",
      "..koooooooooook.....",
      "..kooookkkooook.....",
      "..kooook.kooook.....",
      "..kppppk.kppppk.....",
      "...kkkk...kkkk......"
    ],
    "alert_1": [
      "....................",
      "..kk.......kk.......",
      ".kopk.....kpok......",
      ".koooooooooook......",
      "koooooooooooook.....",
      "koooooooooooook.....",
      "kowwooooooowwok.....",
      "koweoooooooweok.....",
      "kopoooopoooopok.....",
      "koooooopooooook.....",
      ".kkkoooooookkk......",
      "k.koooooooooook.....",
      "k.kodooooooodok.....",
      ".kkoowwwwwwwook.....",
      ".kkoowwwwwwwook.....",
      "..koooooooooook.....",
      "..kooookkkooook.....",
      "..kooook.kooook.....",
      "..kppppk.kppppk.....",
      "...kkkk...kkkk......"
    ],
    "work_2": [
      "....................",
      "..kk.......kk.......",
      ".kopk.....kpok......",
      ".koooooooooook......",
      "koooooooooooook.....",
      "koooooooooooook.....",
      "kooeeoooooeeook.....",
      "koooooooooooook.....",
      "kopoooopoooopok.....",
      "kooooookooooook.....",
      ".kkkoooooookkk......",
      "k.koooooooooook.....",
      "k.kodooooooodok.....",
      ".kkoowwwwwwwook.....",
      ".kkoowwwwwwwook.....",
      "..koooooooooook.....",
      "..kooookkkooook.....",
      "..kppppk.kooook.....",
      "..kook...kppppk.....",
      "...kk.....kkkk......"
    ]
  },
  "states": {
    "idle": [
      "idle_1",
      "idle_1",
      "idle_1",
      "idle_2"
    ],
    "thinking": [
      "think_1",
      "think_2"
    ],
    "working": [
      "work_1",
      "work_2"
    ],
    "success": [
      "ok_1"
    ],
    "error": [
      "fail_1"
    ],
    "attention": [
      "alert_1",
      "idle_1"
    ],
    "compacting": [
      "idle_2"
    ],
    "done": [
      "ok_1",
      "idle_1"
    ],
    "sleeping": [
      "idle_2"
    ]
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/mascots.test.js`
Expected: PASS, `# fail 0`.

- [ ] **Step 6: Look at the cat in the terminal**

Run (Git Bash, from the repo root, inside Windows Terminal):
```bash
node -e "const s=require('./lib/sprites');const m=s.loadMascot(process.argv[1]);if(!m){console.log(s.validateMascot(require('./mascots/'+process.argv[1]+'/mascot.json')).join('\n'));process.exit(1)}for(const st of ['idle','thinking','working','success','error','attention']){console.log(st);console.log(s.encodeRows(s.toColors(s.frameFor(m,st,0),m.palette)).join('\n'))}" cat
```
Expected: six labelled 10-row cat drawings with orange fur, dark outline and visible expression changes. If a face reads badly, adjust the eye/mouth rows (rows 6, 7, 9) and rerun Step 5.

- [ ] **Step 7: Commit**

```bash
git add mascots/_accessories.json mascots/cat test/mascots.test.js
git commit -m "feat: add shared accessories and the cat mascot"
```

---

### Task 5: Octopus, robot and ghost mascots

**Files:**
- Create: `mascots/octopus/mascot.json`, `mascots/robot/mascot.json`, `mascots/ghost/mascot.json`
- Modify: `test/mascots.test.js` (add one test)

**Interfaces:**
- Consumes: the bundled-mascot rules from Task 4 (enforced by `test/mascots.test.js`), the cat file as a format reference, and the Step 6 preview command from Task 4.
- Produces: `listMascots()` returns `['cat', 'ghost', 'octopus', 'robot']`.

Rules for every mascot:
- `size: [20, 20]`; at most 16 colors; `'.': null` in the palette; outline color `k: "#2b2d42"` so the pack looks consistent.
- The drawing fits in columns 0–15. Columns 16–19 of rows 0–12 stay `.`.
- `anchors`: `top: [16, 0]`, `side: [16, 8]`, `cheek`: a point just right of the face, inside columns 13–15 and rows 4–8.
- `bodyColor`: the main body color key (it gets tinted as context fills).
- Frames needed: `idle_1`, `idle_2` (blink or small motion), `think_1`, `think_2`, `work_1`, `work_2`, `ok_1`, `fail_1`, `alert_1`. States map exactly like the cat: idle `[idle_1, idle_1, idle_1, idle_2]`, thinking `[think_1, think_2]`, working `[work_1, work_2]`, success `[ok_1]`, error `[fail_1]`, attention `[alert_1, idle_1]`, compacting `[idle_2]`, done `[ok_1, idle_1]`, sleeping `[idle_2]`.
- Start by copying `idle_1` into every frame name, then change only the rows that carry the expression or pose. Keep rows as 20-character strings.

Designs:

| Mascot | Palette (besides `.` and `k`) | Look and state cues |
|---|---|---|
| Octopus | `o: "#9b5de5"` body, `d: "#6a31b5"` shade, `p: "#f7aef8"` suckers, `w: "#ffffff"` eye white, `e: "#1b1b1b"` pupil | Round head in rows 1–10, six tentacles in rows 11–19 with pink sucker dots. idle_2: tentacle tips shift one pixel. thinking: pupils up-left/up-right. working: tentacles alternate raised pairs. success: closed happy eyes and a smile. error: pupils small, mouth wavy. attention: eyes wide, two tentacles raised. |
| Robot | `o: "#8d99ae"` body, `d: "#5c677d"` shade, `g: "#0b3d2e"` face screen, `e: "#63d2a1"` screen eyes, `y: "#ffd166"` antenna light, `r: "#ff5f57"` alert red | Antenna rows 0–2 (column ≤ 15), boxy head with dark screen rows 3–9, body with a panel rows 10–16, legs 17–19. idle_2: antenna light off (`d`). thinking: eyes as moving dots. working: arm pixels alternate up/down. success: `^ ^` eyes in `e`. error: `x x` eyes in `r`. attention: antenna light `r`, eyes wide. |
| Ghost | `o: "#e9ecef"` body, `d: "#adb5bd"` shade, `e: "#1b1b1b"` eyes, `p: "#f4a6c1"` blush | Dome head from row 2, wavy hem in rows 16–19. idle_1/idle_2: whole body one pixel lower in idle_2 (floating). thinking: eyes glance sideways. working: hem wave alternates. success: happy closed eyes, blush. error: wobbly mouth, eyes squeezed. attention: eyes big, mouth an `o`. |

- [ ] **Step 1: Add the failing test** (append to `test/mascots.test.js`)

```js
test('the pack ships four mascots', () => {
  assert.deepEqual(s.listMascots(), ['cat', 'ghost', 'octopus', 'robot']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/mascots.test.js`
Expected: FAIL with `Expected values to be strictly deep-equal` (actual `['cat']`).

- [ ] **Step 3: Draw `mascots/octopus/mascot.json`** following the table and rules above, then check it

Run: `node --test test/mascots.test.js` (the four-mascot test still fails; every other test must pass). Then the Task 4 Step 6 preview command with `octopus` as the last argument. Fix any validation messages it prints.

- [ ] **Step 4: Draw `mascots/robot/mascot.json`**, same checks with `robot`

- [ ] **Step 5: Draw `mascots/ghost/mascot.json`**, same checks with `ghost`

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/mascots.test.js`
Expected: PASS, `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add mascots/octopus mascots/robot mascots/ghost test/mascots.test.js
git commit -m "feat: add octopus, robot and ghost mascots"
```

---

### Task 6: Info rows

**Files:**
- Create: `lib/info.js`
- Test: `test/info.test.js`, `test/fixtures/status-input.json`

**Interfaces:**
- Consumes: `Config` shape from `lib/config.js`; resolved state shape from `resolveState` in `lib/state.js`.
- Produces (`lib/info.js`):
  - `visibleLength(text: string): number` (ignores ANSI color codes).
  - `truncate(text: string, width: number): string`: text wider than `width` is cut to `width - 1` visible characters plus `…` and a reset; ANSI codes are kept.
  - `stateText(resolved): string`.
  - `contextBar(percent: number): string` (10 cells of `▓`/`░`).
  - `num(value: any): number|null`.
  - `infoRows(input: StatusInput, resolved, config: Config): string[]` (0–3 rows).

Row contents:
- state (bold): `STATE_TEXT[state]`; for `working` with a tool: `<tool> <target>`.
- model: `<display_name or "Claude"> · ctx <bar> <pct>%`; bar and percent yellow at ≥60, red at ≥90.
- cost: parts joined with ` · `: `$<cost to 2 decimals>`, `5h <pct>%` (yellow above 90), `week <pct>%`; each part only when its number exists; the row is skipped when no part exists.

- [ ] **Step 1: Create the fixture** `test/fixtures/status-input.json`

```json
{
  "session_id": "test-session",
  "model": { "display_name": "Opus 5" },
  "context_window": { "used_percentage": 42 },
  "cost": { "total_cost_usd": 0.84 },
  "rate_limits": {
    "five_hour": { "used_percentage": 31, "resets_at": 1790000000 },
    "seven_day": { "used_percentage": 12, "resets_at": 1790500000 }
  }
}
```

- [ ] **Step 2: Write the failing tests**

`test/info.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const info = require('../lib/info');
const { DEFAULT_CONFIG } = require('../lib/config');
const input = require('./fixtures/status-input.json');

const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');
const working = { state: 'working', tool: 'Edit', target: 'render.js', subagents: 0 };

test('visibleLength ignores color codes', () => {
  assert.equal(info.visibleLength('\x1b[1mhello\x1b[0m'), 5);
});

test('truncate keeps short text and cuts long text to the width', () => {
  assert.equal(info.truncate('short', 10), 'short');
  const cut = info.truncate('\x1b[33mabcdefghijkl\x1b[0m', 6);
  assert.equal(info.visibleLength(cut), 6);
  assert.equal(plain(cut), 'abcde…');
  assert.ok(cut.startsWith('\x1b[33m'));
  assert.equal(info.truncate('anything', 0), '');
});

test('stateText names the tool while working', () => {
  assert.equal(info.stateText(working), 'Edit render.js');
  assert.equal(info.stateText({ state: 'working', tool: null, target: null }), 'working');
  assert.equal(info.stateText({ state: 'attention' }), 'needs you');
});

test('contextBar fills one cell per 10% and clamps', () => {
  assert.equal(info.contextBar(42), '▓▓▓▓░░░░░░');
  assert.equal(info.contextBar(-5), '░░░░░░░░░░');
  assert.equal(info.contextBar(150), '▓▓▓▓▓▓▓▓▓▓');
});

test('infoRows builds the three rows from the status input', () => {
  const rows = info.infoRows(input, working, DEFAULT_CONFIG).map(plain);
  assert.deepEqual(rows, ['Edit render.js', 'Opus 5 · ctx ▓▓▓▓░░░░░░ 42%', '$0.84 · 5h 31% · week 12%']);
});

test('infoRows respects the toggles and missing data', () => {
  const noCost = { ...DEFAULT_CONFIG, info: { state: true, model: false, cost: false } };
  assert.deepEqual(info.infoRows(input, working, noCost).map(plain), ['Edit render.js']);
  const bare = { session_id: 'x' };
  assert.deepEqual(info.infoRows(bare, working, DEFAULT_CONFIG).map(plain), ['Edit render.js', 'Claude · ctx ░░░░░░░░░░ 0%']);
  const costOnly = { cost: { total_cost_usd: 1.5 } };
  assert.equal(plain(info.infoRows(costOnly, working, DEFAULT_CONFIG)[2]), '$1.50');
});

test('infoRows warns with color near the limits', () => {
  const hot = { ...input, context_window: { used_percentage: 95 }, rate_limits: { five_hour: { used_percentage: 93 } } };
  const [, model, cost] = info.infoRows(hot, working, DEFAULT_CONFIG);
  assert.ok(model.includes('\x1b[31m'));
  assert.ok(cost.includes('\x1b[33m5h 93%'));
  assert.equal(info.num('7'), null);
  assert.equal(info.num(Number.NaN), null);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/info.test.js`
Expected: FAIL with `Cannot find module '../lib/info'`.

- [ ] **Step 4: Implement `lib/info.js`**

```js
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/info.test.js`
Expected: PASS, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add lib/info.js test/info.test.js test/fixtures/status-input.json
git commit -m "feat: add info rows with ANSI-aware truncation"
```

---

### Task 7: Frame builder and the status line entry

**Files:**
- Create: `lib/frame.js`, `render.js`
- Test: `test/frame.test.js`, `test/render.test.js`

**Interfaces:**
- Consumes: `resolveState` (state.js); `frameFor`, `toColors`, `overlay`, `tint`, `encodeRows`, `loadMascot`, `loadAccessories` (sprites.js); `infoRows`, `stateText`, `truncate`, `num` (info.js); `loadConfig` (config.js); `parseJson`, `readJson`, `sessionFile`, `appendLog`, `readStdin` (io.js); accessory names from Task 4.
- Produces:
  - `lib/frame.js`: `buildFrame({ input, record, config, mascot, accessories, now, columns }): string` (rows joined by `\n`); constants `SPRITE_COLUMNS = 20`, `GAP = 2`, `NARROW_COLUMNS = 60`.
  - `render.js`: `renderStatusLine(raw: string, now = Date.now(), columns = COLUMNS env or 80): string`; never throws; prints when run directly.

Decoration order in `buildFrame`:
1. Frame for the resolved state → colors.
2. Context mood: ≥90% tint `bodyColor` 60% toward `#ff3b30` and draw `alarm` at `top`; ≥80% tint 35% toward `#ff8c00` and draw `sweat` at `cheek`; ≥60% draw `sweat` at `cheek`.
3. State accessory at `top` (drawn after the alarm, so it wins): attention `exclaim`, sleeping and compacting `zzz`, success and done `sparkle`.
4. Side: `clone` when subagents > 0, otherwise `hourglass` when the 5-hour window is above 90%.
5. Encode to 10 rows. Text rows: `infoRows`, or only `stateText` when `columns < 60`. Each text row is truncated to `columns - 22` and vertically centered: first text row index `floor((10 - count) / 2)`.

- [ ] **Step 1: Write the failing tests**

`test/frame.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildFrame } = require('../lib/frame');
const { loadMascot, loadAccessories } = require('../lib/sprites');
const { DEFAULT_CONFIG } = require('../lib/config');
const { visibleLength } = require('../lib/info');
const input = require('./fixtures/status-input.json');

const T = 5_000_000;
const mascot = loadMascot('cat');
const accessories = loadAccessories();
const record = (state, extra = {}) => ({ state, tool: 'Edit', target: 'render.js', subagents: 0, stateSince: T, updatedAt: T, ...extra });
const build = (overrides = {}) => buildFrame({
  input, record: record('working'), config: DEFAULT_CONFIG, mascot, accessories, now: T, columns: 100, ...overrides,
}).split('\n');

test('builds 10 rows that each start with an escape code', () => {
  const rows = build();
  assert.equal(rows.length, 10);
  for (const row of rows) assert.ok(row.startsWith('\x1b[0m'));
});

test('centers the three info rows beside the mascot', () => {
  const rows = build();
  assert.ok(rows[3].includes('Edit render.js'));
  assert.ok(rows[4].includes('Opus 5'));
  assert.ok(rows[5].includes('$0.84'));
  assert.equal(visibleLength(rows[0]), 20);
});

test('no row is wider than the terminal', () => {
  const long = { ...input, model: { display_name: 'A very long model name that keeps going and going' } };
  for (const row of build({ input: long, columns: 80 })) assert.ok(visibleLength(row) <= 80, row);
});

test('narrow terminals get only the state text', () => {
  const rows = build({ columns: 50 });
  const text = rows.filter((row) => visibleLength(row) > 20);
  assert.equal(text.length, 1);
  assert.ok(text[0].includes('Edit render.js'));
});

test('context panic tints the body and raises the alarm', () => {
  const calm = build({ record: record('thinking') }).join('\n');
  const panic = build({ record: record('thinking'), input: { ...input, context_window: { used_percentage: 95 } } }).join('\n');
  assert.notEqual(calm, panic);
  assert.ok(!calm.includes('255;95;87'));
  assert.ok(panic.includes('255;95;87'));
});

test('subagents bring the clone and sleeping brings zzz', () => {
  assert.ok(build({ record: record('thinking', { subagents: 1 }) }).join('\n').includes('255;255;255'));
  assert.ok(!build({ record: record('thinking') }).join('\n').includes('255;255;255'));
  const asleep = build({ record: record('idle', { updatedAt: T - 11 * 60 * 1000, stateSince: T - 11 * 60 * 1000 }) });
  assert.ok(asleep.join('\n').includes('125;184;255'));
});
```

`test/render.test.js`:
```js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderStatusLine } = require('../render');
const input = require('./fixtures/status-input.json');

let home;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-render-'));
  process.env.CLAUDE_HABITAT_HOME = home;
});

const raw = JSON.stringify(input);

test('renders ten rows for a normal session', () => {
  assert.equal(renderStatusLine(raw, Date.now(), 100).split('\n').length, 10);
});

test('broken stdin prints one warning row and logs the error', () => {
  assert.equal(renderStatusLine('', Date.now(), 100), 'claude-habitat ! see render-error.log');
  assert.ok(fs.readFileSync(path.join(home, 'render-error.log'), 'utf8').length > 0);
  assert.equal(renderStatusLine('null', Date.now(), 100), 'claude-habitat ! see render-error.log');
});

test('unsafe session ids and unknown mascots still render', () => {
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ mascot: 'nope' }));
  const out = renderStatusLine(JSON.stringify({ ...input, session_id: '../../x' }), Date.now(), 100);
  assert.equal(out.split('\n').length, 10);
});

test('reads the session record written by the hook', () => {
  const now = Date.now();
  fs.mkdirSync(path.join(home, 'sessions'));
  fs.writeFileSync(path.join(home, 'sessions', 'test-session.json'), JSON.stringify({
    state: 'working', tool: 'Bash', target: 'npm test', subagents: 0, stateSince: now, updatedAt: now,
  }));
  assert.ok(renderStatusLine(raw, now, 100).includes('Bash npm test'));
});

test('an in-process render stays well under the frame budget', () => {
  const started = process.hrtime.bigint();
  for (let i = 0; i < 20; i += 1) renderStatusLine(raw, Date.now(), 100);
  const averageMs = Number(process.hrtime.bigint() - started) / 1e6 / 20;
  assert.ok(averageMs < 50, `average ${averageMs.toFixed(1)} ms`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/frame.test.js test/render.test.js`
Expected: FAIL with `Cannot find module '../lib/frame'` and `'../render'`.

- [ ] **Step 3: Implement `lib/frame.js`**

```js
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
```

- [ ] **Step 4: Implement `render.js`**

```js
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/frame.test.js test/render.test.js`
Expected: PASS, `# fail 0`.

- [ ] **Step 6: Measure a real process run** (Git Bash, repo root)

Run:
```bash
for i in 1 2 3 4 5 6 7 8 9 10; do s=$(date +%s%N); COLUMNS=100 node render.js < test/fixtures/status-input.json > /dev/null; echo $(( ($(date +%s%N) - s) / 1000000 )); done | sort -n | sed -n 5p
```
Expected: one number (the median in ms) below 150. Then run `COLUMNS=100 node render.js < test/fixtures/status-input.json` and check that a cat with three text rows appears.

- [ ] **Step 7: Commit**

```bash
git add lib/frame.js render.js test/frame.test.js test/render.test.js
git commit -m "feat: build the status line frame with mood, accessories and info rows"
```

---

### Task 8: Status line activation

**Files:**
- Create: `lib/activation.js`
- Test: `test/activation.test.js`

**Interfaces:**
- Consumes: `parseJson` from `lib/io.js`; `Config` shape from `lib/config.js`.
- Produces (`lib/activation.js`):
  - `settingsFile(): string`: env `CLAUDE_HABITAT_SETTINGS` or `~/.claude/settings.json`.
  - `ourCommand(root: string): string`: `node "<root with forward slashes>/render.js"`.
  - `isOurs(statusLine: any): boolean`.
  - `statusLineKind(settings: object): 'ours'|'other'|'none'`.
  - `withStatusLine(settings, root): object`, `withoutStatusLine(settings, previous: object|null): object`, `fixStalePath(settings, root): object|null`.
  - `readSettings(file): object` (`{}` when missing; **throws** when the file is not valid JSON, so a broken settings file is never overwritten).
  - `writeSettings(file, settings): void` (copies the current file to `<file>.bak` first).
  - `turnOn({ file?, root, config }): Config`, `turnOff({ file?, config }): Config`, `repairStatusLine({ file?, root }): boolean`.

- [ ] **Step 1: Write the failing tests**

`test/activation.test.js`:
```js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const a = require('../lib/activation');
const { DEFAULT_CONFIG } = require('../lib/config');

const ROOT = 'C:\\Users\\me\\.claude\\plugins\\cache\\claude-habitat\\claude-habitat\\0.2.0';
const OLD_ROOT = 'C:/Users/me/.claude/plugins/cache/claude-habitat/claude-habitat/0.1.0';
let file;

beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-settings-')), 'settings.json');
});

const write = (value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

test('settingsFile follows CLAUDE_HABITAT_SETTINGS', () => {
  process.env.CLAUDE_HABITAT_SETTINGS = file;
  assert.equal(a.settingsFile(), file);
  delete process.env.CLAUDE_HABITAT_SETTINGS;
  assert.equal(a.settingsFile(), path.join(os.homedir(), '.claude', 'settings.json'));
});

test('ourCommand uses an unquoted node and forward slashes', () => {
  assert.equal(a.ourCommand(ROOT), 'node "C:/Users/me/.claude/plugins/cache/claude-habitat/claude-habitat/0.2.0/render.js"');
});

test('isOurs and statusLineKind tell our status line apart', () => {
  assert.equal(a.isOurs({ type: 'command', command: a.ourCommand(OLD_ROOT) }), true);
  assert.equal(a.isOurs({ type: 'command', command: 'node "C:/Dev/claude-habitat/render.js"' }), true);
  assert.equal(a.isOurs({ type: 'command', command: 'npx ccstatusline' }), false);
  assert.equal(a.isOurs(undefined), false);
  assert.equal(a.statusLineKind({}), 'none');
  assert.equal(a.statusLineKind({ statusLine: { type: 'command', command: 'npx ccstatusline' } }), 'other');
  assert.equal(a.statusLineKind(a.withStatusLine({}, ROOT)), 'ours');
});

test('withStatusLine sets a one-second refresh', () => {
  assert.deepEqual(a.withStatusLine({ theme: 'dark' }, ROOT), {
    theme: 'dark',
    statusLine: { type: 'command', command: a.ourCommand(ROOT), refreshInterval: 1 },
  });
});

test('fixStalePath rewrites only our outdated command', () => {
  const stale = { statusLine: { type: 'command', command: a.ourCommand(OLD_ROOT), refreshInterval: 1 } };
  assert.equal(a.fixStalePath(stale, ROOT).statusLine.command, a.ourCommand(ROOT));
  assert.equal(a.fixStalePath(a.withStatusLine({}, ROOT), ROOT), null);
  assert.equal(a.fixStalePath({ statusLine: { type: 'command', command: 'x' } }, ROOT), null);
});

test('turning on then off leaves the file byte-for-byte as before', () => {
  write({ theme: 'dark', hooks: {} });
  const before = fs.readFileSync(file, 'utf8');
  const on = a.turnOn({ file, root: ROOT, config: DEFAULT_CONFIG });
  assert.equal(a.statusLineKind(a.readSettings(file)), 'ours');
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), before);
  assert.equal(on.previousStatusLine, null);
  a.turnOff({ file, config: on });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('a status line that is not ours is kept and restored in place', () => {
  const foreign = { type: 'command', command: 'npx ccstatusline' };
  write({ statusLine: foreign, theme: 'dark' });
  const before = fs.readFileSync(file, 'utf8');
  const on = a.turnOn({ file, root: ROOT, config: DEFAULT_CONFIG });
  assert.deepEqual(on.previousStatusLine, foreign);
  const again = a.turnOn({ file, root: ROOT, config: on });
  assert.deepEqual(again.previousStatusLine, foreign);
  const off = a.turnOff({ file, config: again });
  assert.equal(off.previousStatusLine, null);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('turnOff leaves someone else\'s status line alone', () => {
  write({ statusLine: { type: 'command', command: 'npx ccstatusline' } });
  const before = fs.readFileSync(file, 'utf8');
  a.turnOff({ file, config: DEFAULT_CONFIG });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('a missing settings file is created, a corrupt one is never touched', () => {
  a.turnOn({ file, root: ROOT, config: DEFAULT_CONFIG });
  assert.equal(a.statusLineKind(a.readSettings(file)), 'ours');
  fs.writeFileSync(file, '{ broken');
  assert.throws(() => a.turnOn({ file, root: ROOT, config: DEFAULT_CONFIG }));
  assert.equal(fs.readFileSync(file, 'utf8'), '{ broken');
});

test('repairStatusLine fixes a stale path and reports whether it wrote', () => {
  write({ statusLine: { type: 'command', command: a.ourCommand(OLD_ROOT), refreshInterval: 1 } });
  assert.equal(a.repairStatusLine({ file, root: ROOT }), true);
  assert.equal(a.readSettings(file).statusLine.command, a.ourCommand(ROOT));
  assert.equal(a.repairStatusLine({ file, root: ROOT }), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/activation.test.js`
Expected: FAIL with `Cannot find module '../lib/activation'`.

- [ ] **Step 3: Implement `lib/activation.js`**

```js
// Turns our status line on and off in ~/.claude/settings.json. A plugin cannot set the main
// statusLine itself, so this edits the user's settings, keeping a .bak and any status line it replaced.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseJson } = require('./io');

const REFRESH_SECONDS = 1;

const settingsFile = () => process.env.CLAUDE_HABITAT_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
// Unquoted node plus forward slashes: the command may run in Git Bash (eats backslashes) or PowerShell
// (a quoted first token is a string, not a command).
const ourCommand = (root) => `node "${root.replace(/\\/g, '/')}/render.js"`;

const isOurs = (statusLine) => Boolean(
  statusLine && typeof statusLine.command === 'string'
  && /claude-habitat/.test(statusLine.command) && /render\.js"?\s*$/.test(statusLine.command),
);

function statusLineKind(settings) {
  if (!settings.statusLine) return 'none';
  return isOurs(settings.statusLine) ? 'ours' : 'other';
}

const withStatusLine = (settings, root) => ({
  ...settings,
  statusLine: { type: 'command', command: ourCommand(root), refreshInterval: REFRESH_SECONDS },
});

function withoutStatusLine(settings, previous) {
  if (previous) return { ...settings, statusLine: previous };
  const { statusLine, ...rest } = settings;
  return rest;
}

function fixStalePath(settings, root) {
  if (!isOurs(settings.statusLine) || settings.statusLine.command === ourCommand(root)) return null;
  return { ...settings, statusLine: { ...settings.statusLine, command: ourCommand(root) } };
}

// Throws on invalid JSON on purpose: never overwrite a settings file we could not read.
const readSettings = (file) => (fs.existsSync(file) ? parseJson(fs.readFileSync(file, 'utf8')) : {});

function writeSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

function turnOn({ file = settingsFile(), root, config }) {
  const settings = readSettings(file);
  const kind = statusLineKind(settings);
  const previousStatusLine = kind === 'other' ? settings.statusLine : kind === 'ours' ? config.previousStatusLine : null;
  writeSettings(file, withStatusLine(settings, root));
  return { ...config, previousStatusLine };
}

function turnOff({ file = settingsFile(), config }) {
  const settings = readSettings(file);
  if (statusLineKind(settings) !== 'ours') return config;
  writeSettings(file, withoutStatusLine(settings, config.previousStatusLine));
  return { ...config, previousStatusLine: null };
}

function repairStatusLine({ file = settingsFile(), root }) {
  const fixed = fixStalePath(readSettings(file), root);
  if (!fixed) return false;
  writeSettings(file, fixed);
  return true;
}

module.exports = {
  settingsFile, ourCommand, isOurs, statusLineKind, withStatusLine, withoutStatusLine, fixStalePath,
  readSettings, writeSettings, turnOn, turnOff, repairStatusLine,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/activation.test.js`
Expected: PASS, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/activation.js test/activation.test.js
git commit -m "feat: turn the status line on and off with backup and restore"
```

---

### Task 9: Hook entry and hook registration

**Files:**
- Create: `hook.js`, `hooks/hooks.json`
- Test: `test/hook.test.js`

**Interfaces:**
- Consumes: `readStdin`, `parseJson`, `readJson`, `writeJsonAtomic`, `sessionFile`, `sessionsDir`, `appendLog` (io.js); `applyEvent`, `EVENTS` (state.js); `repairStatusLine` (activation.js).
- Produces (`hook.js`): `STALE_SESSION_MS` (7 days), `pruneSessions(now: number): void`, `handleHook(input: object, now: number, root = __dirname): void`. Run directly, it reads stdin, calls `handleHook`, logs any error to `hook-error.log` and exits 0.

- [ ] **Step 1: Write the failing tests**

`test/hook.test.js`:
```js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { handleHook, pruneSessions, STALE_SESSION_MS } = require('../hook');
const { EVENTS } = require('../lib/state');
const { ourCommand } = require('../lib/activation');

const T = 1_700_000_000_000;
const ROOT = 'C:/Dev/claude-habitat-next';
let home;
let settings;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-hook-'));
  process.env.CLAUDE_HABITAT_HOME = home;
  settings = path.join(home, 'settings.json');
  process.env.CLAUDE_HABITAT_SETTINGS = settings;
});

const sessionPath = (id) => path.join(home, 'sessions', `${id}.json`);
const read = (id) => JSON.parse(fs.readFileSync(sessionPath(id), 'utf8'));

test('hooks.json registers every event as an async node hook', () => {
  const { hooks } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(hooks).sort(), [...EVENTS].sort());
  for (const event of EVENTS) {
    assert.deepEqual(hooks[event], [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hook.js'], async: true }] }]);
  }
});

test('writes the session record for an event', () => {
  handleHook({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } }, T);
  assert.equal(read('s1').state, 'working');
  assert.equal(read('s1').target, 'npm test');
});

test('ignores unsafe session ids', () => {
  handleHook({ session_id: '../../boom', hook_event_name: 'Stop' }, T);
  assert.equal(fs.existsSync(path.join(home, 'sessions')), false);
});

test('an older hook finishing late does not overwrite a newer one', () => {
  handleHook({ session_id: 's1', hook_event_name: 'UserPromptSubmit' }, T + 100);
  handleHook({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Read' }, T);
  assert.equal(read('s1').state, 'thinking');
});

test('SessionEnd deletes the record', () => {
  handleHook({ session_id: 's1', hook_event_name: 'SessionStart' }, T);
  handleHook({ session_id: 's1', hook_event_name: 'SessionEnd' }, T + 1);
  assert.equal(fs.existsSync(sessionPath('s1')), false);
});

test('pruneSessions removes records older than a week', () => {
  handleHook({ session_id: 'old', hook_event_name: 'SessionStart' }, T);
  handleHook({ session_id: 'new', hook_event_name: 'SessionStart' }, T);
  const weekAgo = (Date.now() - STALE_SESSION_MS - 60_000) / 1000;
  fs.utimesSync(sessionPath('old'), weekAgo, weekAgo);
  pruneSessions(Date.now());
  assert.equal(fs.existsSync(sessionPath('old')), false);
  assert.equal(fs.existsSync(sessionPath('new')), true);
});

test('SessionStart repairs a stale status line path', () => {
  fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: ourCommand('C:/old/claude-habitat'), refreshInterval: 1 } }));
  handleHook({ session_id: 's1', hook_event_name: 'SessionStart' }, T, ROOT);
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).statusLine.command, ourCommand(ROOT));
});

test('a corrupt settings file does not stop the state from being written', () => {
  fs.writeFileSync(settings, '{ broken');
  handleHook({ session_id: 's1', hook_event_name: 'SessionStart' }, T, ROOT);
  assert.equal(read('s1').state, 'idle');
  assert.match(fs.readFileSync(path.join(home, 'hook-error.log'), 'utf8'), /settings/);
});

test('the script exits 0 and logs when stdin is garbage', () => {
  execFileSync(process.execPath, [path.join(__dirname, '..', 'hook.js')], { input: 'not json', env: process.env });
  assert.ok(fs.readFileSync(path.join(home, 'hook-error.log'), 'utf8').length > 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/hook.test.js`
Expected: FAIL with `Cannot find module '../hook'`.

- [ ] **Step 3: Create `hooks/hooks.json`**

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hook.js"], "async": true }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hook.js"], "async": true }] }
    ],
    "PreToolUse": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hook.js"], "async": true }] }
    ],
    "PostToolUse": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hook.js"], "async": true }] }
    ],
    "PostToolUseFailure": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hook.js"], "async": true }] }
    ],
    "PermissionRequest": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hook.js"], "async": true }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hook.js"], "async": true }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hook.js"], "async": true }] }
    ],
    "PreCompact": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hook.js"], "async": true }] }
    ],
    "PostCompact": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hook.js"], "async": true }] }
    ],
    "SubagentStart": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hook.js"], "async": true }] }
    ],
    "SubagentStop": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hook.js"], "async": true }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hook.js"], "async": true }] }
    ]
  }
}
```

- [ ] **Step 4: Implement `hook.js`**

```js
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/hook.test.js`
Expected: PASS, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add hook.js hooks/hooks.json test/hook.test.js
git commit -m "feat: record session state from Claude Code hooks"
```

---

### Task 10: Terminal menu

**Files:**
- Create: `lib/menu-model.js`, `menu.js`
- Test: `test/menu-model.test.js`

**Interfaces:**
- Consumes: `STATES` (state.js); `loadConfig`, `saveConfig` (config.js); `listMascots`, `loadMascot`, `loadAccessories` (sprites.js); `buildFrame` (frame.js); `settingsFile`, `readSettings`, `statusLineKind`, `turnOn`, `turnOff` (activation.js); `appendLog` (io.js).
- Produces (`lib/menu-model.js`):
  - `ITEMS: string[]` = `['mascot','preview','context','info.state','info.model','info.cost','statusLine','quit']`, `CONTEXT_LEVELS = [20, 65, 85, 95]`.
  - `createModel({ mascots: string[], config: Config, statusLine: 'ours'|'other'|'none'|'unreadable' }): Model`.
  - `Model = { cursor, mascots, config, statusLine, previewIndex, contextIndex, confirm, message }`.
  - `reduce(model, key): { model, effects }`; `key` is one of `up down left right enter escape y n q`; effects are `{ type: 'save-config' | 'turn-on' | 'turn-off' | 'quit' }`.
  - `screenText(model): string[]` (plain text, no ANSI).
  - `previewInput(model): StatusInput`, `previewRecord(model, now): Record`.

Behavior:
- `q` (and Ctrl+C, mapped to `q` by `menu.js`) always quits.
- While `confirm` is true, only `y` (turn on, replacing the other status line), `n`/`escape` (cancel) and `q` do anything.
- `up`/`down` move the cursor with wrap-around and clear the message.
- `left`/`right` change the value under the cursor; `enter` does the same as `right`, toggles checkboxes, flips the status line and quits on `quit`.
- Mascot and info changes emit `save-config`. Status line: `ours` → `turn-off`; `none` → `turn-on`; `other` → confirm prompt; `unreadable` → message only.

- [ ] **Step 1: Write the failing tests**

`test/menu-model.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../lib/menu-model');
const { DEFAULT_CONFIG } = require('../lib/config');
const { STATES } = require('../lib/state');

const make = (overrides = {}) => ({
  ...m.createModel({ mascots: ['cat', 'ghost', 'octopus', 'robot'], config: DEFAULT_CONFIG, statusLine: 'none' }),
  ...overrides,
});
const at = (item, overrides = {}) => make({ cursor: m.ITEMS.indexOf(item), ...overrides });
const press = (model, ...keys) => keys.reduce((acc, key) => {
  const { model: next, effects } = m.reduce(acc.model, key);
  return { model: next, effects: [...acc.effects, ...effects] };
}, { model, effects: [] });

test('cursor wraps around both ends', () => {
  assert.equal(press(make(), 'up').model.cursor, m.ITEMS.length - 1);
  assert.equal(press(make(), 'down', 'down').model.cursor, 2);
  assert.equal(press(at('quit'), 'down').model.cursor, 0);
});

test('mascot cycles and saves', () => {
  const right = press(at('mascot'), 'right');
  assert.equal(right.model.config.mascot, 'ghost');
  assert.deepEqual(right.effects, [{ type: 'save-config' }]);
  assert.equal(press(at('mascot'), 'left').model.config.mascot, 'robot');
  const unknown = at('mascot', { config: { ...DEFAULT_CONFIG, mascot: 'gone' } });
  assert.equal(press(unknown, 'enter').model.config.mascot, 'ghost');
});

test('preview state and context level cycle without saving', () => {
  const preview = press(at('preview'), 'left');
  assert.equal(preview.model.previewIndex, STATES.length - 1);
  assert.deepEqual(preview.effects, []);
  assert.equal(press(at('context'), 'right', 'right').model.contextIndex, 2);
});

test('info toggles flip and save', () => {
  const { model, effects } = press(at('info.cost'), 'enter');
  assert.equal(model.config.info.cost, false);
  assert.equal(model.config.info.state, true);
  assert.deepEqual(effects, [{ type: 'save-config' }]);
});

test('status line toggles on and off', () => {
  assert.deepEqual(press(at('statusLine'), 'enter').effects, [{ type: 'turn-on' }]);
  assert.deepEqual(press(at('statusLine', { statusLine: 'ours' }), 'enter').effects, [{ type: 'turn-off' }]);
  const unreadable = press(at('statusLine', { statusLine: 'unreadable' }), 'enter');
  assert.deepEqual(unreadable.effects, []);
  assert.match(unreadable.model.message, /settings\.json/);
});

test('replacing another status line asks first', () => {
  const asked = press(at('statusLine', { statusLine: 'other' }), 'enter');
  assert.equal(asked.model.confirm, true);
  assert.deepEqual(asked.effects, []);
  assert.deepEqual(press(asked.model, 'down').model.cursor, asked.model.cursor);
  assert.deepEqual(press(asked.model, 'y').effects, [{ type: 'turn-on' }]);
  const declined = press(asked.model, 'n');
  assert.equal(declined.model.confirm, false);
  assert.deepEqual(declined.effects, []);
});

test('q quits from anywhere and enter quits on the quit item', () => {
  assert.deepEqual(press(make(), 'q').effects, [{ type: 'quit' }]);
  assert.deepEqual(press(at('quit'), 'enter').effects, [{ type: 'quit' }]);
  assert.deepEqual(press(at('quit'), 'right').effects, []);
});

test('screenText marks the cursor and shows values', () => {
  const lines = m.screenText(at('mascot', { statusLine: 'ours', message: 'Hello' }));
  assert.ok(lines.some((line) => line.startsWith(' > Mascot') && line.includes('< cat >')));
  assert.ok(lines.some((line) => line.includes('Status line') && line.includes('on')));
  assert.ok(lines.some((line) => line.includes('[x]')));
  assert.ok(lines.includes(' Hello'));
});

test('preview input and record follow the chosen state and context', () => {
  const model = make({ previewIndex: STATES.indexOf('error'), contextIndex: 3 });
  assert.equal(m.previewInput(model).context_window.used_percentage, 95);
  const record = m.previewRecord(model, 123);
  assert.equal(record.state, 'error');
  assert.equal(record.stateSince, 123);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/menu-model.test.js`
Expected: FAIL with `Cannot find module '../lib/menu-model'`.

- [ ] **Step 3: Implement `lib/menu-model.js`**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/menu-model.test.js`
Expected: PASS, `# fail 0`.

- [ ] **Step 5: Implement `menu.js`**

```js
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
```

- [ ] **Step 6: Try the menu by hand** (Windows Terminal, repo root, with a throwaway settings file)

Run in PowerShell:
```powershell
$env:CLAUDE_HABITAT_SETTINGS = "$env:TEMP\habitat-try\settings.json"; $env:CLAUDE_HABITAT_HOME = "$env:TEMP\habitat-try"; node menu.js
```
Expected: menu on the left, animated cat on the right. Check: arrows move and change values; the preview follows mascot, state and context; Enter on "Status line" turns it on and `$env:TEMP\habitat-try\settings.json` now has a `statusLine` pointing at this folder's `render.js`; Enter again turns it off; `q` and Ctrl+C both return to a clean prompt with the cursor visible.

- [ ] **Step 7: Commit**

```bash
git add lib/menu-model.js menu.js test/menu-model.test.js
git commit -m "feat: add the terminal settings menu with live preview"
```

---

### Task 11: /habitat command, README and final checks

**Files:**
- Create: `open-menu.js`, `commands/habitat.md`, `README.md`
- Test: `test/open-menu.test.js`

**Interfaces:**
- Consumes: `menu.js` (Task 10).
- Produces (`open-menu.js`): `MENU` (absolute path of `menu.js`), `launchers(menu = MENU): { command, args, verbatim }[]`, `openMenu(run = spawnSync, menu = MENU): string` (the sentence printed back into Claude's context).

- [ ] **Step 1: Write the failing tests**

`test/open-menu.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MENU, launchers, openMenu } = require('../open-menu');

const MENU_PATH = 'C:\\Users\\me\\claude-habitat\\menu.js';

test('tries Windows Terminal first, then a plain console window', () => {
  const [wt, cmd] = launchers(MENU_PATH);
  assert.deepEqual(wt, { command: 'wt.exe', args: ['-w', '0', 'nt', '--title', 'claude-habitat', 'node', MENU_PATH], verbatim: false });
  assert.deepEqual(cmd, { command: 'cmd.exe', args: [`/c start "claude-habitat" cmd /k node "${MENU_PATH}"`], verbatim: true });
  assert.equal(MENU, path.join(__dirname, '..', 'menu.js'));
});

test('stops at the first launcher that works', () => {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, verbatim: options.windowsVerbatimArguments });
    return { status: 0 };
  };
  assert.match(openMenu(run, MENU_PATH), /Windows Terminal tab/);
  assert.deepEqual(calls, [{ command: 'wt.exe', verbatim: false }]);
});

test('falls back when wt.exe is missing and explains when nothing works', () => {
  const missingWt = (command) => (command === 'wt.exe' ? { error: new Error('ENOENT') } : { status: 0 });
  assert.match(openMenu(missingWt, MENU_PATH), /console window/);
  const nothing = () => ({ status: 1 });
  assert.equal(openMenu(nothing, MENU_PATH), `Could not open a terminal. Run this yourself: node "${MENU_PATH}"`);
});

test('the /habitat command runs open-menu.js with node pre-approved', () => {
  const command = fs.readFileSync(path.join(__dirname, '..', 'commands', 'habitat.md'), 'utf8');
  assert.match(command, /allowed-tools: Bash\(node \*\)/);
  assert.ok(command.includes('!`node "${CLAUDE_PLUGIN_ROOT}/open-menu.js"`'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/open-menu.test.js`
Expected: FAIL with `Cannot find module '../open-menu'`.

- [ ] **Step 3: Implement `open-menu.js`**

```js
// Opens menu.js in its own terminal; Claude Code's shell cannot host an interactive menu.
const { spawnSync } = require('child_process');
const path = require('path');

const MENU = path.join(__dirname, 'menu.js');

const launchers = (menu = MENU) => [
  { command: 'wt.exe', args: ['-w', '0', 'nt', '--title', 'claude-habitat', 'node', menu], verbatim: false },
  // start takes the first quoted argument as the window title, so the line is passed verbatim.
  { command: 'cmd.exe', args: [`/c start "claude-habitat" cmd /k node "${menu}"`], verbatim: true },
];

function openMenu(run = spawnSync, menu = MENU) {
  for (const launcher of launchers(menu)) {
    const result = run(launcher.command, launcher.args, { stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: launcher.verbatim });
    if (!result.error && result.status === 0) {
      return `Opened the claude-habitat menu in a new ${launcher.command === 'wt.exe' ? 'Windows Terminal tab' : 'console window'}.`;
    }
  }
  return `Could not open a terminal. Run this yourself: node "${menu}"`;
}

if (require.main === module) process.stdout.write(`${openMenu()}\n`);

module.exports = { MENU, launchers, openMenu };
```

- [ ] **Step 4: Create `commands/habitat.md`**

```markdown
---
description: Open the claude-habitat menu (mascot, info rows, status line on/off) in a new terminal tab
allowed-tools: Bash(node *)
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/open-menu.js"`

Tell the user, in one short sentence, what the line above says. Do nothing else.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/open-menu.test.js`
Expected: PASS, `# fail 0`.

- [ ] **Step 6: Write `README.md`**

````markdown
# claude-habitat

A small pixel-art pet that lives in your Claude Code status line. It thinks while Claude thinks, gets to work when a tool runs, cheers when it succeeds, looks worried when it fails, waves when Claude needs you, and falls asleep when you leave. As the context window fills up it gets tired, then sweaty, then panics.

Four mascots ship with it: a cat, an octopus, a robot and a ghost.

Beside the mascot you get what Claude is doing, the model and context usage, and the session cost with your 5-hour and weekly limits. Each row can be turned off.

Windows only for now. Needs Node.js 20 or newer and works best in Windows Terminal.

## Install

Inside Claude Code:

```
/plugin marketplace add goncalooliveira03/claude-habitat
/plugin install claude-habitat@claude-habitat
```

Restart Claude Code, then run `/habitat`. A menu opens in a new terminal tab. Pick a mascot and turn the status line on. The mascot shows up after Claude's next message.

You can also open the menu yourself with `node menu.js` from the plugin folder.

## How it works

- Hooks write the current state of each session to `~/.claude/claude-habitat/sessions/`.
- Claude Code runs `render.js` as the status line once a second. It reads that state, draws the mascot with half-block characters in 24-bit color, and prints the info rows.
- A plugin cannot set the main status line itself, so turning it on edits `~/.claude/settings.json`. A copy of the previous file is kept as `settings.json.bak`. If you already had a status line, it is saved and put back when you turn claude-habitat off.
- After a plugin update, the next session start points the status line at the new plugin folder.

## Uninstall

Open `/habitat` and turn the status line off, then run `/plugin uninstall claude-habitat`. Delete `~/.claude/claude-habitat` if you want the settings gone too.

## Troubleshooting

- The status line shows `claude-habitat ! see render-error.log`: the details are in `~/.claude/claude-habitat/render-error.log`.
- The mascot looks cut off: make the terminal wider. Below 60 columns only the mascot and one text row are shown.
- Colors look wrong: use Windows Terminal. The old console host has limited color support.

## Making your own mascot

Each mascot is `mascots/<name>/mascot.json`: a 20×20 grid of one-character color keys per frame, a palette of up to 16 colors, and a list of frames for each state. Look at `mascots/cat/mascot.json`, then run `node --test` to validate your file.

## Development

```
node --test
node --test --experimental-test-coverage
```

## License

MIT
````

- [ ] **Step 7: Add the license**

Create `LICENSE` with the MIT license text, year 2026, holder `goncalooliveira03` (copy the format of the MIT license used in `C:\Dev\ClaudeCode Atividade Discord\LICENSE`).

- [ ] **Step 8: Run the whole suite with coverage**

Run: `node --test --experimental-test-coverage`
Expected: `# fail 0`; in the coverage table every `lib/*.js` file shows line coverage of 80% or more. If one is below, add tests for its uncovered lines (listed in the table) before continuing.

- [ ] **Step 9: Commit**

```bash
git add open-menu.js commands/habitat.md README.md LICENSE test/open-menu.test.js
git commit -m "feat: add /habitat command, README and license"
```

- [ ] **Step 10: Manual check in a real session**

1. In Claude Code: `/plugin marketplace add C:/Dev/claude-habitat`, then `/plugin install claude-habitat@claude-habitat`, then restart Claude Code.
2. Copy `~/.claude/settings.json` to `settings.before.json` in a temp folder.
3. Run `/habitat`: a Windows Terminal tab opens with the menu. Turn the status line on and quit.
4. Send a prompt that makes Claude read a file, run a command that fails (for example `ls does-not-exist`), and ask for permission for something. Tick each one when seen on the mascot:
   - [ ] idle after start, blinking
   - [ ] thinking after the prompt
   - [ ] working with the tool name and target in the text row
   - [ ] success sparkle for about 2 s
   - [ ] error for about 3 s after the failing command
   - [ ] attention with `!` during the permission prompt
   - [ ] done sparkle when Claude finishes, then idle
   - [ ] compacting `zzz` during `/compact`
   - [ ] mini-clone while a subagent runs
   - [ ] sleeping `zzz` after 10 idle minutes
   - [ ] sweat at 60% context, orange at 80%, red and `!!` at 90% (use the menu preview if a real session cannot reach it)
5. Resize the terminal below 60 columns: only the mascot and one text row remain, and no row disappears.
6. Bump `version` in `.claude-plugin/plugin.json` to `0.1.1`, update the plugin, restart Claude Code: the mascot still appears and `settings.json` points at the new folder.
7. Run `/habitat`, turn the status line off, quit. Compare `~/.claude/settings.json` with `settings.before.json`: they are identical (`fc` in cmd or `Compare-Object (Get-Content a) (Get-Content b)` in PowerShell prints nothing). Revert the version bump.
