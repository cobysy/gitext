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
import { REFS, type RepoFacet } from '@shared/invalidation.js';
import type { SelectionState } from './selection.js';
import { buildCommitSteps, type CommitOptions, type CommitScope } from '@renderer/model/args/commit.js';

/** Where HEAD is, with what is staged: the Commit button. */
const STAGED_ONLY: CommitScope = { all: false, newBranch: '' };

const CMD_PUSH = 'push';

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

  /** Whether the scope has any file to commit: what is staged, and under Commit All what is not yet. */
  function hasFilesIn(scope: CommitScope): boolean
  {
    if (selection.stagedFiles.value.length > 0)
    {
      return true;
    }
    return scope.all && selection.unstagedFiles.value.length > 0;
  }

  /** Nothing to commit is nothing to commit, unless amending or finishing an operation that already has its own commit prepared, either of which can stand alone. */
  function canCommitWith(scope: CommitScope): boolean
  {
    return (hasFilesIn(scope) || amend.value || finishingOperation.value) &&
      (message.value.trim() !== '' || amend.value || finishingOperation.value);
  }

  const canCommit = computed(() => canCommitWith(STAGED_ONLY));
  /** Commit All: anything changed at all, staged or not. */
  const canCommitAll = computed(() => canCommitWith({ all: true, newBranch: '' }));

  const options = computed<CommitOptions>(() => ({
    message: message.value,
    amend: amend.value,
    resetAuthor: resetAuthor.value,
    author: author.value,
    noVerify: settings.settings.commitNoVerify,
    finishingOperation: finishingOperation.value
  }));

  /** The commands a commit in this scope runs, or none while it cannot. */
  function commitSteps(scope: CommitScope = STAGED_ONLY): ReturnType<typeof buildCommitSteps>
  {
    if (!canCommitWith(scope))
    {
      return [];
    }
    return buildCommitSteps(options.value, scope);
  }

  const commitArgv = computed(() => commitSteps().at(-1)?.argv ?? []);

  /** Runs each step in turn, stopping at the first git refuses: nothing after it would make sense without it. */
  async function runSteps(steps: ReturnType<typeof buildCommitSteps>): Promise<boolean>
  {
    for (const step of steps)
    {
      if (!(await run(step.argv, step.invalidates)))
      {
        return false;
      }
    }
    return true;
  }

  async function commit(opts: { push?: boolean } & Partial<CommitScope> = {}): Promise<boolean>
  {
    const scope: CommitScope = { all: opts.all ?? false, newBranch: opts.newBranch ?? '' };
    const steps = commitSteps(scope);
    if (!steps.length)
    {
      return false;
    }
    committing.value = true;
    try
    {
      if (!(await runSteps(steps)))
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
      if (opts.push && !(await run([CMD_PUSH], REFS, { console: true })))
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
    canCommitAll,
    commitArgv,
    commitSteps,
    commit,
    reset
  };
}

export type CommitState = ReturnType<typeof createCommitState>;
