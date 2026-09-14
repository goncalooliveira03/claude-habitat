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
