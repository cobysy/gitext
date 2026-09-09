/**
 * What a file command acts on, and how it runs.
 *
 * Every command in `commands/file/` starts from the same two questions: which files
 * the surface in front has selected, and what to re-read once git has changed them.
 * Answering those in one place is what keeps the three action modules to their own
 * subject, and is why the tree branch of `selectedEntries` cannot drift between them.
 *
 * Imports stores: must NOT be listed in `tsconfig.node.json`.
 */

import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { useDiffStore } from '@renderer/stores/diff.js';
import { useFileTreeStore } from '@renderer/stores/fileTree.js';
import { useStagingStore } from '@renderer/stores/staging.js';
import { FILES_PANE_MODE_TREE, useSettingsStore } from '@renderer/stores/settings.js';
import { toMessage } from '@renderer/api.js';
import { runConsoleSteps } from '@renderer/gitConsole.js';
import type { DiffFileEntry } from '@shared/diff.js';
import { type RepoFacet } from '@shared/invalidation.js';
import { FILE_STATUS_UNCHANGED, IGNORE_WHITESPACE_NONE } from '@shared/types.js';

export const CMD_ADD = 'add';
export const CMD_RESET = 'reset';
export const CMD_CHECKOUT = 'checkout';
export const IGNORE_TARGET_GITIGNORE = 'gitignore';
export const IGNORE_TARGET_EXCLUDE = 'exclude';
export const INDEX_FLAG_SKIP_WORKTREE = 'skip-worktree';
export const INDEX_FLAG_ASSUME_UNCHANGED = 'assume-unchanged';
export const STAGE_DIRECTION_STAGE = 'stage';
export const RANGE_END_FROM = 'from';
export const RANGE_END_TO = 'to';
export const FILE_HISTORY_TAB_DIFF = 'diff';
export const FILE_HISTORY_TAB_BLAME = 'blame';

/**
 * Diff options for a patch that has to *apply*, not one that has to read well: git's
 * own defaults, stated rather than left off, since a patch built under the pane's own settings is one `git apply` refuses.
 */
export const APPLICABLE_PATCH = { ignoreWhitespace: IGNORE_WHITESPACE_NONE, contextLines: 3 } as const;

/** Whether the commit screen is the surface a file command is being run from. */
export function onCommitScreen(): boolean
{
  return useUiStore().commitScreenOpen;
}

/**
 * The files a command acts on: whichever list is on screen, its whole selection. The
 * tree branch is load-bearing: its entries are files that exist, not changes, so reading
 * the changed list here would act on whatever that list happened to have open.
 */
export function selectedEntries(): DiffFileEntry[]
{
  if (onCommitScreen())
  {
    return useStagingStore().selectedEntries;
  }
  if (useSettingsStore().settings.filesPaneMode !== FILES_PANE_MODE_TREE)
  {
    return useDiffStore().selectedEntries;
  }
  // A tree entry carries no status because nothing was compared to produce it, and
  // `unchanged` is what that honestly is: the same shape the commit screen gives a
  // file it knows only from the index.
  return useFileTreeStore().selectedEntries.map((entry) => ({
    path: entry.path,
    status: FILE_STATUS_UNCHANGED,
    score: 0,
    kind: entry.kind,
    mode: entry.mode,
    binary: false
  }));
}

export function selectedPaths(): string[]
{
  return selectedEntries().map((entry) => entry.path);
}

/** The pivot the surface in front is showing: what a reset or an external tool reads. */
export function currentRange()
{
  if (onCommitScreen())
  {
    return useStagingStore().range;
  }
  else
  {
    return useDiffStore().range;
  }
}

/** How several files are named in a prompt, without listing forty of them. */
export function describe(paths: readonly string[]): string
{
  if (paths.length === 1)
  {
    // Backticked: a path is a token, and the confirmation renders one in the code font.
    return `\`${paths[0]!}\``;
  }
  else
  {
    return `${paths.length} files`;
  }
}

/** Re-read whichever surface is showing, after something changed the index or the disk. */
export async function afterChange(): Promise<void>
{
  await useRepoStore().refresh();
  if (onCommitScreen())
  {
    await useStagingStore().refresh();
  }
  else
  {
    await useDiffStore().refresh();
  }
}

/**
 * Run git and report a failure rather than letting it vanish. Every command routed
 * through here acts on files, so what it invalidates is the index, the working tree, or both, and each caller says which.
 */
export async function run(argv: string[], invalidates: readonly RepoFacet[]): Promise<boolean>
{
  const repo = useRepoStore().repo;
  if (!repo)
  {
    return false;
  }
  try
  {
    await runConsoleSteps(repo.path, [{ label: `git ${argv[0]}`, argv }], invalidates);
    await afterChange();
    return true;
  }
  catch (err)
  {
    useUiStore().toast(toMessage(err), 'error');
    return false;
  }
}
