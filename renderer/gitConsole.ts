/**
 * Running git with the console window watching: the one place that decides whether a
 * run is streamed and shown, so a dialog (`useDialog`) and a command that opens no
 * dialog at all (`commands/objects.actions.ts`'s Fetch) behave the same way.
 *
 * A plain module rather than a composable: half its callers are command handlers with
 * no component to hang a lifetime off, and there is no state here to own. What the
 * console shows comes from main, keyed by the ids minted below.
 */

import type { OutputStep } from '@shared/dialogs.js';
import type { RepoFacet } from '@shared/invalidation.js';
import { PATH_SEPARATOR } from '@shared/diff.js';
import type { GitStreamBatch } from '@shared/types.js';
import { api, toMessage } from '@renderer/api.js';
import { nextStreamRequestId } from '@renderer/composables/streamRequestId.js';
import { useSettingsStore } from '@renderer/stores/settings.js';

/** One command to run, and what to call it if it fails. Mirrors `useDialog`'s `Step`. */
export interface ConsoleStep {
  label: string;
  argv: string[];
}

/**
 * A command that failed with the console watching it.
 *
 * `message` is deliberately short and says where to look, because the window that asked
 * for the run shows it in a one-line label and the console beside it already has git's
 * own words in full. Repeating them in the label is how a `fatal:` ends up wrapped
 * across a form with the console holding the same text unread.
 *
 * `output` is that full text, for the callers that must *decide* on it rather than show
 * it: `PushDialog` reads a rejection out of it and opens on the remedies.
 */
export class ConsoleFailure extends Error
{
  readonly output: string;
  /** The verb that failed, so a multi-command operation can name the step it was. */
  readonly argv0: string;

  constructor(argv: string[], output: string)
  {
    super(`git ${argv[0]} failed: see the Git Output window.`);
    this.name = 'ConsoleFailure';
    this.output = output;
    this.argv0 = argv[0] ?? '';
  }
}

/**
 * Verbs that always get the console, whatever `streamLiveOutput` says, and what makes an
 * argv one of them.
 *
 * Read off the argv rather than set at each call site, because a call site is where it
 * gets forgotten: a tag push, a remote branch deleted and `remote prune` are all pushes
 * and fetches under another name, and a checkout is reached from four surfaces.
 */
const ALWAYS_WATCHED: Record<string, (argv: readonly string[]) => boolean> = {
  // Anything talking to a remote: the slow ones, the ones that fail for reasons outside
  // this repository, and the ones whose progress is worth watching.
  push: watchIt,
  fetch: watchIt,
  pull: watchIt,
  clone: watchIt,
  // `remote` is mostly local bookkeeping: only `prune` and `update` reach the network.
  remote: (argv) => argv.includes('prune') || argv.includes('update'),
  // A checkout rewrites the working tree and counts its way through it, and it is the
  // local operation most likely to stop with something to say: a file in the way, a
  // stash that would not apply, a branch that needed creating first.
  //
  // A checkout naming paths is a *restore* of those paths, which is neither slow nor
  // worth a window: discarding one file's changes from the staging list is a checkout,
  // and so is taking one side of a conflict.
  checkout: (argv) => !argv.includes(PATH_SEPARATOR)
};

/** The predicate for a verb that qualifies on its name alone. */
function watchIt(): boolean
{
  return true;
}

/**
 * Verbs whose *failure* is worth a console window even when the run itself was quiet.
 *
 * A pre-commit hook is the most common reason a commit fails, and a lint or test hook
 * prints pages. Routed like any other local command, all of that lands in a form's
 * one-line error label and the text saying what to fix is nowhere the user can read it.
 */
const VERBOSE_ON_FAILURE = new Set(['commit', 'merge', 'rebase', 'cherry-pick', 'revert', 'am']);

/** Whether a failed `argv` should be shown in full rather than summarised in a label. */
export function failureWantsConsole(argv: readonly string[]): boolean
{
  return VERBOSE_ON_FAILURE.has(argv[0] ?? '');
}

function isAlwaysWatched(step: ConsoleStep): boolean
{
  // The first argument that is not a flag: `git -c key=value push` is still a push.
  const verb = step.argv.find((arg) => !arg.startsWith('-'));
  if (!verb)
  {
    return false;
  }
  return ALWAYS_WATCHED[verb]?.(step.argv) ?? false;
}

/**
 * Whether this run gets a console. `force` is for an operation whose whole point is
 * watching it work even though it never leaves the machine: `gc`, repacking for a
 * minute with nothing else to show for it.
 */
export function consoleWanted(steps: readonly ConsoleStep[], force: boolean | undefined): boolean
{
  if (force !== undefined)
  {
    return force;
  }
  if (steps.some(isAlwaysWatched))
  {
    return true;
  }
  return useSettingsStore().settings.streamLiveOutput;
}

export interface ConsoleOptions {
  /**
   * Open the console whatever the setting says, or keep it shut. Left unset, the argv
   * decides: `ALWAYS_WATCHED` names what is watched wherever it is run from, and
   * everything else follows the setting.
   */
  console?: boolean;
  /**
   * Leave the console up when the run succeeds. For output that is the answer rather
   * than progress: see `DialogPayload.outputKeepOpen`.
   */
  keepOpen?: boolean;
}

/**
 * Show a command that has already failed.
 *
 * A run nobody was watching still has output worth reading the moment it fails, and by
 * then it is a rejected promise rather than a stream: a branch that would not delete,
 * a checkout refusing to overwrite. The console is where git's words go, whether or not
 * the run was one being followed, so a failure raises it after the fact.
 */
export function showFailedRun(step: ConsoleStep, output: string): void
{
  void api['dialog:openOutput']({
    outputSteps: [
      {
        ...step,
        // Nothing to follow: `useStreamWatch` reads `finished` instead of subscribing.
        requestId: nextStreamRequestId(),
        finished: { lines: output.split('\n'), exitCode: null }
      }
    ]
  });
}

/**
 * Every id up front, before the first command starts: the console is opened once for
 * the whole operation and has to know which runs are still to come.
 */
export function openConsoleFor(
  steps: readonly ConsoleStep[],
  options: ConsoleOptions = {}
): OutputStep[]
{
  const watched = steps.map((step) => ({ ...step, requestId: nextStreamRequestId() }));
  void api['dialog:openOutput']({ outputSteps: watched, outputKeepOpen: options.keepOpen });
  return watched;
}

/**
 * One step, streamed instead of buffered: resolves once the run's final batch arrives,
 * and throws the way `git:run`'s rejection does so a caller needs no separate case for it.
 */
export function streamStep(
  repoPath: string,
  step: OutputStep,
  invalidates: readonly RepoFacet[]
): Promise<string>
{
  return new Promise((resolve, reject) =>
  {
    const seen: string[] = [];
    const off = api.on('event:streamLine', (batch: GitStreamBatch) =>
    {
      if (batch.requestId !== step.requestId)
      {
        return;
      }
      seen.push(...batch.lines);
      if (!batch.done)
      {
        return;
      }
      off();
      if (batch.error)
      {
        reject(new ConsoleFailure(step.argv, batch.error));
        return;
      }
      if (batch.exitCode !== 0)
      {
        // Everything git printed carried on the error, not just its last line: what a
        // caller does with a failure can turn on any part of it. `PushDialog` reads a
        // rejection out of it and opens on the remedies rather than the error.
        const printed = seen.join('\n').trim();
        reject(new ConsoleFailure(step.argv, printed || `exited ${batch.exitCode}`));
        return;
      }
      // Both streams, in arrival order: a caller reading the result (the rebase dialog
      // looking for "is up to date") wants what git said, and a pty merges the two anyway.
      resolve(seen.join('\n'));
    });
    void api['stream:start'](step.requestId, repoPath, step.argv, invalidates);
  });
}

/**
 * Run the steps in order, stopping at the first failure, with the console watching when
 * this run is one that gets one. Throws the failing step's error: the caller decides
 * what a failure means, as it did when it called `git:run` itself. Resolves with the
 * last step's output, for the callers that read what git said.
 */
export async function runConsoleSteps(
  repoPath: string,
  steps: readonly ConsoleStep[],
  invalidates: readonly RepoFacet[],
  options: ConsoleOptions = {}
): Promise<string>
{
  let watched: OutputStep[] = [];
  if (consoleWanted(steps, options.console))
  {
    watched = openConsoleFor(steps, options);
  }

  let output = '';
  for (const [index, step] of steps.entries())
  {
    const streamed = watched[index];
    if (streamed)
    {
      output = await streamStep(repoPath, streamed, invalidates);
      continue;
    }
    try
    {
      output = await api['git:run'](repoPath, step.argv, invalidates);
    }
    catch (err)
    {
      // Not being watched is a decision about a command that is *working*. One that
      // failed has something to say, so the console opens on it here.
      const said = toMessage(err);
      showFailedRun(step, said);
      throw new ConsoleFailure(step.argv, said);
    }
  }
  return output;
}
