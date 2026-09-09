/**
 * Shapes and constants shared by the staging store's parts. Nothing here holds state
 * or does I/O: it's what the state and I/O modules agree on, in one place.
 */

import type { Ref } from 'vue';
import type { DiffFileEntry, DiffOptions, DiffRange } from '@shared/diff.js';
import type { PathSelection } from '@renderer/pathSelection.js';
import type { FilePath } from '@renderer/model/paths.js';

export const STAGING_SIDE_UNSTAGED = 'unstaged';
export const STAGING_SIDE_STAGED = 'staged';

/** Which of the two lists a file is in. */
export type StagingSide = typeof STAGING_SIDE_UNSTAGED | typeof STAGING_SIDE_STAGED;

export const COMMIT_PANE_DIFF = 'diff';
export const COMMIT_PANE_MESSAGE = 'message';

/**
 * The commit screen's four keyboard homes: its two lists, its diff and its message box.
 * Here, not beside the screen's keyboard handler, since the `staging.focus*` commands
 * name one too and can't import a component's composable: the store is what they share.
 */
export type CommitPane =
  | StagingSide
  | typeof COMMIT_PANE_DIFF
  | typeof COMMIT_PANE_MESSAGE;

/** Everything that exists once per list. See `sides` in `selection.ts`. */
export interface SideState {
  /** The changed files on this side, as git last reported them. */
  files: Ref<DiffFileEntry[]>;
  /**
   * This list's picked paths, oldest first, plus a range anchor. An array, not a Set,
   * one per side: the *last* pick is the file the diff pane shows, and one per side means
   * switching sides and back doesn't throw the other list's selection away. Arithmetic is `renderer/pathSelection.ts`.
   */
  selection: Ref<PathSelection<FilePath>>;
  /**
   * The paths this list is *drawing*, in draw order, reported by the list component. A
   * shift-range and arrow keys mean "between these two rows on screen", not the
   * underlying file order: a tree or grouping reorders them, a filter removes some.
   * Empty until a list has drawn, falling back to file order so the store is testable with no component attached.
   */
  order: Ref<FilePath[]>;
  /** The pivot this list is a diff across, and what an external tool is handed. */
  range: DiffRange;
}

export const UNSTAGED_RANGE: DiffRange = { from: { kind: 'index' }, to: { kind: 'workingTree' } };
/** `from: null` rather than a HEAD, so an unborn branch works: plain `git diff --cached` compares against the empty tree when there's no HEAD to name. */
export const STAGED_RANGE: DiffRange = { from: null, to: { kind: 'index' } };

/**
 * The diff options a staging patch must be read with. **Not the user's diff settings**:
 * `-w`/`-b` would suppress whitespace changes from the patch, describing a file that
 * doesn't exist, and `git apply` would refuse it or apply it against the wrong lines.
 */
export const STAGING_OPTIONS: DiffOptions = { ignoreWhitespace: 'none' };
