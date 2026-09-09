/**
 * What happens after any mutating git command. The command itself announces what it
 * changed, and every window reloads off that (`shared/invalidation.ts`). What's left is
 * the one thing a broadcast can't do: decide whether to put a window in front of the
 * user (conflicts → open the resolver; mid-operation with no conflicts → the banner
 * already offers Continue/Skip/Abort; clean → nothing).
 *
 * `watchForConflicts` is the same decision for conflicts no command of ours produced: a
 * terminal merge, or a repository opened mid-conflict.
 *
 * Split into halves, not one call: the caller inside a dialog window must ask for the
 * resolver *after* telling that window to close, or it's parented to a window dying on
 * its way out. See `useDialog`.
 */

import { watch } from 'vue';
import { api } from '@renderer/api.js';
import { currentDialogName } from '@renderer/dialogs/current.js';
import type { DialogOpenOptions } from '@shared/dialogs.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useUiStore } from '@renderer/stores/ui.js';

const DIALOG_CONFLICTS_RESOLVE = 'conflicts.resolve';

export function useAfterGitOperation()
{
  const repo = useRepoStore();
  const ui = useUiStore();

  /** Bring this window's view of the repository up to date. */
  async function refresh(): Promise<void>
  {
    await repo.refresh();
  }

  /**
   * Open the resolver, unless there's nothing to resolve or it's already the window
   * asking: a window asking for the window it already is would be a focus call per
   * click. One rule, three callers below.
   */
  function raiseResolver(conflictCount: number, options?: DialogOpenOptions): void
  {
    if (conflictCount === 0)
    {
      return;
    }
    if (currentDialogName() === DIALOG_CONFLICTS_RESOLVE)
    {
      return;
    }
    ui.openDialog(DIALOG_CONFLICTS_RESOLVE, {}, options);
  }

  /**
   * Raise the resolver if the command left conflicts. Synchronous, and must stay that
   * way: `useDialog` calls it right after `close()` with nothing awaited between, so the
   * resolver is parented to the repository window, not one on its way out.
   */
  function surfaceConflicts(): void
  {
    raiseResolver(repo.state.conflictCount);
  }

  /**
   * For a caller already *in* the repository window: the instant checkout, a fetch.
   * Asks git for the conflict count directly, rather than refreshing the store first,
   * since `event:repoChanged` updates it a moment later anyway.
   */
  async function afterGitOperation(): Promise<void>
  {
    const path = repo.repo?.path;
    if (!path)
    {
      return;
    }
    try
    {
      raiseResolver((await api['repo:state'](path)).conflictCount);
    }
    catch
    {
      // A repository that cannot be read has no conflicts worth raising a window about,
      // and whatever broke it will surface through the operation's own error.
    }
  }

  /**
   * Raise the resolver whenever conflicts appear, whatever caused them: a terminal
   * merge or a repository opened mid-conflict moves the same count with no command of
   * ours to hook, and this is "no command may leave a conflict unsurfaced" for that case.
   *
   * Only the none→some transition: a window raised on every tick while three conflicts
   * are being resolved would steal focus back. `repo.open` clears the count first, so
   * arriving mid-merge reads as arriving, not improving.
   *
   * `automatic`, since nobody asked: dropped rather than taking the screen from an open
   * dialog, palette, or confirmation.
   *
   * It *does* take the screen from another application, deliberately: a conflict with
   * no command of ours behind it happened elsewhere, so the app is by definition not
   * frontmost, and standing down whenever inactive would defeat the one case this exists for.
   *
   * For the repository window alone: every dialog window holds a copy of this store and
   * would raise the same window on the same broadcast.
   */
  function watchForConflicts(): void
  {
    watch(
      () => repo.state.conflictCount,
      (count, before) =>
      {
        if (before === 0)
        {
          raiseResolver(count, { automatic: true });
        }
      }
    );
  }

  return { refresh, surfaceConflicts, afterGitOperation, watchForConflicts };
}
