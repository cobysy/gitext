# Dialogs

> The reasoning behind [CLAUDE.md](../CLAUDE.md)'s "Adding a dialog" checklist. Read
> that first; this fills in why. `DialogName` in `shared/dialogs.ts` is the current,
> authoritative list, don't trust a count written here.

## A dialog is a window

- Every operation dialog is its own `BrowserWindow`, a **modal child** of the
  repository window it was opened from (`main/dialogs.ts`).
- Why a window and not an overlay: it reads live repository state while open, an
  overlay would cover exactly what you need to look at, and a window can be dragged
  and resized natively.
- Why modal: one question at a time, nothing can change underneath a form already
  filled in, and the window behind stays visible but not clickable.
- A dialog that opens another dialog becomes its parent, so closing stacks unwind in
  the order they were opened (`ownerWindow` walks the chain back to the repository
  window).
- **There's no result channel.** A dialog runs git through `git:run` like anything
  else; `main/ipc/index.ts` broadcasts the result to every window, so the repository
  window updates on its own. The one exception is `ui.confirm()`, a plain yes/no
  prompt with no form, which stays in-page as `ConfirmDialog` since it's asking about
  something already on screen.
- **A hand-off to another dialog closes first**, nothing awaited in between: `close()`,
  then `ui.openDialog(...)`. That parents the new window to the repository window, not
  to the one that's dying. `useDialog` does this to raise the conflict resolver; Commit
  and Push do it to hand a rejected push to the push dialog.

## The four rules

1. A dialog reads its operand from its payload. Never from a selection.
2. One argv array is both previewed and run.
3. A dialog writes no run logic. That's `useDialog`.
4. A dialog writes no CSS. That's `DialogFrame` and the form primitives.

### 1. The operand comes from the payload

- A dialog is its own renderer process with its own store; it cannot see the
  repository window's selection. This is a technical fact, not a rule to remember:
  there's nothing to reach for.
- The payload travels in the window's query string, not a message after mount, because
  it has to exist before the first render or the form flashes empty for a frame.
- Trap already hit: `CheckoutBranchDialog` once fell back to `repo.repo?.branch` on
  mount if the payload didn't say. Right for the one entry point that opens it from the
  menu bar, wrong for the other four. A dialog opened from five places needs its
  operand supplied by all five, not defaulted by one.
- Facts *about* the operand can still come from the repository store:
  `CheckoutBranchDialog` takes the ref from its payload but asks the ref list whether
  it's a remote branch, so its answer can't disagree with what the picker already
  shows.

### 2. One argv array

- Argv is built by pure, unit-tested modules under `renderer/model/args/`. The options
  a radio group renders and the flags it produces come from the same table: two
  separate arrays are two places that can disagree.
- No argv, no problem: preview the result instead. `IgnoreDialog` isn't a git command,
  so it shows the file's tail with the new line already in it. The rule is "show what
  will happen", not "show a `$` prompt".
- A multi-command operation previews one line per step, and runs through `runSteps`.

### 3. `useDialog` owns the run

- `run(argv, facets)`: one command. `runSteps([{ label, argv }, …], facets)`: several,
  each step's `label` naming what failed (`-d` and `-D` refusing a branch are different
  problems), one facet set for the whole operation. `perform(label, work)`: work
  through its own channel instead of `git:run` (that channel declares its own facets).
  `{ close: false }`: keep the dialog open for a follow-up.
- Facet sets and how to pick one: CLAUDE.md's "How a window learns the repository
  moved".
- `{ console: true }`: raise the command-output console for this run whatever the
  setting says. Only for work whose point is watching it happen and that never leaves
  the machine, which today is `gc`. Anything over the network gets one anyway:
  `renderer/gitConsole.ts` reads that off the argv rather than off the call site, since
  a tag push, a deleted remote branch and Commit and Push are all pushes and all used to
  forget.

#### The console window

`commandOutput` is a dialog like any other in `DIALOG_WINDOWS`, and unlike any other in
how it is opened: `dialog:openOutput`, not `dialog:open`. It is **not modal** and **not
a child of the dialog that asked**, because a modal child is blocked behind its parent
and dies with it, and this window has to outlive the form that closes itself on success.
It is `alwaysOnTop`, since the form that started the run *is* modal over the same owner
and would otherwise stand in front of it.

It only ever *watches*: `useStreamWatch` follows request ids minted by whoever started
the runs, and catches up through `stream:state` for a command that finished before this
window had mounted. A successful console closes itself after
`commandOutputAutoCloseSeconds`; a failed one never does.

A dialog therefore shows a failure in one line pointing at the console, not git's whole
stderr wrapped across the form: see `ConsoleFailure`.

#### Three dialogs that don't run an operation

- **`navigate.goToCommit`**: resolves a revision via `revisions:describe`, then relays
  it to the repository window over `dialog:goToRevision` (a dialog has no grid of its
  own to scroll). Nothing runs, nothing invalidates, no `RepoFacet[]`.
- **`view.advancedFilter`**: shapes the grid's continuous query, no argv to hand
  `run()`. Holds only the session-scoped half of the filter (author, committer,
  message, diff content, date range, first-parent-only, hide-merges); branch scope and
  remote/tags/stashes/reflog visibility live in Settings instead. Relays to
  `event:applyLogFilter`, never touches `settings.patch()`. Still previews its draft,
  through a renderer-side mirror of `main/git/log.ts`'s `buildLogArgs`
  (`renderer/model/args/logFilter.ts`), the one place a `LogOptions` object rather than
  a literal argv array crosses the IPC boundary.
- **`search.grep`**: runs `git grep`, a read-only command, so it has no facets, nothing
  to refresh, no reason to close (`{ close: false, refresh: false }`). Goes through a
  typed channel (`shared/grep.ts`) instead of `git:run` since the answer is a list of
  hits, not text; its argv builder lives in `shared/` instead of
  `renderer/model/args/` for the same reason, the one exception to that rule.

### 4. No CSS

- `DialogFrame` gives the shape (header, scrolling body, footer);
  `components/ui/` gives the controls (`FormRow`, `FormText`, `FormNumber`,
  `FormSelect`, `FormCheck`, `FormRadioGroup`, `FormTextArea`, `FormGroup`,
  `FormDisclosure`, plus `RefPicker`, `CommitPicker`, `LocalChangesChoice`,
  `RememberChoice`). Most operation dialogs have no `<style>` block at all.
- A hint is a prop, not a `<p>`; on `FormCheck` it's where the git flag goes
  (`--no-ff`). `useDialogKeyboard` handles Enter and initial focus window-wide, so a
  field needs neither `@keydown.enter` nor `autofocus`.
- If a control needs something the primitives don't do, add a sibling component
  (`FormNumber` was added this way rather than branching `FormText` for min/max/step).
  Never write a local copy: these primitives existed once already and all 27 dialogs
  bypassed them, drifting the label column to eight different widths.

## Opening on the common case

- One or two fields answer the question nearly every time; everything else goes inside
  a `FormDisclosure`.
- The disclosure's `summary` prop says what's set while folded, built from the argv
  itself (`flagsIn` in `renderer/model/args/summary.ts`) so it can't drift from what
  actually runs. A fold that hides `--force` without saying so is worse than a flat
  form.
- Closing the panel clears what's inside it: an option set and then folded away is an
  option nobody can see.

## Sizing

- `DialogFrame` measures header + natural body + footer and reports it over
  `dialog:fit`; `main/dialogs/fit.ts` sizes the window to that, before it's shown and
  again whenever content changes (unfolding a disclosure grows the window instead of
  pushing the buttons off the bottom edge).
- It only ever grows, with headroom: `grownDialogHeight` (`shared/dialogBounds.ts`)
  draws the window `DIALOG_HEADROOM_PX` (72px, fixed) taller than the measured content
  and never shrinks it while open. Never exceeds 92% of the display, and skips a window
  the person has manually resized (`will-resize`/`will-move` fire only for a person's
  own gesture).
- It moves the window too (`shared/dialogBounds.ts`): back to a remembered anchor if
  reopened where someone left it, centred on its parent otherwise, always fitted to the
  work area. A dialog grows downward, so its footer of buttons is what would otherwise
  fall off the bottom of the screen.
- **A form never scrolls; a document may.** `fixedHeight` tells the two apart.
  The `dialogs-*` specs fail a form that scrolls, and fails any form over **700px** even on a
  bigger display: the smallest current Mac laptop screen (956px, 843px of work area
  with the Dock showing, 92% of that, minus the 72px of headroom).
- **Height is the scarce axis, width is free.** A form with too many rows should get
  wider, not shorter; `controlText.css` is what makes that work (a hint sits beside its
  label when there's room, drops underneath when there isn't, capped at 80 characters).
- **Bump `boundsKey` when widening a dialog**, or a stored width from the old shape
  reopens the new form cropped to the old size.
- The height in `DIALOG_WINDOWS` is only what's painted before the renderer answers.
  Never hand-tune it to make a dialog fit.

### Exception: a dialog you browse

- A list on the left, a pane on the right has no single height worth resizing to.
  These report `0` and pass `fixedHeight` to `DialogFrame`: `stash`, `remote.manage`,
  `worktree.manage`, `submodule.manage`, `settings`, `repo.fsck`, `patch.view`.
- `navigate.goToCommit` and `search.grep` join them for a related reason: they rebuild
  their whole body on every keystroke or search, so a size-tracking window would resize
  under the person typing.
- `repo.editFile` also reports `0`: its body (one text box for a whole file) is
  measurable, but the right height for it is arbitrary, not a fact about the form.
- `shortcuts` is a full document, laid out in columns, that scrolls past anything a
  display can show.
- `fit.ts` reads a reported `0` as "drawn, but not mine to size", and still reveals the
  window (one that reports nothing at all waits out a 1.5s timeout first).
- A `fixedHeight` dialog whose body should fill the window needs a small
  `<style scoped>` block to say so (see `GoToCommitDialog`, `FindInFilesDialog`), the
  one CSS a form-primitive dialog is still allowed to write.

### Exception: a dialog you work, `fullWindow`

- `stash`, `commit.open`, `compare`, `file.history`, `repo.fsck`, `conflicts.editFile`:
  none has a size worth picking in advance. `fullWindow: true`
  (`shared/dialogs.ts`) sizes the window to the owner window's current bounds every
  time it opens (`boundsFor` in `main/dialogs/bounds.ts`, no bounds remembered), and
  opens it `minimizable: false` since a minimized modal leaves its owner stuck.
- Don't add `maximizable: true` beside it: macOS silently disables a window's zoom
  button once it's both `modal` and shown, no matter what it was constructed with, and
  a full-window dialog already opens at its owner's size anyway.
- `commit.open` (`CommitScreen.vue`) draws its own frame instead of `DialogFrame`
  because three splitters filling the window don't fit a header/body/footer shape.
  Doing that by hand means also doing the drag region and traffic-light padding, a
  close button, and calling `dialog:fit(0)` on mount.
- Four traps already hit building it: `scrollHeight` measures content height *or the
  element's own height, whichever is bigger*, so a form with room to spare measures as
  tall as the window it's already in (fix: un-constrain the body, measure, restore, all
  in one frame). The renderer must not compute the window frame:
  `outerHeight - innerHeight` looks like frame thickness but for several frames after
  any resize is actually the size of that resize (reporting it back caused the
  "dialog flashes on open" bug). A window sized while hidden doesn't stay that size on
  macOS: `titleBarStyle: 'hidden'` still reserves a title bar, and `show()` takes those
  32px back out (fix: re-apply the size after `show()`, keeping opacity 0 across both).
  Measuring must not trigger more measuring: a `MutationObserver` watching the body for
  attribute changes will see its own measurement writes and loop forever at 60fps
  unless it ignores them.

## Bounds

- Position and width are remembered per dialog; height never is. If it were, a form
  that once grew to show an unfolded panel would stay that tall forever, and one folded
  shut could never grow again.
- `clampToWorkArea`/`placeInWorkArea` let a window hang off the side of the screen
  (leaving 80px to grab it by, since a person dragged it there), never off the bottom
  (the footer full of buttons is what would go under the edge).
- The remembered position is kept as a fit anchor, not final bounds, so re-fitting to a
  shorter height doesn't strand a low window partway down the screen.
- **Bump `boundsKey` when a rebuilt dialog changes shape.** Unknown keys are kept on
  purpose, so reusing the old key would reopen the new form at a size chosen for the
  old one.

## Reaching a dialog

- Menus, toolbar, context menus, palette, and hotkeys are all renderings of the command
  registry. Never wire an action anywhere else.
- A new menu row is three edits: the command (`renderer/commands/*`), the surface's own
  declaration (`renderer/menus/*` or `main/menu.ts`), and, if offered nowhere else, the
  `command homes` test in `tests/renderer/menu.test.ts`.
- **The surface decides which controls open, not which dialog opens.**
  `branch.rebaseInteractive` and `branch.rebaseAdvanced` open the same rebase window,
  just with the options panel already expanded and `-i` pre-ticked.
- Every surface that opens a dialog must give it a payload. A command that opens a
  dialog with nothing to give it is a dialog opened about nothing.

## Wording rules specific to dialogs

(App-wide rules, no `alert`/`confirm`/`prompt`, backticks for git tokens, no em/en
dash, are in CLAUDE.md's Conventions. These are dialog-specific.)

- **Name the choice, not git's word for it, where getting it backwards is expensive.**
  The conflict resolver says "Keep this branch" / "Keep the incoming branch", not
  "ours"/"theirs": those are a coin flip unless the operation is named, and they mean
  the opposite things during a rebase. Git's own word stays as a stable hook
  (`data-side`) and in the hint text.
- **A radio, not a checkbox, when the options are contradictory.** Fast-forward versus
  always-create-a-merge-commit is one question with two answers, not a box to tick.
- **Three-valued settings need three states.** If *unset* means "whatever git's config
  already says", that's not a checkbox. `--update-refs` is only sent when it differs
  from `rebase.updaterefs`.
- **A destructive default is not a default.** Reset's "Set as default" checkbox is
  disabled and unticked.
- **A conflict is the operation working, not a failure.** A merge that stops on
  conflict opens the resolver, it doesn't show an error.
- **Normalising is not validating.** A branch name with a space can be normalised
  automatically. A name git will outright refuse has to be checked first
  (`check-ref-format`), or the error shows up only after a side effect (like taking a
  stash) already happened.

## Verification

- See [AGENTS.md](../AGENTS.md)'s Verification section for the commands.
- `renderer/model/args/` gets a table-driven test over its flag combinations.
- Every dialog gets a step in one of the `e2e/dialogs-*.spec.ts` files, exercising every entry point that opens
  it: the wiring from menu row to payload to git actually running only shows up when it's
  driven end to end. `npx playwright test -g "<name>"` runs one.
- **A step matches a control by a stable attribute, never a visible label.** `data-side`
  or a `<select>` option's value, not its text: a label can be reworded, and a step
  keyed on wording breaks silently the next time it is.
- **A helper throws rather than doing nothing.** A click on a selector that never rendered
  fails silently and shows up several assertions later as the app doing nothing; a helper
  that waits for what it needs and throws if it never comes fails at the step that's
  actually wrong. The locator-based helpers in `e2e/support/` get this for free: the wait
  is the assertion.
- **The expected title is the dialog's `<h2>`, not its window title.** They are different
  strings for a third of the dialogs here.
