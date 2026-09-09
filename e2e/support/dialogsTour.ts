/**
 * What the three `dialogs-*.spec.ts` files have in common.
 *
 * Every operation dialog, driven from a real entry point, checked against what git says
 * afterwards. This exists for a reason the unit tests cannot cover: a dialog is a
 * **separate window** with a store of its own, opened by a message to the main process
 * and filled in from a payload. Everything between "the menu row was clicked" and "git
 * ran": the payload, the route, the props, the argv, the window itself, is wiring that
 * only shows up when it is driven.
 *
 * **Conflicts are not here.** Resolving one grew into a list, an editor in a window of
 * its own, a word-level merge and four operations that each invert what "mine" means: a
 * subject rather than a step, and `conflicts.spec.ts` is where it lives. The plain merge
 * dialog stays here, because what it tests is a *form*: a checkbox that becomes
 * `--no-ff`.
 *
 * Each step:
 *
 *   1. **Opens the dialog the way a person would**: the command palette, which resolves
 *      through the same registry every menu does. Never by URL.
 *   2. **Reads the preview**, so the argv on screen is attached next to what ran.
 *   3. **Reads git before and after**, directly. A dialog that has gone wrong will
 *      happily close as though it worked.
 *   4. **Asserts the delta.**
 *
 * Every step is written to stand alone, so running one by name proves the same thing it
 * proves in sequence. A step that needs a state the step before it leaves says so and
 * builds that state itself. That is also what lets this be three files rather than one:
 * each drives the same repository from its own copy, so the three run at once and the
 * suite is as long as its longest file rather than the sum of them.
 */

/**
 * The settings every one of the three pins, rather than inheriting from the machine.
 *
 * Shared rather than per file because they are properties of *this repository as these
 * specs drive it*, not of any one third of the list: a step moved from one file to
 * another must not change what it starts from.
 */
export const DIALOG_SETTINGS = {
  // The file pane's two axes, pinned for the same reason the theme is: the seed starts
  // from whatever settings the machine already has, and a step that reads the pane's
  // heading or its diff is asking a question whose answer depends on both of these.
  filesPaneMode: 'changed',
  filePaneView: 'diff',
  checkoutLocalChanges: 'none',
  // Both switches the "set as default" step *ticks*, pinned rather than inherited. A
  // tick is a toggle, so its result depends on where it started: on a machine whose
  // config already carried `checkoutUseDefaultLocalChanges: true`, that step turned the
  // setting off instead of on and the checkout it drives asked a question it was
  // proving does not get asked.
  checkoutAlwaysShowDialog: true,
  checkoutUseDefaultLocalChanges: false,
  autoStashUntracked: false,
  normaliseBranchNames: true,
  checkoutAfterResetOtherBranch: false,
  mergeNoFastForward: false,
  mergeNoCommit: false,
  mergeAddLogMessages: false,
  rebaseAutostash: false
};
