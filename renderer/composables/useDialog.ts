/**
 * What every dialog does around the git call it exists to make: one `busy` ref, one
 * `error` ref, one `try/catch/finally` around `api['git:run']`, so button re-enabling,
 * refresh and conflict handling are decided once rather than per dialog:
 *
 * ```ts
 * const { busy, error, run } = useDialog();
 * const argv = computed(() => ['checkout', ref.value]);
 * ```
 * ```vue
 * <button :disabled="busy" @click="run(argv, CHECKOUT)">Checkout</button>
 * ```
 *
 * The second argument is what the operation invalidates (`shared/invalidation.ts`),
 * required, so every window updates the moment the command exits rather than when the
 * `.git` watcher notices.
 *
 * On success it refreshes, opens the conflict resolver if the command left conflicts,
 * and closes the window unless `{ close: false }`. On failure it leaves the window open with git's stderr.
 *
 * Three entry points, one behaviour: `run` for a single argv, `runSteps` for several
 * commands where the failure has to name which, `perform` for work through a channel of
 * its own (`file:addIgnoreRules`, `file:delete`) rather than `git:run`.
 *
 * When the "Show git output in a console window" setting is on, `run`/`runSteps` stream
 * each step through `stream:start` instead of the buffered `git:run`, and raise the
 * console (`dialog:openOutput`) to follow them. The dialog's own behaviour is unchanged
 * either way: it still awaits its run, still shows the failure, still closes on success.
 */

import { ref, type Ref } from 'vue';
import type { RepoFacet } from '@shared/invalidation.js';
import { api, toMessage } from '@renderer/api.js';
import { ConsoleFailure, runConsoleSteps } from '@renderer/gitConsole.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { useAfterGitOperation } from './useAfterGitOperation.js';

export interface RunOptions {
  /** Close the dialog when the run succeeds. Default true. */
  close?: boolean;
  /**
   * Refresh the repository afterwards, and open the conflict resolver if the command
   * left conflicts. Default true; false only for work that doesn't touch the repository.
   */
  refresh?: boolean;
  /**
   * Treat "it stopped on a conflict" as the operation having happened, not a failure.
   * Default false: `git cherry-pick`/`revert` exit non-zero when a change doesn't apply
   * cleanly, but the sequencer is running and the resolver is the way forward. Only
   * true for a command that *creates* conflicts; checked against the repository's state, not the error message.
   */
  allowConflicts?: boolean;
  /**
   * Raise the console window for this run whatever the setting says. For an operation
   * whose whole point is watching it work: `gc` repacks for a minute with nothing else
   * to show for it. Left unset, the "Show git output in a console window" setting decides.
   */
  console?: boolean;
  /**
   * Leave the console up when this run succeeds. For a command whose output *is* the
   * answer rather than progress about work being done: `git clean` naming every file it
   * removed. See `DialogPayload.outputKeepOpen`.
   */
  consoleKeepOpen?: boolean;
  /**
   * The directory to run in, for the two commands whose operand is a directory rather
   * than the open repository: `clone` and `init` are how a repository comes to exist, so
   * requiring one to be open already would be a circle. Left unset, which is every other
   * dialog, the run happens in the repository the window has open.
   *
   * A dialog passing this must also pass `refresh: false`: there is nothing yet to
   * reload, and the invalidation it would announce belongs to no open window.
   */
  cwd?: string;
}

/** One step of a multi-command operation: an argv, and what to call it when it fails. */
export interface Step {
  /** What this step is, in the error message: "Stashing your changes failed: …". */
  label: string;
  argv: string[];
}

export interface DialogController {
  /** True while the operation is running. Bind it to the confirming button's `disabled`. */
  busy: Ref<boolean>;
  /** The last failure, as a message. Cleared at the start of every run. */
  error: Ref<string>;
  /**
   * git's own words from that failure, in full. `error` is what the form *shows*, and
   * with the console open it is one line pointing at it; this is for a dialog that has
   * to decide on what git said (`PushDialog` telling a rejection from a refusal).
   */
  failureOutput: Ref<string>;
  /**
   * Run one argv, declaring what it invalidates. Resolves true on success.
   * `invalidates` is positional and required, so a dialog can't quietly omit it and
   * leave every other window stale.
   */
  run: (
    argv: string[],
    invalidates: readonly RepoFacet[],
    options?: RunOptions
  ) => Promise<boolean>;
  /**
   * Run argvs in order, stopping at the first failure and naming the step that failed.
   * One facet set for the whole operation, not per step: it's a single thing the user asked for.
   */
  runSteps: (
    steps: Step[],
    invalidates: readonly RepoFacet[],
    options?: RunOptions
  ) => Promise<boolean>;
  /**
   * Run work that is not a `git:run` argv, a channel of its own, in the same shape.
   * `label` is the sentence its failure belongs to: "Creating the archive failed".
   */
  perform: (
    label: string,
    work: (repoPath: string) => Promise<void>,
    options?: RunOptions
  ) => Promise<boolean>;
  /** Close the dialog window. */
  close: () => void;
}

/**
 * How a failure reads on the form.
 *
 * A `ConsoleFailure` says it all already: which command failed, and that its output is
 * in the window standing beside this one. Prefixing that with the step's own name says
 * the same thing twice, except where the operation was several commands and *which*
 * one failed is the part a label can add (`-d` and `-D` refusing a branch are different
 * problems, and a checkout that stashes first is three commands).
 */
function describeFailure(labelled: string | readonly Step[], err: unknown): string
{
  let named: string;
  if (typeof labelled === 'string')
  {
    named = labelled;
  }
  else if (labelled.length > 1 && err instanceof ConsoleFailure)
  {
    const failing = labelled.find((step) => step.argv[0] === err.argv0);
    named = failing?.label ?? '';
  }
  else
  {
    named = '';
  }

  if (err instanceof ConsoleFailure)
  {
    if (named)
    {
      return `${named}: ${err.message}`;
    }
    return err.message;
  }
  if (named)
  {
    return `${named}: ${toMessage(err)}`;
  }
  return toMessage(err);
}

/** Whether the repository has conflicted paths right now. */
async function leftConflicts(repoPath: string): Promise<boolean>
{
  try
  {
    return (await api['repo:state'](repoPath)).conflictCount > 0;
  }
  catch
  {
    return false;
  }
}

export function useDialog(): DialogController
{
  const repo = useRepoStore();
  const ui = useUiStore();
  const { refresh, surfaceConflicts } = useAfterGitOperation();

  const busy = ref(false);
  const error = ref('');
  const failureOutput = ref('');

  function close(): void
  {
    void api['dialog:close']();
  }

  /**
   * The whole shape, once: busy while it runs, git's stderr when it fails, and on
   * success a refresh and a close. `describe`, not a plain label, since `runSteps` labels
   * its failure with the step that produced it, which this function can't know. Nothing
   * is rolled back: a failure leaves the repository as git left it, with git's own stderr underneath.
   */
  async function attempt(
    work: (repoPath: string) => Promise<void>,
    describe: (err: unknown) => string,
    options: RunOptions
  ): Promise<boolean>
  {
    const repoPath = options.cwd ?? repo.repo?.path;
    if (!repoPath)
    {
      error.value = 'No repository is open.';
      return false;
    }

    busy.value = true;
    error.value = '';
    failureOutput.value = '';
    try
    {
      try
      {
        await work(repoPath);
      }
      catch (err)
      {
        // A cherry-pick or revert that doesn't apply cleanly exits non-zero, and that's
        // the operation working. Ask git what state it's in rather than reading its prose, which varies by version.
        if (!options.allowConflicts || !(await leftConflicts(repoPath)))
        {
          error.value = describe(err);
          // What git said, whether or not the label is showing it: a `ConsoleFailure`
          // keeps it off the label and here instead.
          if (err instanceof ConsoleFailure)
          {
            failureOutput.value = err.output;
          }
          else
          {
            failureOutput.value = error.value;
          }
          return false;
        }
      }

      // The repository moved: this window's own view is stale, and the owning window is told by the watcher rather than by us.
      if (options.refresh !== false)
      {
        await refresh();
      }
      if (options.close !== false)
      {
        close();
      }
      // Asked for *after* the close, nothing awaited in between: the two messages reach
      // main in order, so the resolver is parented to the repository window, not this one on its way out.
      if (options.refresh !== false)
      {
        surfaceConflicts();
      }
      return true;
    }
    finally
    {
      busy.value = false;
    }
  }

  async function runSteps(
    steps: Step[],
    invalidates: readonly RepoFacet[],
    options: RunOptions = {}
  ): Promise<boolean>
  {
    if (steps.length === 0)
    {
      return false;
    }
    // One path for both: `runConsoleSteps` opens the console once for the whole
    // operation when this run is watched, and opens it on a failure either way. A
    // checkout that stashes first is three commands and one thing the user asked for.
    return attempt(
      async (repoPath) =>
      {
        await runConsoleSteps(repoPath, steps, invalidates, {
          console: options.console,
          keepOpen: options.consoleKeepOpen
        });
      },
      (err) => describeFailure(steps, err),
      options
    );
  }

  async function run(
    argv: string[],
    invalidates: readonly RepoFacet[],
    options: RunOptions = {}
  ): Promise<boolean>
  {
    if (argv.length === 0)
    {
      // A dialog whose form is incomplete should have its button disabled; reaching here is a bug.
      ui.toast('Nothing to run: the command is empty.', 'error');
      return false;
    }
    // The command, not "the command failed": a step's label names the step, and the
    // console shows it as a heading over the output of a run that is going fine. It
    // reads as the failure it prefixes either way ("git merge: fatal: …").
    return runSteps([{ label: `git ${argv[0]}`, argv }], invalidates, options);
  }

  async function perform(
    label: string,
    work: (repoPath: string) => Promise<void>,
    options: RunOptions = {}
  ): Promise<boolean>
  {
    return attempt(work, (err) => describeFailure(label, err), options);
  }

  return { busy, error, failureOutput, run, runSteps, perform, close };
}
