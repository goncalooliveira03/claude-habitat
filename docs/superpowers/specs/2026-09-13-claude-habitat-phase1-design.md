# claude-habitat — Phase 1 design: pixel mascot in the status line

Date: 2026-09-13
Status: approved in brainstorming, awaiting spec review

## Vision

claude-habitat is a Claude Code plugin that dresses up the terminal around Claude: a pixel-art mascot that reacts to the session, a Claude color theme, a Windows Terminal profile (background, opacity, colors) and ambient animations such as an ASCII aquarium, all driven by one settings menu. Existing projects cover single pieces (mascot-statusline, ccstatusline, tweakcc, `/buddy`); none combines them behind one menu.

The project ships in phases, each with its own spec and plan:

| Phase | Content |
|---|---|
| **1 (this spec)** | Pixel mascot in the status line, reacting to session events, plus the terminal menu |
| 2 | Pixel-art editor and PNG import for mascots |
| 3 | Claude theme (plugin `themes/`) and Windows Terminal profile (background, opacity, colors) |
| 4 | Aquarium and other animations in a split pane |

Out of scope with no date: macOS/Linux, sounds.

## Constraints found during research

- A plugin's `settings.json` can only set `agent` and `subagentStatusLine`. The main `statusLine` must be written to `~/.claude/settings.json`.
- The status line re-runs on assistant messages and other session events, debounced at 300 ms, not on hook events. `refreshInterval` (minimum 1 s) adds a timer. Multi-line output and ANSI colors are supported.
- If any status line row is wider than the available width, Claude Code drops every row after it.
- Claude Code trims leading whitespace in the status line, so transparent cells must be non-breaking spaces.
- The plugin path changes on every plugin update (`cache/<version>/`).
- The `/habitat` menu cannot run interactively inside Claude's shell tool; it needs its own terminal tab.

## Architecture

Plain Node.js (20+), no dependencies, Windows only. Approach: one render process per tick, no daemon.

```
claude-habitat/
├─ .claude-plugin/       plugin.json, marketplace.json
├─ hooks/hooks.json      session events → hook.js (async)
├─ commands/habitat.md   /habitat → opens menu.js in a new Windows Terminal tab
├─ hook.js               event → state → writes the session state file
├─ render.js             status line: stdin JSON + state + config → frame
├─ menu.js               terminal menu (arrow keys, live preview)
├─ sprites.js            frame lookup, accessory overlay, half-block encoding
├─ mascots/
│  ├─ _accessories.json  shared overlays
│  └─ <name>/mascot.json cat, octopus, robot, ghost
└─ test.js               node --test suite
```

Data folder: `~/.claude/claude-habitat/`

- `config.json`: chosen mascot, enabled info segments, previous status line (if replaced)
- `sessions/<session_id>.json`: `{ state, tool, subagents, updatedAt }`
- `render-error.log`, `hook-error.log`: capped at 100 KB

### Data flow

1. A hook fires. `hook.js` maps the event to a state and writes the session file (atomic: temp file + rename). Hooks are `async`, so they never slow Claude down.
2. Every second (`refreshInterval: 1`) and on session events, Claude Code runs `render.js`. It reads the status line JSON from stdin (`session_id`, `model`, `context_window.used_percentage`, `cost`, `rate_limits`), the session file and the config, resolves the state, and prints the mascot with info rows beside it.
3. Timed states (success, error, done, sleeping) are computed in `render.js` from `updatedAt`. No timers, no background processes.

## Mascot format

- Sprite: **20×20 pixels**, rendered as **20 columns × 10 rows** with `▀`/`▄` and 24-bit ANSI colors (one text row = two pixel rows).
- Up to 16 colors per mascot. Transparent cells: non-breaking space on the default background.

```json
{
  "name": "Cat",
  "size": [20, 20],
  "palette": { ".": null, "k": "#2b2d42", "o": "#f5a623", "p": "#eaa4bb", "w": "#ffffff" },
  "bodyColor": "o",
  "anchors": { "top": [16, 0], "side": [18, 10], "cheek": [14, 9] },
  "frames": {
    "idle_1": ["....kk........kk....", "...20 strings of 20 palette keys..."],
    "idle_2": ["..."]
  },
  "states": { "idle": ["idle_1", "idle_1", "idle_2"], "thinking": ["think_1", "think_2"] }
}
```

- `frames`: 20 strings of 20 characters, each a palette key.
- `states`: frame sequence per state, advancing one frame per second (`floor(now / 1000) % length`).
- `bodyColor`: the palette key tinted toward orange and red as context fills.
- `anchors`: where shared accessories are placed.
- `mascots/_accessories.json`: small grids using the same key syntax, with their own palette: sweat drop, `zzz`, `!`, `?`, sparkles, mini-clone, hourglass.
- Fallbacks: a state with no frames uses `idle`. An invalid or missing mascot falls back to the cat.

## States

One main expression at a time, chosen by priority:

| Priority | State | Source | Duration |
|---|---|---|---|
| 1 | attention | `PermissionRequest`, `Notification` | until next event |
| 2 | error | `PostToolUseFailure` | 3 s |
| 3 | compacting | `PreCompact` → `PostCompact` | while compacting |
| 4 | success | `PostToolUse` | 2 s, then thinking |
| 5 | done | `Stop` | 5 s, then idle |
| 6 | working | `PreToolUse` (tool name kept for the text row) | until next event |
| 7 | thinking | `UserPromptSubmit` | until next event |
| 8 | sleeping | derived: no state change for 10 min | — |
| 9 | idle | `SessionStart` | — |

Modifiers, drawn on top of any expression:

- **Context mood** (`context_window.used_percentage`): <60% none; 60–80% tired (sweat drop); 80–90% sweaty, `bodyColor` tinted orange; >90% panic, red tint and `!!`.
- **Subagents**: `SubagentStart` +1, `SubagentStop` −1 (floor 0). One or more active shows the mini-clone.
- **Rate limits**: `rate_limits.five_hour.used_percentage` > 90% shows the hourglass and turns the limits text yellow.

## Info rows

Shown to the right of the mascot, 3–4 rows, vertically centered. Each segment can be turned off in the menu.

```
✏️ editing render.js
Opus 5 · ctx ▓▓▓▓░░░░░░ 42%
$0.84 · 5h 31% · week 12%
```

- State text: short description, including the tool and target when known.
- Model + context: model display name and a 10-cell bar.
- Cost + limits: session cost; 5-hour and weekly windows only when `rate_limits` is present.
- Every row is truncated to `terminal columns − 22`. Below 60 columns only the mascot and state text are shown.

## Menu (`menu.js`)

- Opened by `/habitat`, which runs `wt -w 0 nt --title "claude-habitat" node "<plugin>/menu.js"`, falling back to `start "" cmd /k node "<plugin>/menu.js"` when `wt` is missing. Also runnable directly with `node menu.js`.
- Items: mascot (←/→ to cycle), preview state and context level, the three info toggles, status line on/off, quit.
- A live animated preview sits on the right, so states can be previewed without Claude running.
- Every change is saved to `config.json` right away (atomic write). A running session picks it up on the next tick.
- Uses the alternate screen buffer and raw mode; always restores the terminal on exit, Ctrl+C and uncaught errors.

## Activation

- **On:** back up `~/.claude/settings.json` to `settings.json.bak`, then set `statusLine` to `{ "type": "command", "command": "\"<node>\" \"<plugin>/render.js\"", "refreshInterval": 1 }`.
- **Existing status line that isn't ours:** the menu asks first. If confirmed, the old value is stored in `config.json` and restored on deactivation.
- **Off:** remove our `statusLine`, or restore the previous one.
- **After a plugin update:** the `SessionStart` hook checks whether `statusLine` is ours (its command path contains a `claude-habitat` folder and ends with `render.js"`) and whether that `render.js` differs from the one next to the running `hook.js`. If both are true, it rewrites the command to the current plugin root, keeping a `.bak` as on activation.

## Error handling

- `render.js` wraps everything. On failure it prints one row (`claude-habitat ⚠ see log`) and appends to `render-error.log`. It never prints a stack trace. Budget: under 150 ms per frame, local file reads only.
- Missing or corrupt state file → `idle`. Corrupt config → defaults plus a log entry. Unknown mascot → cat. Invalid frame → default mascot.
- `hook.js` follows the presence-for-claude pattern: validate `session_id` against `^[\w-]+$` (used as a file name), strip a UTF-8 BOM from stdin, newest spawn wins over out-of-order async hooks, errors go to the log, always exit 0.
- Several concurrent sessions each use their own state file, keyed by `session_id`.
- Cleanup: `SessionEnd` deletes its session file. `SessionStart` removes session files older than 7 days (left behind by crashed sessions).

## Testing

`node --test`, no dependencies. Logic lives in pure functions so it can be tested without Claude running.

| Area | Checks |
|---|---|
| States | event → state mapping; priority; durations (success 2 s, error 3 s, sleeping after 10 min); subagent counter floor |
| Sprites | every bundled mascot is valid (20×20, known palette keys, state frame references exist); half-block encoding for the four cell cases (both filled, top only, bottom only, transparent); accessory placement at anchors |
| Render | sample stdin → expected row count; truncation to terminal width; empty or malformed stdin → warning row, no exception |
| Activation | on/off against a temp `settings.json`; storing and restoring a previous status line; stale plugin path fix |
| Hook | invalid `session_id` rejected; BOM stripped; newest spawn wins |

Coverage target: ≥80% on logic modules, measured with `node --test --experimental-test-coverage`. Menu screen drawing is excluded. A final manual checklist in a real Windows Terminal session covers every state.

## Success criteria

- [ ] Install the plugin, run `/habitat`, turn the status line on: the mascot appears in the next session.
- [ ] The mascot changes expression within ~1.5 s for each of the 9 states.
- [ ] Median render time under 150 ms on the development PC.
- [ ] The mascot still appears after a plugin update.
- [ ] Turning it off leaves `settings.json` identical to before activation.
- [ ] Narrow terminals and corrupt files never show raw errors or drop status line rows.
- [ ] Tests pass with ≥80% coverage on logic modules.

## Repository conventions

- GitHub: `goncalooliveira03/claude-habitat`.
- README and all public text in English, plain human prose.
- No `Co-Authored-By: Claude` trailers in commits or PRs.
