/**
 * The commit itself: its message and options, and turning them into a `git commit`
 * run. Reads `selection.stagedFiles` to know whether there is anything to commit and
 * calls `run` (from `actions.ts`) to invoke git; it doesn't read or write the file lists or the patch itself.
 */

import { computed, ref, watch, type Ref } from 'vue';
import type { useRepoStore } from '@renderer/stores/repo.js';
import type { useSettingsStore } from '@renderer/stores/settings.js';
import {
  MERGE_MSG_FILE,
  OPERATION_CHERRY_PICK,
  OPERATION_MERGE,
  OPERATION_REVERT,
  type InProgressOperation,
  type MessageFileName
} from '@shared/types.js';
import { HISTORY_MOVE, REFS, type RepoFacet } from '@shared/invalidation.js';
import type { SelectionState } from './selection.js';

const CMD_COMMIT = 'commit';
const CMD_PUSH = 'push';
const FLAG_AMEND = '--amend';
const FLAG_RESET_AUTHOR = '--reset-author';
const FLAG_AUTHOR = '--author';
const FLAG_NO_VERIFY = '--no-verify';
const FLAG_CLEANUP_STRIP = '--cleanup=strip';
const FLAG_MESSAGE = '-m';
const FLAG_NO_EDIT = '--no-edit';

/** True for an operation that leaves git with a message of its own already prepared. */
function preparesCommitMessage(operation: InProgressOperation): boolean
{
  return operation === OPERATION_MERGE ||
    operation === OPERATION_CHERRY_PICK ||
    operation === OPERATION_REVERT;
}

/** True once the box should be filled from git's own `MERGE_MSG` rather than left blank. */
function canFillFromPreparedMessage(finishing: boolean, path: string | undefined, message: string): path is string
{
  return finishing && !!path && message.trim() === '';
}

export interface CommitStateDeps {
  settings: ReturnType<typeof useSettingsStore>;
  selection: SelectionState;
  repo: ReturnType<typeof useRepoStore>;
  run: (
    argv: string[],
    invalidates: readonly RepoFacet[],
    options?: { console?: boolean }
  ) => Promise<boolean>;
  /** git's own words from the last failure, for handing on rather than showing. */
  failureOutput: Ref<string>;
  /** The screen's one error surface, which `run` writes git's stderr into. */
  error: Ref<string | null>;
  /** The push after a commit came back refused, with git's own words for why. Injected: this module knows the push failed; the composition root knows the push dialog answers it. */
  onPushFailed: (stderr: string) => void;
  /** Reads one of git's message files: `MERGE_MSG` here, for the message git already prepared for a merge, cherry-pick or revert once nothing is left conflicted. */
  readMessageFile: (repoPath: string, name: MessageFileName) => Promise<string>;
}

export function createCommitState({
  settings,
  selection,
  repo,
  run,
  failureOutput,
  error,
  onPushFailed,
  readMessageFile
}: CommitStateDeps)
{
  const message = ref('');
  const amend = ref(false);
  const committing = ref(false);

  /** `--reset-author` on the next commit. Only meaningful while amending. */
  const resetAuthor = ref(false);

  /**
   * Who to record as the author, as `Name <email>`, or `''` for git's own answer.
   * Per-commit, not a setting: a preference that outlived the commit it was set for
   * would attribute everything afterwards to them too. Cleared after each commit.
   */
  const author = ref('');

  /**
   * Mid a merge, cherry-pick or revert with nothing left conflicted: the state
   * `ResolveConflictsDialog`'s "Continue" hands off to this screen for. Git already has
   * a message ready (`MERGE_MSG`, or the index for `--no-edit`), so an empty box doesn't mean "nothing to commit" here the way it otherwise does.
   */
  const finishingOperation = computed(
    () => preparesCommitMessage(repo.state.operation) && repo.state.conflictedPaths.length === 0
  );

  /**
   * Fill the box with git's own prepared message the moment there is one to show,
   * rather than leaving it blank until the commit runs, so it gets looked at rather
   * than just accepted. Only when the box is still empty: never overwrites a message already typed, by hand or by an earlier run of this watcher.
   */
  watch(
    finishingOperation,
    async (finishing) =>
    {
      const path = repo.repo?.path;
      if (!canFillFromPreparedMessage(finishing, path, message.value))
      {
        return;
      }
      const prepared = (await readMessageFile(path, MERGE_MSG_FILE)).trim();
      if (prepared && message.value.trim() === '')
      {
        message.value = prepared;
      }
    },
    { immediate: true }
  );

  /** Nothing staged is nothing to commit, unless amending or finishing an operation that already has its own commit prepared, either of which can stand alone. */
  const canCommit = computed(
    () =>
      (selection.stagedFiles.value.length > 0 || amend.value || finishingOperation.value) &&
      (message.value.trim() !== '' || amend.value || finishingOperation.value)
  );

  const commitArgv = computed(() =>
  {
    if (!canCommit.value)
    {
      return [];
    }
    const args = [CMD_COMMIT];
    if (amend.value)
    {
      args.push(FLAG_AMEND);
    }
    if (resetAuthor.value)
    {
      args.push(FLAG_RESET_AUTHOR);
    }
    // After `--reset-author`: the two disagree and the later flag wins, so naming an author, the more specific instruction, has to settle which wins explicitly.
    if (author.value.trim())
    {
      args.push(FLAG_AUTHOR, author.value.trim());
    }
    if (settings.settings.commitNoVerify)
    {
      args.push(FLAG_NO_VERIFY);
    }
    // `-m`'s default cleanup is `whitespace`, not `strip`: it leaves `#`-prefixed lines
    // alone, and the box prefilled from `MERGE_MSG` is full of them (`# Conflicts:`), so
    // left in they'd land in the commit verbatim. `--no-edit` never needs this: reading
    // the file through git's own commit machinery already strips them.
    if (finishingOperation.value)
    {
      args.push(FLAG_CLEANUP_STRIP);
    }
    if (message.value.trim())
    {
      args.push(FLAG_MESSAGE, message.value.trim());
    }
    else
    {
      args.push(FLAG_NO_EDIT);
    }
    return args;
  });

  async function commit(options: { push?: boolean } = {}): Promise<boolean>
  {
    if (!canCommit.value)
    {
      return false;
    }
    committing.value = true;
    try
    {
      const ok = await run(commitArgv.value, HISTORY_MOVE);
      if (!ok)
      {
        return false;
      }

      message.value = '';
      amend.value = false;
      resetAuthor.value = false;

      // Push after, not as part of: two commands, two log rows, and a push failure leaves
      // a commit that succeeded rather than an ambiguous half-state. The commit is what
      // this returns, so the screen closes either way, but a refused push is handed on
      // rather than dropped: the whole point of the button is not having to push after yourself.
      // `console: true`: the push is over the network, watched like every other one.
      if (options.push && !(await run([CMD_PUSH], REFS, { console: true })))
      {
        onPushFailed(failureOutput.value || (error.value ?? ''));
      }
      return true;
    }
    finally
    {
      committing.value = false;
    }
  }

  function reset(): void
  {
    message.value = '';
    amend.value = false;
    author.value = '';
  }

  return {
    message,
    amend,
    committing,
    resetAuthor,
    author,
    canCommit,
    commitArgv,
    commit,
    reset
  };
}

export type CommitState = ReturnType<typeof createCommitState>;
