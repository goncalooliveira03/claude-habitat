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

test('PreToolUse target strips control characters that could inject terminal escapes', () => {
  const command = 'echo \u001b[2J\u001b]0;pwned\u0007 done';
  const r = applyEvent(null, ev('PreToolUse', { tool_name: 'Bash', tool_input: { command } }), T);
  assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(r.target));
  assert.ok(r.target.startsWith('echo '));
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
