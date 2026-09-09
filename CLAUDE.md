# gitext: working notes

## What this is

A Git GUI built as Electron + Vue 3 + TypeScript. **macOS is the target platform**, and
the only one anything is verified on. Windows is not a goal: well-served already, and
covering it is not what this app is for. Nothing goes out of its way to break Windows:
Electron runs there and the platform branches that exist stay, but it is not tested, not
a gate, and not a thing to raise as outstanding work. An earlier prototype once lived on
a `0.1.0` branch; it has been deleted and is not a reference.

This repo is indexed by CodeGraph: use `codegraph_explore` before grep/find or reading
files to understand or locate code.

Serena indexes it too, and answers a different question. CodeGraph is for finding your
way in: what an area contains, what calls what, what a change reaches. Serena works on
one symbol you can already name: `find_symbol` to read it without the file around it,
`find_referencing_symbols` before changing a signature, `replace_symbol_body` to rewrite
it in place. A `.vue` symbol sits under its block, so the path is `script setup/useDialog`
rather than `useDialog`.

**Never cite another project as the origin of this code.** No comment, doc or test
names one, or a symbol from one. State the rule this code follows on its own terms:
where it was borrowed from ages into archaeology about a file nobody here can read.
There is no exception.

[AGENTS.md](AGENTS.md) is the practical entry point for a new feature or bug fix:
its Status section names whatever is already in flight, read it before starting work
and update it as part of the work.

## The two rules that shape everything

1. **Every git operation is a `git` CLI subprocess.** No libgit2, nodegit, or
   isomorphic-git. Spawned with an argv array: never a shell string.
2. **The user can always see what git ran.** Dialogs preview the command before it
   runs; the command log shows every invocation with its output. This works because
   a command's `buildArgs` produces the argv, and *both* the preview and the runner
   consume that same array. Never build a display string separately from the argv.

## Stack

Electron 38 · Vue 3.5 (`<script setup>`) · TypeScript strict · Pinia · electron-vite
(Vite) · Vitest. Deliberately small dependency set.

## Commands

```bash
npm run dev        # electron-vite dev with HMR
npm run build      # bundle main + preload + renderer to out/
npm test           # vitest (unit + integration against real git)
npm run typecheck  # tsc for main, vue-tsc for renderer
npm run eslint      # Allman braces, no ternaries: enforced, not just styled
npm run fixture:commit  # build a repo full of awkward diffs for the commit screen
npm run fixture:automerge  # build a repo of conflicts for the word-level auto-merge
npm run test:e2e            # the whole driven suite: the built app, under Playwright
npm run test:e2e:commit     # every commit-screen action, checking before against after
npm run test:e2e:dialogs    # every operation dialog, from a real entry point
npm run test:e2e:conflicts  # merging, and every way it stops
npm run profile     # CPU-profile the renderer through one named scenario
```

`npm run profile -- --list` names the scenarios; `-- --repo <path> --scenario scroll` runs
one. It exists for the gap the diagnostics timeline cannot close: that log times whole
operations, and a cost paid *per frame* is invisible to it. `formatAbsoluteDate` was 44us
called forty times a render, 189ms of a scroll and not one entry anywhere. Adding a
scenario is adding an entry to `SCENARIOS`, never a branch in the runner.

The fixture is named for what it covers: the commit screen's cases, not a general demo
repository. `-- --force` rebuilds it, `--conflict` leaves a merge unresolved, `--big` adds
300 files, `--path <dir>` moves it. Default is `../gitext-commit-fixture`.

## The driven suite

`e2e/` is the app driven for real: the built application launched under **Playwright**
(`@playwright/test`, `_electron.launch`), one spec per subject, every assertion read back
out of git with the CLI. Build first, since it runs from `out/`.

Three rules, and they are why this exists at all:

- **Drive real entry points.** The command palette resolves through the same registry
  every menu does. Never a URL.
- **Assert against git, not the screen.** A dialog that has gone wrong will happily close
  as though it worked.
- **Wait on conditions, not on the clock.** A locator assertion retries until its timeout,
  so a passing run never spends it, and `expect(fn).toPass()` does the same for a reading
  of git. `settle(ms)` is what is left: the handful of moments with nothing observable to
  watch, scaled to 35%. `GITEXT_SLOW=1` takes them in full, which is the first thing to
  try when a step is flaky and the question is whether it is a race.

  **Prefer the condition to `settle`**, and the condition is usually the step's own next
  assertion: a pause after a click that is followed by a reading of git wants
  `expect(() => expect(repo.…)).toPass()`, which returns the moment it is true. This is
  not a style point. Fixed pauses were **59s of a 122s run**; converting the ones with a
  condition underneath took the suite to **84s** with nothing else changed.
  `GITEXT_SETTLE_REPORT=1` prints how long each spec spent asleep, and
  `GITEXT_SETTLE_SCALE=<n>` overrides the scale, which is how to tell a suite that is slow
  because the app is slow from one that is slow because it is sleeping.

  **A gate has to be the whole condition, not a sign of it.** Waiting for a list to have
  *some* rows before pressing a command that acts on all of them presses it against a
  list still filling: wait for the count git says it should have. The one pause that
  survives in `commit-screen.spec.ts` is there because the gap it covers, between a list
  being drawn and the store behind it being ready, is the one thing the screen does not
  report.

**Everything shared lives in `e2e/support/`**, and a spec is a fixture name, a list of
tests, and nothing else: `app.ts` (launch, and which window is which), `dialog.ts` (the
form primitives), `palette.ts`, `panel.ts`, `grid.ts`, `commitScreen.ts`, `conflicts.ts`,
`console.ts`, `repo.ts` (git, read directly), `settings.ts`, `tour.ts` (the `test` every
spec imports). Anything written twice across two specs belongs there instead.

`platform.mts` is the one module in there the suite does not have to itself: where the
settings file lives, which Electron binary to run, what a launch must fix in the
environment, and which console messages are noise. The `run-app` skill's driver launches
the same app and needs the same answers, so it imports this file too: `.mts` because that
caller is an ES module run by plain `node` while a spec is compiled to CommonJS, and the
explicit extension is what settles the module type for both. It takes the repository root
as a parameter rather than finding it, since those two callers find it by different means
(`import.meta.dirname` against `__dirname`).

**Files run beside each other, steps inside one do not.** `fullyParallel` is off, so a
file's steps stay in order; `workers` is 3, so three files are in flight at once. Nothing
is shared between them: each has its own fixture repository, its own app, and its own
`--user-data-dir`, which is where that app's settings and its lock file go. That is also
why the dialog steps are three files (`dialogs-branches`, `dialogs-worktree`,
`dialogs-history`, all built from `buildDialogsRepo`): as one file they were 45 of the 75
steps and no number of workers can divide a file. Three workers rather than five: each app
is four processes driving real git, and five at once starved each other into timing out.

**One app and one repository per spec file**, held in a worker fixture. The tests in a
file are steps of a sequence that each move that repository, so `fullyParallel` is off and
there is one worker. They are deliberately **not** `describe.serial`: most steps build the
state they need, and skipping the rest of a file to learn about one failure throws away
the answer for forty dialogs. Every step is written to stand alone, so `-g "<name>"` proves
what it proves in sequence. Adding a spec is adding a row to `REPO_BUILDERS` in
`e2e/fixtures/index.ts`, never a branch in the runner: a builder cannot be passed through
`test.use`, because Playwright reads a function in a fixture value as a fixture *factory*.

**Timeouts are 8s**, everywhere: `expect`, `actionTimeout`, and the window waits. That is
what the old harness's `until` waited, and it is long enough for git to answer through two
IPC hops and short enough that a genuine failure reports rather than sits. `actionTimeout`
matters as much as `expect` and defaults to 30s if left alone. Tracing is **off** unless
`GITEXT_TRACE=1`: `retain-on-failure` has to record every test to be able to keep the
failures, and against a Monaco renderer that is the most expensive thing in the run.

**Clicks are dispatched, not real** (`Dialog.press`: `toBeEnabled()`, then
`dispatchEvent('click')`). A real click hit-tests, and every dialog puts a `.scrim` over
its form while a confirmation is up, so the button underneath is visible, enabled, stable
and still un-hittable: the click then retries until it times out. The app does not care,
its handler is a `@click`. The wait that matters is kept, so a button disabled until git
answers is still waited for. **Two exceptions, where the realness is the thing under
test**: the conflict editor's block toolbars (raw DOM under a Monaco layer that hit-tests
as opaque, so they can draw perfectly and take no clicks) and the grid's modifier-held
multi-select. The commit message box is a third: Monaco takes focus from the mouse event.

**A field is filled *and committed*** (`fillAndCommit`): `fill` sends `input`, which is
what `v-model` reads, and that is not the whole contract. A field that rewrites what you
typed does it on the way out, and the branch-name normaliser is on `@blur`. Dispatched
rather than `locator.blur()`, which calls the native method and fires nothing unless the
element still holds focus.

**`expectedTitle` is the dialog's `<h2>`, not its window title.** They differ for a third
of the dialogs: the *Reset Changes* window is headed "Reset all changes", *Edit File* is
headed "Edit .gitignore", *Delete Remote Branches* is headed "Delete Branches on origin".

**A pane a step reads has to be pinned open, not inherited.** The seed starts from the
machine's own settings, and the panes are preferences: a config with
`showCommitDetails: false` in it, which is just somebody who closed the pane, takes the
file list and the diff away with it, and three steps then fail saying the file list has no
row for their file. `PANES_OPEN` in `e2e/support/settings.ts` pins those, because every
spec drives that one window; a spec's own `seedSettings` is for what its *dialogs* open
from. The seed is written into the developer's **real** settings file and restored
afterwards, on a signal handler too, since Ctrl-C would otherwise leave the app configured
the way a spec wanted it.

**It measures every dialog it opens** (`Dialog.expectFits`). A form whose body scrolls has
outgrown the display, and so has one measuring over **700px**, whatever the display it ran
on can take: the machine a change is written on is the biggest one it will ever meet, and
700 is the smallest current Mac laptop worked backwards through the 92% ceiling and the
fit's headroom. `fixedHeight` windows are excluded from both, since scrolling is what that
flag means. Opening every dialog is something only this suite does, so it is the one place
the check can live.

`e2e/conflicts.spec.ts` covers merging and every way it stops, which is its own subject
rather than one of the dialogs' steps: a list whose rows carry their own actions, a
three-way editor in a window of its own, a word-level merge that settles blocks git could
not, and four operations (`merge`, `rebase`, `cherry-pick`, `am`) that each hide the
incoming side somewhere different and **invert what "mine" means**: mid-rebase the
replayed commit is your own. Three things only it can see: a command that ends in
conflicts must raise the resolver itself, which is a hand-off between two windows
belonging to neither; a conflict made with **raw git, outside the app** must raise it just
the same, and an operation ended outside the app must close it, which takes a repository
moving underneath a running window to observe at all, so every step here makes its
conflict with git and waits for the window rather than opening one; and the editor's block
toolbars can draw perfectly and take no clicks.

The three `e2e/dialogs-*.spec.ts` files are the same idea for the dialogs, and exist for what unit tests
structurally cannot reach: a dialog is a separate window with a store of its own, opened by
a message to the main process and filled in from a payload, so everything between "the menu
row was clicked" and "git ran" only shows up when it is driven. Each step opens the dialog
through the palette, reads the preview, reads git before and after, and asserts the delta.
Traps it already knows: the palette keeps its last query, so the input is cleared before
typing; a step asserts against where a ref *was* rather than where it might already have
been; `openViaPalette` **clicks the row whose label the step named** rather than pressing
Enter on whatever ranked first, since two commands can share a prefix and which leads
depends on a `when` an earlier step may have made true (it throws when the label matches
two rows, the invariant `menu.test.ts` also guards); and **a selection has to hold, not
merely land**: `selectCommit` waits for the row to carry `primary` (which is what a payload
reads, `selected` being the multi-selection) and then waits again to see it is still there,
because the grid's reveal arrives with the batch it was asked for, long after the operation
that asked, and overwrites a click that had already won.

`e2e/commit-screen.spec.ts` performs every action the commit screen offers, reading git
before and after. The screen is a **window of its own**, so it is addressed like any other
dialog; `openCommitScreen` hands back the one already open, and a step run alone opens one
for itself. It will only reuse a window that is still there a moment later: committing
closes the screen, and a step that runs while that is in flight would otherwise fail on its
first keystroke with "target closed". Escape closing the screen is the same story from the
other side, and the press that causes it is allowed to go unacknowledged.

**Nothing is drawn in the app under test.** Reporting is Playwright's; a trace carries every
action, the DOM at each one and the console, which is strictly more than an in-app overlay
ever did. A run stays off the front (`GITEXT_BACKGROUND=1`, see `main/background.ts`):
windows are built but never shown, because showing one activates the application and a run
opens dozens. Playwright talks to the renderer rather than to the window server, so
everything works either way; `GITEXT_WATCH=1` shows them.

## Layout

```
shared/     contract.ts (IPC channels + types), types.ts (domain types),
            parents.ts (`%P`, which both sides parse),
            diff.ts (the { from, to } pivot + argv), grep.ts (the git grep
            argv + hit types), dialogs.ts (dialog names, payloads, window
            sizes), dialogBounds.ts, confirmations.ts:
            used by main AND renderer
main/       index.ts, menu.ts, preload.ts, settings.ts, watcher.ts,
            dialogs.ts (the dialog windows)
  git/      runner.ts, parse.ts, repo.ts, env.ts, log.ts, diff.ts, grep.ts,
            facts.ts
  ipc/      register.ts (how a handler is registered: `handle`, `handleWrite`),
            handlers/ (one module per subject), index.ts (calls them, plus the
            main-to-renderer event streams)
renderer/
  api.ts            typed window.git + error normalization
  gitConsole.ts     whether a run is streamed, and to which console window
  collapsedFolders.ts  which folders a tree view is hiding, for the lists that fold
  pathSelection.ts  picking paths in a file list: one, several, a range, a folderful
  main.ts           the repository window's entry
  dialog.ts         the dialog windows' entry (dialog.html → DialogHost.vue)
  model/            pure, DOM-free logic that only the renderer uses: graph/
                    (revision-graph layout), patch.ts (unified-diff parser),
                    args/ (the git argv tables), artificial.ts, sha.ts,
                    stagePatch.ts
  commands/         registry.ts (defineCommand) + index.ts (definitions);
                    file/ (what a file command acts on, and the three groups
                    of them: changes, tracking, opening)
  composables/      useCommands (hotkeys, menu dispatch), useDialog
  dialogs/          routes.ts: dialog name → the import for its component, + props
  stores/           repo, settings, commandLog, ui, diff
  components/       revisiongrid/, leftpanel/, details/, filelist/, diff/,
                    toolbar/, transparency/, dialogs/ (+ dialogs/parts/), ui/
  styles/           tokens.css (light + dark), global.css (base elements +
                    app-wide classes), listRow.css / paneBar.css / manageList.css /
                    splitDialog.css / dialogSection.css / controlText.css
                    (per-component partials, pulled in via <style scoped src>)
```

`shared/` is for types and logic that genuinely cross the IPC boundary: both `main`
and `renderer` import them. `renderer/model/` is for logic that is just as pure and
DOM-free but only the renderer ever calls; nothing under it may import from `main/` or
touch `window`. `artificial.ts` looks like it belongs in `renderer/model/` too, but
`shared/diff.ts` calls into it to build `git diff` argv for the working tree and index
endpoints, and `main/git/diff.ts` runs that at request time: so it stays in `shared/`.

## Adding a dialog

[`docs/DIALOGS.md`](docs/DIALOGS.md) is the full reference: the payload rule, the argv
tables, `useDialog`, the form primitives, sizing exceptions, wording rules, and how to
write the driven step. This is the checklist.

- Add its name to `DialogName` and `DIALOG_WINDOWS` in `shared/dialogs.ts` (title,
  opening size), its route and payload-to-props mapping to
  `renderer/dialogs/routes.ts`, and open it with `ui.openDialog(name, payload)` (a
  `dialog:open` message, not renderer state). **A route is an import, never a component**:
  `dialog.html` is one bundle for every dialog in the app, so a static import puts all
  fifty forms in front of the one window being opened. `DialogHost` starts the loader at
  setup, so the fetch runs beside the bootstrap rather than behind it.
- Take the operand from props, never from a selection. Build its argv in
  `renderer/model/args/`, so the preview and the run consume the same array.
- **Writes no CSS.** `DialogFrame` + the `components/ui/` form primitives cover it; see
  the CSS section below. Writing `.row { display: flex }` means rebuilding `FormRow`,
  which is how all 27 dialogs once drifted apart.
- **Opens on the common case.** One or two fields; everything else goes behind a
  `FormDisclosure` whose `summary` is built from the argv (`flagsIn` in
  `renderer/model/args/summary.ts`), so it can't drift from what runs.
- **Writes no run logic.** `useDialog()` owns busy/error/refresh/close and raises the
  conflict resolver on its own:

  ```ts
  const { busy, error, run } = useDialog();
  const argv = computed(() => ['merge', ...(noFf.value ? ['--no-ff'] : []), ref.value]);
  ```
  ```vue
  <button class="primary" :disabled="!ref || busy" @click="run(argv, HISTORY_MOVE)">Merge</button>
  ```

  `runSteps([{ label, argv }, …], facets)` for several commands; `perform(label, work)`
  for work through its own channel instead of `git:run`; `{ close: false }` to keep the
  dialog open.
- **Long or remote work is watched in a console window.** `renderer/gitConsole.ts`
  decides: anything talking to a remote (`push`, `fetch`, `pull`, `clone`, `remote
  prune`) always gets one, read off the argv so a new call site cannot forget; anything
  else follows the `streamLiveOutput` setting, and `{ console: true }` forces it for
  local work whose point is watching it (`gc`). Those runs stream through `stream:start`
  instead of `git:run`, and fail with a `ConsoleFailure`: a one-line message for the
  form's error label, git's own words on `.output` for a dialog that must decide on them
  (`useDialog`'s `failureOutput`, which is how `PushDialog` tells a rejection from a
  refusal). The dialog's own behaviour is unchanged: it still awaits, still closes on success. Writing `busy.value = true` inside `try/catch/finally` means rebuilding
  `useDialog`.
- **Declares what it invalidates.** The facets argument (`RepoFacet[]` from
  `shared/invalidation.ts`) is positional and required. See "How a window learns the
  repository moved" below.
- **Sizing is automatic**, never hand-tuned: `DialogFrame` measures its content and
  `main/dialogs/fit.ts` sizes the window to it. A form that would scroll needs a
  different layout, not a resize: see `docs/DIALOGS.md`'s `fixedHeight` and
  `fullWindow` exceptions before reaching for either.
- Gets a step in one of the `e2e/dialogs-*.spec.ts` files, exercising every entry point
  that opens it.

## How a window learns the repository moved

Every mutating operation declares what it touched, as a set of `RepoFacet`s
(`shared/invalidation.ts`): `head`, `refs`, `commits`, `worktree`, `index`, `stashes`,
`remotes`, `submodules`, `worktrees`, `config`. Two ways to declare, and never a third:

- **`git:run` takes the facets as a required argument.** That one channel carries argv
  from every dialog, so it is the only place that can be made to ask, and the caller that
  built the argv is the only one that knows what the operation is for.
- **A typed write channel declares them once, beside itself**, via `handleWrite` in
  `main/ipc/register.ts`: `stage:applyPatch` is `['index']`, `file:delete` is
  `['worktree', 'index']`. Each of those does exactly one thing, so what it invalidates is
  a property of the channel.

**Never infer facets from argv.** A table in `main` that sniffed the argv was written and
thrown away: it re-derives intent the caller already had, and it cannot tell `branch
--list` from `branch -d` or `stash list` from `stash push` without re-implementing git's
option parsing.

`main/ipc/repoChanges.ts` coalesces everything announced within 50 ms into one
`event:repoChanged`, composite operations are the norm, and `buildCheckoutSteps` alone is
up to three commands. **It also holds the announcement while a write is still running**
(`beginWrite`/`endWrite`, taken and released by `writeStarted`/`writeFinished` in
`register.ts`): 50 ms covers the gap between two commands, one IPC round trip, and
nothing like a `git checkout` over a large working tree, so without the hold each command
of an operation announced on its own and every window reloaded once per command. The `.git` watcher still runs, for changes made *outside* the app,
and reports `ALL_FACETS` because that is all it knows; it stays quiet for about a second
after the app's own write, since that change was already announced exactly. It watches
every directory `resolveWatchedGitDirs` names, which in a linked worktree is **two**: that
worktree's own directory holds `HEAD`, `index` and any in-progress operation, while refs,
`config` and `packed-refs` live in the shared one.

On the renderer side `useRepoInvalidation.ts` holds the decisions (pure, unit-tested) and
`useRepositoryRefresh.ts` wires them to the repository window's stores. **Main says what
changed; the renderer decides what to reload**: main cannot know the current branch scope,
so it says `head` and `needsLogReload` works out whether the grid's query depends on it.
Under the default scope a checkout changes no commits, so the grid redraws from the repo
store without re-running `git log` at all.

Two traps already paid for:

- **`head` reloads the left panel.** Which branch it marks as current is
  `RefEntry.isCurrent`, filled in by `git for-each-ref`: a property of the *ref list*, not
  of the repo store. Without it a checkout left the panel bold on a branch it was no
  longer on.
- **`view.refresh` (F5) means everything.** It used to be `repoStore.refresh()` alone and
  appeared to reload the grid only because a watcher in `App.vue` compared a freshly-built
  array with `Object.is`, so it fired on any store change: re-streaming the log three
  times per tick, which is what made the window flash. Watch an *array of getters*, never
  one getter returning an array.

## Adding an IPC channel

Add it to `Invocations` in `shared/contract.ts`, then to the `INVOKE_CHANNELS`
array below it (a compile-time check fails if you forget), then register a handler
in the `main/ipc/handlers/` module whose subject it belongs to (`index.ts` calls
each module's registrar, and `register.ts` holds the four ways to register one).
Preload and renderer types follow automatically: there is no third list to update.

## Adding a command

```ts
defineCommand({
  id: 'branch.merge',
  label: 'Merge…',
  group: 'Commands',
  keys: ['Mod+M'],           // fixed; hotkeys are not user-configurable
  when: (c) => c.hasRepo,
  buildArgs: (o) => ['merge', ...(o.noFF ? ['--no-ff'] : []), o.ref],
  run: (o) => { /* open a dialog, or run buildArgs output */ }
});
```

The menu bar in `main/menu.ts` dispatches command ids; unregistered ids surface a
toast rather than failing silently. Menus, toolbar, context menus, palette, hotkeys,
and the odd in-panel control (the left panel's sort button) are all renderings of this
registry: never wire an action anywhere else. A control that opens a list of commands
resolves it through `resolveMenu` and runs it through `runCommand` like any menu does.

**Which surface offers a command is a decision.** A context menu carries what you are
doing (the revision grid's is 13 rows, one level deep); a menu bar carries lists you
consult (all the View toggles); the left panel owns actions whose operand is a ref.
`tests/renderer/menu.test.ts` (`command homes`) fails if a declared command is offered nowhere,
or is listed as living elsewhere while still sitting in a menu: so add a command to a
menu, or add a line saying which surface has it and why.

**A label has to stand alone in the palette.** A menu row can lean on its surroundings:
the left panel's `ref.merge` needs no more than "Merge into Current Branch…" because you
right-clicked the branch. The palette shows a group and a label and nothing else, so two
commands sharing both are two identical rows and picking one is a coin toss. That is why
the grid and panel variants of one operation are named apart (`branch.merge` is "Merge
**This Commit** into Current Branch…", `ref.push` is "Push **This Branch**…", beside
`revision.createBranchHere`'s "Here"). `menu.test.ts` fails on a clash; the trailing
ellipsis means "opens a window" and does not count as a distinction.

## Conventions

- `main/git/*` functions take `repoPath: string` first and are plain async
  functions. No god-object.
- Only `runner.ts` spawns. Use `runGit` / `tryGit` / `streamGit`.
- `tryGit` for genuinely optional reads (ahead/behind, upstream); let `runGit`
  reject everywhere else and surface the stderr.
- Parsers consume `-z` / `--porcelain=v2` output. Never split on newlines: commit
  messages, branch names, and paths all contain them.
- Never `alert` / `confirm` / `prompt`. Use `ui.confirm` / `ui.confirmUnlessSuppressed`
  and `ConfirmDialog`; an operation dialog is its own window built on `DialogFrame`.
- All colours come from CSS custom properties in `tokens.css`. Two themes, light
  and dark; no colour or font customization.
- English only. No i18n layer.
- **A control character in a string is written as an escape, never as the byte itself.**
  `'\x00'`, not a literal NUL. NUL separators are right and this code uses them: paths
  contain newlines, but a file carrying one raw reads as *binary* to everything that
  guesses: `git diff` says `Binary files differ` (which `.gitattributes` now overrides,
  see the note there) and `grep` either reports a match with no line or skips the file
  outright, so it silently answers no search. `tests/sourceIsText.test.ts` fails on one.
- **No em dash, and no en dash.** Anywhere: UI text, comments, docs, commit messages.
  They join two clauses without saying how the two relate, so a sentence carries three of
  them and still commits to no order of thought. Write the punctuation that says
  something: a **colon** where the left side introduces the right (`--no-ff: always
  records the merge`), a **comma** for an aside or a relative clause, **two commas** for a
  bracketed one, a **full stop** for two statements. The one job a hyphen genuinely cannot
  do is separating items on a single line, and the mark for that is the **middot**
  (`main · 50 changed`), which is prose punctuation nowhere.
  `tests/noEmDash.test.ts` fails on either dash.
- **Git tokens in UI text go in backticks.** A flag, a command, a config key, a path, a
  branch name: `` `--no-ff` ``, `` `stash push -u` ``, `` `.gitmodules` ``. `CodeText`
  renders a backticked span as `<code>`, which `global.css` sets in `--font-mono`, so it
  reads as a token rather than as a word with two hyphens stuck to the front. Four
  surfaces render through it, so the mark works in all of them: a hint (`HintText`), a
  `FormRow` / `FormCheck` / `FormRadioGroup` label, a confirmation's message, and a toast.
  A window title does not, and neither does a `title` attribute or an `aria-label`: no
  markup renders there, so write those plain, or pass `plainText` of the marked-up string.
  In a template, a ref or path interpolated into prose goes in `<code>`, not `<strong>`:
  emphasis is not the same claim as "this is a name".
- **The backticks mark the token, never the words around it.** `` `git accepts` `` sets
  two English words in the code font, which is the same defect as leaving `--force` in the
  prose one, read from the other side. Mark what you would type at a shell.
- **UI text is read at a glance.** A label names the thing and never explains it; the
  explanation is the `hint` beside it, and a hint is a flag plus at most one short clause.
  Nothing a user reads runs past about 80 characters: not a label, not a hint, not the
  body of a confirmation. If a second sentence seems necessary, the first one is wrong.
- Never write the local machine's username or absolute home paths (`/Users/<name>/…`,
  `C:\Users\<name>\…`) into code, docs, tests, comments, or commit messages. Use
  repo-relative paths, or `~`/`%USERPROFILE%` when a home path is genuinely meant.

## CSS

Every component owns a `<style scoped>` block: that's the right default, and it's why
this app doesn't need a component library or a CSS-in-JS layer. But scoped means each
block starts from nothing, so a rule two components both need is one either author can
write out again without ever seeing the other copy. **A component is a duplicate rule you
cannot write twice**: so before reaching for any of the shared stylesheets below, check
whether the thing being styled already has a component. Four places, in the order to try
them:

### 1. A `ui/` component, if the thing has one

`components/ui/` holds the shapes that repeat: `DialogFrame`, `ContextMenu`, `RefChip`,
`CodeText`, `HintText`, `FormRow`, `FormText`, `FormNumber`, `FormSelect`, `FormCheck`,
`FormRadioGroup`, `FormGroup`, `FormDisclosure`, `FormCheckList` (a scrolling box of
checks), `LineStats` (`+12 −3`, what a change did in lines), `SegmentedSwitch` (one question drawn as a joined row of buttons), `Twisty` (a
foldable row's chevron), `ListShapeButton` (the file list's list-shape menu button), and
`Glyph` / `GlyphShapes` (an icon more than one surface draws, from the table in
`glyphs.ts`). **A dialog form is built from these and writes no CSS of
its own.** Most operation dialogs now have no `<style>` block at all:

```vue
<div class="form">
  <FormText v-model="name" label="Branch name" placeholder="feature/my-branch" />
  <FormSelect v-model="remote" label="Remote" :options="remotes" />
  <FormCheck v-model="noFF" label="No fast-forward" hint="--no-ff" />
  <CommandPreview :argv="argv" />
  <p v-if="error" class="error">{{ error }}</p>
</div>
```

`FormRow` sets the label column once, so every dialog lines up with every other. A hint
is a prop, not a `<p>`, and on a `FormCheck` it is where the git flag goes (`--no-ff`):
teaching the command line is the job. It sits *beside* the label while there is room and
under it when there is not (`controlText.css`), which is what lets a wide dialog spend
width instead of height: see the budget below. `FormText` is monospace by default because a branch
name or path is read character by character; pass `:monospace="false"` for prose like a
stash message. Enter and initial focus are handled window-wide in `useDialogKeyboard`, so
a field needs neither `@keydown.enter` nor `autofocus`.

This is the rule that was most expensive to learn: these primitives existed and *all 27
dialogs bypassed them*, each hand-rolling `.form`/`.row`/`.row > span`/input CSS. The
label column had drifted to eight different widths. If a control needs something the
primitives don't do, add a sibling component (`FormNumber` was added exactly this way:
min/max/step don't belong as branches inside `FormText`), never a local copy.

### 2. `renderer/styles/tokens.css`: every value

Every colour, and the space/radius/font scale. Component styles never hard-code a hex
value, an `rgba()`, or a raw pixel size a token already names. Add a token before adding
a colour.

### 3. `renderer/styles/global.css`: base elements + app-wide semantic classes

Base element styles (`button`, `input`, `textarea`, the scrollbar) that apply untouched
everywhere, plus small classes for something the whole app says:

| class | what it means |
|---|---|
| `.truncate` | the `overflow`/`text-overflow`/`white-space` ellipsis idiom |
| `.form` | a dialog's vertical stack of rows |
| `.hint` | the explanatory line beside or under a control |
| `.error` / `.warn` / `.success` | the one-line outcome under a form |
| `.placeholder` | a line standing in for content that is not there |
| `.placeholder.error` | that line when it is bad news, which `.error` alone cannot say |
| `.form.fills` | a form meant to take the window, for a dialog that is mostly an editor |
| `.spacer` | the empty flex child that pushes what follows to the far end |

Add the class in the template next to whatever class already styles the element, and drop
those properties from the element's own scoped rule. A component that wants it denser
still overrides from its own block, which wins on specificity.

**Name the class for what it means, not what it looks like, and check the name is free.**
`.placeholder` is deliberately not called `.note`: `.note` was already a git note in
`CommitDetails` and a callout in `DangerNote`, and a third meaning on a *global* class
would have reached both. Likewise `.warn` is amber because an option will cost you
something; a neutral "Delete branch X?" prompt is a plain `<p>`, not a `.warn`.

### 4. A partial under `renderer/styles/`, pulled in per component

For when what's shared isn't a loose property cluster but a whole selector's worth of
meaning on a class each component already owns: `.row:hover`, `.row.selected`. Write it
once as its own file and pull it into each component with
`<style scoped src="@renderer/styles/<name>.css">` *above* that component's own
`<style scoped>` block. Vue compiles the import with the importing component's own scope
hash, so it behaves exactly like a second scoped block: no template change, and anything
the component adds afterward still wins the cascade at equal specificity. A component may
import more than one.

- `listRow.css`: hover + selected background (`RevisionGrid`, `LeftPanel`,
  `StagingList`, `ChangedFiles`)
- `paneBar.css`: the strip across the top of a content pane (`DiffViewer`,
  `BlobViewer`, `ChangedFiles`)
- `manageList.css`: the reset `<ul>` of rows a collection dialog is made of, and the
  master column's `.list.side`
- `splitDialog.css`: the two-column dialog itself, a list that picks the operand beside
  a pane that acts on it (`ManageRemotes`, `ManageSubmodules`, `ManageWorktrees`,
  `Fsck`, `ViewPatch`)
- `dialogSection.css`: the heading over a titled block of settings
- `monacoHost.css`: the box a Monaco editor fills, and the editor that is mounted but
  showing nothing
- `factList.css`: a `<dl>` of names and values, the values in the code font
- `conflictSummary.css`: the "N conflicts remaining" line both conflict windows draw
- `controlText.css`: a label and its hint, side by side while there is room

### When not to extract

Two rules that read as the same idea but fire under different conditions are not a
duplicate. `.row.primary` (StagingList, ChangedFiles: on whenever a row is primary) and
`.row.selected.primary` (RevisionGrid: only when primary is also in the multi-select)
style the same accent bar but stay separate on purpose: merging them would silently
change one component's behaviour to match another's. Same for `.bar`: three panes share
one, but `StatusBar`'s window footer and `CommitDetails`' fixed-height header keep their
own. Extract the declaration only when the *trigger* is identical too.

Threshold, same as SOLID below: two or more files with the identical rule is worth
extracting; a single occurrence, or two that only *look* alike, is not. Apply this
incrementally when adding or touching a component's styles, not as a standalone sweep.

## SOLID

Binding for every file, new or existing.

- **Single responsibility.** One file, one reason to change. A store, component, or
  module that is state *and* I/O *and* selection arithmetic *and* git-argv building is
  four reasons: split it into composables/functions with one job each, composed back
  together at a thin top level. 200 lines is the smell threshold, not the rule: a file
  past it needs a reason it is still one responsibility, not a pass.
- **Open/closed.** Add behavior by adding a case to a table (`sides`, `defineCommand`,
  `DIALOG_WINDOWS`) or a new small function, not by growing an existing function's
  branches. If a change means editing a big `switch`/`if` chain instead of adding an
  entry somewhere, the shape is wrong.
- **Liskov substitution.** Anything implementing a shared shape (a parser, a dialog
  component's props contract, a `SideState`-like table entry) must be swappable for
  another implementer without the caller special-casing which one it got.
- **Interface segregation.** Composables and modules expose only what their callers
  need. Don't hand a component the whole store when a `computed` and one function
  would do; don't widen a function's parameter type just to satisfy one caller.
- **Dependency inversion.** `main/git/*` and `renderer/model/*` stay dependency-light
  and take what they need as parameters rather than reaching for a store or `window`.
  High-level orchestration (a store, a screen component) depends on these low-level
  pure modules, never the reverse.

Guideline, not lint-enforced: judgment calls get a comment saying why the shape is
right, the way the rest of this codebase already documents its non-obvious decisions.
Refactor toward this incrementally: don't break behavior or tests to hit a shape.

**Write the rule, not the war story.** A comment says why the code is the shape it is, in
the present tense. It does not recount what an earlier version did, when the bug was found,
how many runs in ten it failed, or who found it: that history is in the git log, and a
comment that carries it ages into a puzzle about code nobody can see. "A lane is a
position in this list, so an empty one is not a thing it can hold" earns its place;
"this used to leave gaps, which looked wrong, so now…" does not. Same fact, no
archaeology.

### Domain values get a domain type, not a bare primitive

Binding for every file, new or existing. A bare `string`, `string[]`, `Record<string,
…>` or `Map<string, …>` that represents something in the domain: a path, a SHA, a
branch name, a line key: tells a reader nothing at the signature: `unstagedOrder:
string[]` could hold anything. Give it a branded type instead:

```ts
export type FilePath = string & { readonly __brand: 'FilePath' };
export function toFilePath(path: string): FilePath { return path as FilePath; }
```

- A branded type is still a `string` for every *reading* purpose: passing one where a
  plain `string` is expected (a git argv, a prop typed `string`) needs no unwrapping.
  Only *building* one from a plain `string` needs the cast, through a named `toX`
  function: never a bare `as X` scattered through the code that already has one.
- Brand at the boundary a value crosses *into* the domain: a component reporting what
  it drew, an IPC result, a parsed git line, not at every place that already holds one.
- A free-text value (a commit message, an error string, anything the user typed) stays
  a plain `string`: branding it would document nothing a reader doesn't already know
  from the name.
- `Record`/`Map` keyed by a real domain union (`Record<StagingSide, …>`) already satisfy
  this; keying one by a bare `string` where the key is actually a closed set is the same
  complaint as an unbranded `string[]`.
- See `renderer/model/paths.ts` (`FilePath`) and `renderer/stores/staging/patch.ts`
  (`LineKey`) for the pattern, and `renderer/pathSelection.ts`'s `PathSelection<P>` for
  making a shared generic module carry whichever domain type a caller has.

Guideline, not lint-enforced, same as the rest of this section: apply it going forward
and when touching a file for another reason, not as a standalone sweep.

## Explicitly out of scope

Plugins, bug reporter, language analyzers, text completion, spellcheck,
internationalization, avatars, colour/font customization, hotkey customization,
credential/auth manager and SSH/PuTTY tooling, build-server integration, scripts
engine, shell extension.

## Testing

- `tests/` mirrors the source split: `tests/main/` for `main/git/*` (parsers and
  real-git integration), `tests/shared/` for what crosses IPC, `tests/renderer/` for
  everything renderer-only, including `renderer/model/`.
- `tests/main/parse.test.ts`: pure parser units.
- `tests/main/git.integration.test.ts`: creates real repos in a temp dir and drives
  the real `git`. Nothing is mocked. Resolve temp paths with `realpath` first: git
  canonicalizes, and on macOS `/var` is a symlink to `/private/var`.
- Verify on macOS. That is the target platform; see "What this is".

**A component test mounts the real component, and opts itself into a DOM.** `@vue/test-utils`
over `happy-dom`, with `// @vitest-environment happy-dom` as the first line of the file:
per file, because almost everything here is a parser, an argv table or a store, and a DOM
none of them touch would cost every one of a hundred files the setup. `vitest.config.ts`
carries `@vitejs/plugin-vue` so a `.vue` import compiles at all, and stays on `node` by
default.

Reach for one when the rule under test **is** the wiring: what a component does at setup,
what it does when a store moves underneath it, what it emits. `ResolveConflictsDialog`
deciding it has nothing left to do is the case that earned the harness: it reads the store
once at setup and again on every change, and both readings had been wrong in ways no unit
test could see. Not for a rule that is really a function: extract it (`nothingToResolve`)
and test that directly, which is cheaper to read and cheaper to run. Mock `@renderer/api.js`
with the channels the component actually touches, and stub `ResizeObserver`: `DialogFrame`
observes its own content and happy-dom has none.

**Prove the test can fail.** A mounted component has enough machinery around it to pass an
assertion for the wrong reason, and three of these did before they were checked. Break the
rule in the component, watch the test go red, put it back. Four traps already paid for:

- **A pending promise needs a macrotask to stay pending honestly.** `ui.confirm`'s promise
  settles a few microtask hops after `answerConfirm` runs, so `await nextTick()` and then
  "it never resolved" is a test that passes whatever the component does. `setTimeout(…, 0)`
  first, then race the promise against a sentinel.
- **Mounting a dialog mounts its whole tree.** `CreateBranchDialog` reaches `repo:revision`
  through a picker three components down. An unmocked channel is an unhandled rejection,
  which vitest reports as an error against the run: *not* as a failing test.
- **A negative assertion needs its positive twin.** "The component is not rendered yet" also
  passes when the selector never matches anything; the test that waits and finds it is what
  makes the first one mean something.
- **Set the URL with `history.replaceState`,** not happy-dom's `setURL`: the standard API
  type-checks, and `DialogHost` reads `window.location.search` either way.
- **`enableAutoUnmount(afterEach)` in every file that mounts.** A component left mounted
  keeps whatever it bound to, a window listener, an observer, a request in flight, and
  goes on doing it against a store from a pinia the next test has replaced. Two ways that
  shows up: a `keydown` listener from an earlier test sits *earlier* in the listener list
  than the one under test, so the older component handles the key and calls
  `stopImmediatePropagation` (four of `useScreenKeyboard`'s cases failed that way, looking
  exactly like the component being broken); and async work finishing after its test ended
  surfaces as a run-level error with no test attached to it.

**Seeing it on screen is part of the work, not a bonus.** The tests cannot see a menu
row nobody can read, a section that silently vanished, or a keydown handler that ate
Enter: all three have happened here and all three were found by looking. Run the app
with the `run-app` skill (`.claude/skills/run-app/`): it launches the built app under
Playwright and drives it from one command, and it already knows the traps
(`ELECTRON_RUN_AS_NODE` is set in this environment and breaks Electron; there is no
`tmux`). It is the ad-hoc counterpart to `e2e/`: an arbitrary sequence of clicks and
screenshots rather than a committed spec, which is what makes it the thing to reach for
mid-change. Build first: the app runs from `out/`.

**A driven run never appears on screen.** The driver launches with `GITEXT_BACKGROUND=1`,
which `main/background.ts` turns into a hidden Dock icon and windows that are built but
never shown: so a check does not steal focus or drag a full-screen Space away from
whoever is at the keyboard. Screenshots and every read still work, because Playwright
talks to the renderer rather than to the window server. `--focus` on the driver, and
`GITEXT_WATCH=1` on the suite (which, like the driver, stays off the front by default:
showing a window activates the app, and a run opens dozens), move the line.

## Gotcha worth remembering

Since git 2.26 the merge backend handles all rebases, so `.git/rebase-merge/interactive`
exists for a plain `git rebase` too. It cannot be used to detect an interactive
rebase; `getRepoState` reports both as `'rebase'`.
