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
