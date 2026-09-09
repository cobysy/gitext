# Working here

> The practical entry point for new features and bug fixes: where to look, what to do
> first, how to verify. Conventions and directory layout live in [CLAUDE.md](CLAUDE.md);
> deep dives in [docs/](docs/). This file doesn't restate any of them, it routes to them.

## Status

**Nothing in flight.** The last piece of work was the revision graph.

What it is, in two rules that pull against each other:

- **The gutter stays packed and lines stay still.** A commit carrying one line onward
  gives its column straight back to the line it starts, so nobody moves; only a commit
  that opens or closes a column moves anyone, and then by one. A gutter that closes
  gradually instead has some line moving on nearly every row, and lines that are never
  quite vertical read as ribbons rather than lanes.
- **A line arriving from several columns away is drawn as a diagonal**
  (`renderer/model/graph/slant.ts`). Packing means a line can end at a node three columns
  to its left, and crossing three columns inside one row is a five-degree line. So the
  *drawing* moves over the rows above, a column per row, crossing over its neighbours
  rather than displacing them: two lines briefly sharing a column is what a crossing
  looks like, and it costs nothing.

Three things that follow from those:

- **26ms** to lay out 17.7k commits, which is why no setting exists for switching a
  layout pass off. One setting remains, `Merge lanes having a common parent`.
- **Colour is decided once, when a line is created, and never revisited**, which is the
  whole of why a line cannot change colour part-way down. A new line steps forward from
  its seed until it clears every colour currently on screen: over a large real history
  that takes rows carrying a repeated colour from 45% to 5%.
- **A row is drawn once, whole, in its own strip.** Every lane change meets the row's
  edge travelling vertically, so neighbouring rows join invisibly without knowing about
  each other: no clipping, no margin around the visible range, and no segment painted
  three times by three rows.

Read [docs/GIT-GRAPH.md](docs/GIT-GRAPH.md) before touching any of it.

## Before anything

- This repo is indexed by CodeGraph: query `codegraph_explore` before grep/find or
  reading files to locate or understand code. Serena is the tool for one symbol you can
  already name: reading it, finding what references it, rewriting it in place.
- macOS is the only verified platform. Don't raise a Windows gap as outstanding work.
- No comment, doc, or test cites another project as where this code came from. State
  the rule this code follows, on its own terms.

## The two rules that never bend

- Every git operation is a `git` CLI subprocess, spawned with an argv array. Never
  libgit2/nodegit/isomorphic-git, never a shell string.
- The user can always see what git ran: one `buildArgs`/argv array is both previewed
  and executed, never rebuilt separately for display.

## Adding a feature

- **A dialog** (an operation that asks the user something before running git): follow
  CLAUDE.md's "Adding a dialog" checklist, then [docs/DIALOGS.md](docs/DIALOGS.md) for
  the reasoning behind it. Build on `DialogFrame` + the `components/ui/` form
  primitives: a new dialog writes no CSS and no run logic (`useDialog` owns that).
- **A command** (palette/menu/hotkey action): `defineCommand` in `renderer/commands/`,
  see CLAUDE.md's "Adding a command". Pick its surface(s) deliberately;
  `tests/renderer/menu.test.ts`'s `command homes` fails if it's offered nowhere.
- **An IPC channel**: add to `Invocations` + `INVOKE_CHANNELS` in `shared/contract.ts`,
  then a handler in the `main/ipc/handlers/` module for its subject. Preload/renderer
  types follow automatically.
- **Anything that mutates the repo**: declare its `RepoFacet[]` (`shared/invalidation.ts`),
  never infer one from argv. See CLAUDE.md's "How a window learns the repository moved".
- **The revision graph**: read [docs/GIT-GRAPH.md](docs/GIT-GRAPH.md) first. A lane is a
  position in an ordered list of open lines, which is what makes gaps and staircases
  impossible rather than merely rare; layout is pure (`renderer/model/graph/`), drawing
  is separate (`renderer/components/revisiongrid/graph/`).
- Check [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)'s "Deliberately not built" before
  adding something that looks missing: it may have been cut on purpose, not overlooked.

## Fixing a bug

- Reproduce with a test first. `tests/` mirrors the source split: `tests/main`,
  `tests/shared`, `tests/renderer`.
- Prefer a real-git integration test over mocking git: nothing in
  `tests/main/git.integration.test.ts` is mocked, it drives real repos in a temp dir.
- A component test mounts the real component: `@vitest-environment happy-dom`,
  `enableAutoUnmount(afterEach)`, mock `@renderer/api.js`, stub `ResizeObserver`. See
  CLAUDE.md's Testing section for the traps already paid for.
- A dialog's wiring (menu row → payload → git actually running) is invisible to a unit
  test: drive it with `npx playwright test -g "<name>"`.
- A commit-screen or conflict-resolution flow: `e2e/commit-screen.spec.ts` /
  `e2e/conflicts.spec.ts`.
- Anything visual (graph colours, a form's layout, a missing row): use the `run-app`
  skill and look at a screenshot. No test can see the canvas or a menu row nobody can
  read.

## Verification

- `npm run typecheck`, `npm test`, `npm run eslint` on every change.
- A dialog: whichever of `e2e/dialogs-branches`, `-worktree` or `-history` owns its
  subject. Commit screen: `e2e/commit-screen.spec.ts`.
  Merge/rebase/cherry-pick/am and every way they stop: `e2e/conflicts.spec.ts`.
- Manual on macOS: first paint under 1s, smooth scroll on a large repo, graph lanes
  match `git log --graph`, no `index.lock` contention on background refresh, both
  themes.
- Transparency: command log's argv matches the preview; "copy as shell command"
  reproduces it in a terminal.

## Map

| Question | Where |
|---|---|
| Directory layout, IPC contract, command registry, dialog checklist, conventions | [CLAUDE.md](CLAUDE.md) |
| Standing decisions, what's deliberately not built, process boundary, watcher, theming, settings | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Why dialogs are windows, facets in full, sizing, wording rules | [docs/DIALOGS.md](docs/DIALOGS.md) |
| `git log` → layout → canvas for the revision graph | [docs/GIT-GRAPH.md](docs/GIT-GRAPH.md) |
| What git prints → the command log and the console window | [docs/GIT-OUTPUT.md](docs/GIT-OUTPUT.md) |
