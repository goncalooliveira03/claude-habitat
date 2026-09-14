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
