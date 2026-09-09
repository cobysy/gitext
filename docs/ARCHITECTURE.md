# Architecture

> Cross-cutting behavior the source doesn't say out loud. Not a restatement of
> [CLAUDE.md](../CLAUDE.md)'s two rules or directory layout; see [AGENTS.md](../AGENTS.md)
> for where to start.

## Decisions

- **Scale target: ~50k commits.** That's why the log streams instead of loading at
  once. The graph layout (`renderer/model/graph/`) is computed whole on every batch,
  which it can afford: one forward pass, about 18ms over 17.7k commits. No commit-graph
  file support. No off-thread layout.
- **Where a command lives (context menu, menu bar, left panel) is a deliberate
  choice**, not wherever was easiest to wire it. `tests/renderer/menu.test.ts`'s
  `command homes` fails if a command has no assigned home.
- **Windows isn't a target.** Covering a platform a different Git GUI already owns
  isn't what this app is for. `process.platform` branches stay where they exist, but
  nobody tests them.
- **`App.vue` always opens the last repository; no dashboard.** `WelcomeScreen.vue`
  shows only with no last repository, or a failed open. A repo-picker landing screen
  was rejected, not missed.

## Deliberately not built

Not "not yet": check why before reintroducing.

- Fixup/squash/amend/edit variants of reword.
- `commit.template` (built, then removed).
- Reflog viewer, bisect UI, rest of a hypothetical Advanced submenu.
- Grid sort beyond the graph's own commit order.
- In-app interactive-rebase todo editor (git's own `$EDITOR` handles it).

## Process boundary

- The renderer never touches git or `child_process`. `window.git` is the only door,
  built by `contextBridge.exposeInMainWorld` in `main/preload.ts` from the channel list
  in `shared/contract.ts`.
- Flow: `window.git.*` call → `ipcMain.handle` (`main/ipc/index.ts`) → a `main/git/*`
  helper → `main/git/runner.ts` spawns git → result or event sent back over IPC.

## IPC and Vue reactivity

- Electron structured-clones data across the boundary. A live `ref`/reactive object
  isn't safe to clone: it can throw, or silently arrive as a plain snapshot.
- `renderer/api.ts` unwraps reactive state to plain data before every IPC call.
  Forgetting this surfaces later as a clone error unrelated to the object that was
  actually reactive.

## Command log

- `runner.ts` is the only function that spawns git, so nothing can skip being logged.
- It publishes a `GitCommandRecord` on start, again as output arrives, and once more
  with `running` false on completion: always the same `id`.
- `main/ipc/index.ts` broadcasts each record to every window; `stores/commandLog.ts`
  upserts by `id`, so the log shows a command running, fills in as it prints, and shows
  it finish.
- [GIT-OUTPUT.md](GIT-OUTPUT.md) is the full path: one splitter, two transports, two
  windows, and why the second window is not a copy of the first.

## The left panel

- `renderer/panel.ts` is the pure, unit-tested model: the section list, its persisted
  arrangement, folding `feature/x` into folders, sorting, flattening to drawn rows,
  filtering. Pure and DOM-free, which is what turns an edge case like a remote whose
  own name contains a slash into an ordinary test assertion.
- `stores/repoObjects.ts` fans out the five reads with `Promise.all` and holds view
  state.
- `LeftPanel.vue` draws flat rows through the grid's own virtualizer: a benchmark repo
  has hundreds of refs, and an expanded Remotes section would otherwise put all of them
  in the DOM at once.
- A node's identity is a string (`branch:refs/heads/feature/x`), never a row index,
  same rule and reason as the grid's SHA-keyed selection: the panel reloads on every
  watcher tick, so an index would point at a different row a moment later.
- Commands split by whether they're built: `commands/objects.ts` declares the actions
  and imports only the registry (keeps `menus/leftPanel.ts` unit-testable);
  `commands/panel.ts` holds the ones that run, and imports the stores.

## One shared conflict handler, not per-dialog logic

Merge, rebase, cherry-pick, revert, and stash-pop can all leave a conflict behind. They
don't each check for that themselves: one function does, after every one of them,
`useAfterGitOperation`, reading `getRepoState`.

- Conflicts found → opens the Resolve Conflicts window itself.
- No conflicts, but an operation is still paused → no window, just the banner
  (Continue/Skip/Abort).
- Nothing in progress → does nothing.

Three rules that follow, worth knowing before touching this:

- **It reacts to any conflict, not just ones this app made.** A `git merge` run in a
  terminal, or opening a repo that's already mid-merge, opens the window too.
- **"Continue" isn't one command.** It's `commit`, or `rebase --continue`, or
  `cherry-pick --continue`, or `am --continue`, depending on which operation is paused.
- **Mid-rebase, "Mine" and "Incoming" become "Base" and "Mine".** That's because during
  a rebase, the commit being replayed is yours. It's intentional, don't "fix" it.

### The resolver's one known gap

- `watchForConflicts` opens the resolver when the conflict count goes from none to
  some, and closes it when the operation ends, wherever it ended. Both directions are
  driven by watching repo state, not by a command telling it to open or close.
- Gap: a `git merge --abort` run in a terminal ends the operation without conflicts
  ever having existed to trigger a some-to-none transition. A window left open can be
  left showing an operation that's actually already over.

## Reword's two shapes

- HEAD: `commit --amend --only -m <message>`.
- Below HEAD: `commit --only --allow-empty -m "amend! <subject>"`, then
  `rebase -i --autosquash --autostash <sha>^`.
- `--only` matters in both, else reword commits whatever's staged. Refuses a merge
  commit or a non-ancestor of HEAD; warns that descendants get rebuilt.

## Watching

- `chokidar` watches only the `.git` directory, not the working tree: that's where
  every git state change lands, and it avoids walking a potentially large tree.
- Object and lock file churn is ignored. Events are debounced 300ms, to let a batch of
  writes settle before `event:repoChanged` fires.
- The watcher exists for changes made *outside* the app (a commit in a terminal, a
  branch deleted by a script), so it reports `ALL_FACETS`: that's genuinely all it can
  know. It stays quiet for about a second after the app's own write, since that change
  was already announced precisely by the channel that made it.
- The working tree itself has no watcher. It's re-read on window focus
  (`event:windowFocus`), when a file changed by an editor or a build becomes worth
  asking git about again.

## Theming

- Two themes only. `tokens.css` declares every colour as a custom property under
  `:root[data-theme='light'|'dark']`.
- `nativeTheme` in the main process resolves the `system` preference and pushes the
  effective theme to every window over `event:theme`.

## Settings

- `config.json` (under `app.getPath('userData')`) is written with write-then-rename, so
  a crash mid-write can't truncate it.
- Anything that's genuinely git configuration (identity, merge tool, autocrlf) is read
  and written through `git config` instead of being shadowed in `config.json`: a second
  copy of a git setting is a second thing that can drift from the first.

### Settings vs the View menu

Both hold toggles, and they're not interchangeable:

- **View menu**: resets when the window closes. Ref visibility, artificial rows, which
  columns show.
- **Settings**: outlives the session. Date format, diff mode, file list shape.

A new toggle goes wherever it behaves, not wherever seems convenient.
`dialogBounds`, `gridColumns`, `leftPanelSections` are also persisted but have no
settings-page field: they come from dragging a window or a column, not from typing a
number.

## Testing gotchas specific to this codebase

- Pin commit dates in any fixture whose test asserts on log order. A fixture creates
  its commits as fast as the machine allows, so several can land in the same real-time
  second; `--date-order` then breaks ties however it wants.
  `tests/renderer/graph.integration.test.ts` sets a fixed
  `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` on every git call instead of relying on wall
  clock time.
- Assert by commit, not by row index, for the same reason: an index-based assertion is
  really testing the fixture's ordering, not the thing under test.
- Renderer logic that's DOM-free runs as plain Node tests
  (`tests/renderer/selection.test.ts`, `tests/renderer/format.test.ts`): no
  `happy-dom`, which is what keeps selection/formatting logic fast to test.
  `tsconfig.node.json` lists those files individually rather than globbing all of
  `renderer/`.
