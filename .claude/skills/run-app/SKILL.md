---
name: run-app
description: Launch gitext and drive its real UI, click, type, screenshot, read the left panel and menus. Use when asked to run or start the app, screenshot it, or confirm a change works on screen rather than only in tests.
---

# Running gitext for real

`npm test` covers the parsers, the models and git itself. `npm run test:e2e` drives the
built app, but asserts against git: a committed spec, a fixed scenario, and no eyes on
the screen. Neither can tell you that a menu row is unreadable, that a section vanished,
or that a keydown handler swallowed Enter: every one of those has shipped here and been
found by looking. This skill is the ad-hoc half: an arbitrary sequence of clicks and keys
given on the command line in one launch, and screenshots to read. Reach for it while
working on a change; write an `e2e/` spec once the behaviour is worth keeping.

**Read the screenshot you take.** A blank frame or a stale layout is the finding.

**A run puts nothing on screen.** The windows are built and driven but never shown, and
the app hides its Dock icon: so a check does not steal focus, bounce the Dock, or drag a
full-screen Space away from whatever the person at the keyboard was doing. Nothing is lost
by it: Playwright talks to the renderer over the DevTools protocol, so clicks, keys,
`panel`, `text` and **screenshots** all work exactly as they do on a visible window: a
screenshot is of the page's own surface, and looks identical. Pass `--focus` to run it in
front of you, which is worth doing only when you want to take over by hand.

## Run it

Nothing to install: `playwright-core` comes in with `@playwright/test`, which the `e2e/`
suite runs on, so the driver resolves it from the project's own `node_modules`. Set
`PLAYWRIGHT_CORE` only for a checkout whose dependencies are not installed.

The driver shares `e2e/support/platform.mts` with that suite: the settings-file path, the
Electron binary, the environment a launch has to fix, and the console noise to ignore.
Fix one of those there, not here.

The app loads from `out/`, so build first: a source edit that has not been built will
not be on screen:

```bash
npm run build
node .claude/skills/run-app/drive.mjs "panel" "shot after"
```

Commands run in order in a single launch, and each prints what it saw:

```bash
node .claude/skills/run-app/drive.mjs --theme dark \
  "rclick .left-panel .row" \
  "wait .menu" \
  "menu" \
  "clicktext Expand All" \
  "sleep 800" \
  "panel" \
  "shot expanded"
```

`--help` lists every command. The ones that carry this app's knowledge:

| command | what it gives you |
|---|---|
| `panel` | the left panel's rows as text, indented: the fastest check that a section or ref is where it should be |
| `menu` | every open menu's rows with `[x]` / `[ ]` checked state read from `aria-checked` |
| `clicktext <text>` | clicks a menu row by label; menu rows have no ids, their labels come from the command registry |
| `config` | prints the settings file the app is actually reading |
| `windows` | every open window, index, title, URL, with the one being driven marked |
| `win <n\|name>` | drive another window, by index or by a title/URL fragment |
| `waitwin [ms]` | wait for a new window to open and drive it |

Options: `--repo <path>` (default: this project), `--theme light|dark|system`,
`--shots <dir>`, `--settle <ms>`, `--keep-config`, `--focus`.

## Dialogs are windows

Every operation dialog is its own `BrowserWindow` (`main/dialogs.ts`), which means
**nothing in the repository window's DOM ever shows one**. Waiting on a selector there
times out with the dialog open and driveable. Open it, then `waitwin`:

```bash
node .claude/skills/run-app/drive.mjs \
  "key Meta+p" "sleep 600" "type Checkout Branch" "key Enter" \
  "waitwin" "shot checkout" "text .frame" \
  "win 0" "shot main-still-usable"
```

`waitwin` switches to the new window and gives it time to load its settings and adopt
the repository; `win 0` goes back to the repository window, which is readable but
**inert** while a dialog is up: the dialog is modal, so a click or a key sent there does
nothing until it is closed. `evalmain BrowserWindow.getAllWindows().find(w=>!w.getParentWindow()).isEnabled()`
is how to check that from the outside.
Screenshots are per window, so shoot each one you care about. A dialog that throws on
mount is reported in the same renderer-console summary as the main window's errors.

## Gotchas, each one paid for

- **`isVisible()` is `false` for every window, and that is the design.** See the note at
  the top: a driven run is deliberately never shown (`GITEXT_BACKGROUND=1`, read by
  `main/background.ts`). Don't "fix" it by calling `show()` from `evalmain`: that is the
  focus steal the whole thing exists to avoid. `--focus` is the supported way.
- **`ELECTRON_RUN_AS_NODE=1` is set in this environment.** The editor's terminal exports
  it, Electron inherits it, and then runs as a bare Node binary: `require('electron')`
  returns a path string, and the app dies on `Cannot read properties of undefined
  (reading 'whenReady')`. Through Playwright it surfaces only as `Process failed to
  launch!`. The driver deletes it; anything else launching Electron must too.
- **No `tmux`, no `timeout` on this machine.** The usual "REPL under tmux" recipe for
  Electron does not apply: that is why this driver is one-shot and takes its whole
  script on the command line.
- **There is no "ready" event.** The window mounts, then the repository loads over IPC
  and the panel and grid fill in as git answers. The driver waits 6s; raise `--settle`
  for a big repository (17.7k commits still lands inside it).
- **The driver edits your real settings file** (`~/Library/Application Support/
  gitext/config.json`) to choose the repository to open: the app opens `recentRepos[0]`
  and has no flag for it. It restores the file afterwards, so
  a setting you changed *during* the run is rolled back too. Pass `--keep-config` when
  the point of the run was to change a setting and see it persist.
- **Seed the setting you are testing.** Panel and grid state persists, so a run starts
  wherever the last one left off. Write `config.json` before launching (with
  `--keep-config` if the driver should not undo it) rather than clicking the app into
  position each time.

## Selectors worth knowing

```
.left-panel                 the panel
.left-panel .row            a node row; .row.section, .row.current, .row.selected
.left-panel button.sort     the sort button in the filter row
.left-panel .filter input   the filter box
.menu                       an open context menu (submenus are separate .menu elements)
.menu > .row                its rows; aria-checked carries a toggle's state
.grid .row                  a revision-grid row
```

The native **menu bar** is built in the main process and Playwright cannot click it. To
exercise a command that lives there, go through the command palette: the same registry,
a renderer surface, and it takes the same ids:

```bash
node .claude/skills/run-app/drive.mjs \
  "key Meta+p" "sleep 600" "type Refresh" "key Enter" "shot refreshed"
```

`.palette` is the palette itself, opened with `Meta+p`.

## When it will not launch

- `out/main/index.js is missing`: run `npm run build`.
- `Process failed to launch!`: `ELECTRON_RUN_AS_NODE` again, in whatever wrapper you
  added around the driver.
- A launch that hangs past 30s usually means the main process threw before opening a
  window; run the binary directly to see it:
  `./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .`
