/**
 * Phase 3 implementations for the revision-grid commands declared in `revision.ts`.
 *
 * Imports stores and UI: must NOT be listed in `tsconfig.node.json`.
 * Called from `commands/index.ts` after `registerRevisionCommands()`.
 */

import { implementCommand } from './registry.js';
import { checkoutRef, KIND_BRANCH, KIND_REMOTE_BRANCH, KIND_TAG } from './checkoutRef.js';
import { KIND_STASH } from '@renderer/panel.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useRevisionsStore } from '@renderer/stores/revisions.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { HEAD_REF } from '@renderer/model/sha.js';

const DISCARD_SCOPE_ALL = 'all';
/** git's own spelling for "the first parent of", which is what a commit's diff is against. */
const FIRST_PARENT_SUFFIX = '^';

function primarySha(): string | null
{
  return useSelectionStore().primary;
}

/**
 * The branch the dialog should open on when nothing named one: "Checkout Branch" from
 * the menu bar has no operand, so this takes the selected commit and preselects when
 * exactly one branch's head is there.
 *
 * *Points at*, not *contains*: containment almost never fires below the tip, and a
 * head match keeps the promise that a guess is never ambiguous. Never the current branch.
 */
function branchAtSelection(): string | undefined
{
  const sha = primarySha();
  if (!sha)
  {
    return undefined;
  }
  const heads = useRepoObjectsStore().refs.filter(
    (entry) => entry.kind === KIND_BRANCH && entry.sha === sha && !entry.isCurrent
  );
  if (heads.length === 1)
  {
    return heads[0]?.name;
  }
  else
  {
    return undefined;
  }
}

export function implementRevisionCommands(): void
{
  implementCommand('branch.checkout', () =>
  {
    useUiStore().openDialog('branch.checkout', { suggestedRef: branchAtSelection() });
  });

  /**
   * The grid's own checkout: the operand is the row of the submenu that was clicked.
   * Without one, from the palette, it falls back to the selected commit's branch, and
   * to the picker when that commit carries none.
   */
  implementCommand(
    'revision.checkoutBranchHere',
    async (options?: { ref?: string; remote?: boolean }) =>
    {
      const ref = options?.ref ?? branchAtSelection();
      if (!ref)
      {
        useUiStore().openDialog('branch.checkout');
        return;
      }
      let kind: typeof KIND_REMOTE_BRANCH | typeof KIND_BRANCH;
      if (options?.remote)
      {
        kind = KIND_REMOTE_BRANCH;
      }
      else
      {
        kind = KIND_BRANCH;
      }
      await checkoutRef(ref, kind);
    }
  );

  implementCommand('branch.create', () =>
  {
    const sha = primarySha();
    useUiStore().openDialog('branch.create', { sha: sha ?? undefined });
  });

  implementCommand('branch.rename', () =>
  {
    const repo = useRepoStore().repo;
    if (!repo?.branch)
    {
      useUiStore().toast('No branch checked out', 'error');
      return;
    }
    useUiStore().openDialog('branch.rename', { branchName: repo.branch });
  });

  // Nothing pre-ticked: the row opened the dialog on the *checked-out* branch, which git
  // refuses to delete: so the one branch it offered was the one that could never work.
  implementCommand('branch.delete', () =>
  {
    useUiStore().openDialog('branch.delete');
  });

  implementCommand('branch.merge', () =>
  {
    const sha = primarySha();
    useUiStore().openDialog('branch.merge', { ref: sha ?? undefined });
  });

  implementCommand('branch.rebase', () =>
  {
    const sha = primarySha();
    useUiStore().openDialog('branch.rebase', { ref: sha ?? undefined });
  });

  implementCommand('branch.rebaseInteractive', () =>
  {
    const sha = primarySha();
    useUiStore().openDialog('branch.rebase', {
      ref: sha ?? undefined,
      rebaseInteractive: true
    });
  });

  implementCommand('branch.rebaseAdvanced', () =>
  {
    const sha = primarySha();
    // "Advanced" is the options panel open, not `-i` ticked: the two are different asks
    // and the menu row that says "Rebase…" is the one that promises neither.
    useUiStore().openDialog('branch.rebase', {
      ref: sha ?? undefined,
      rebaseAdvanced: true
    });
  });

  implementCommand('reset.currentBranch', () =>
  {
    const sha = primarySha();
    if (!sha)
    {
      return;
    }
    useUiStore().openDialog('reset.branch', { sha });
  });

  implementCommand('reset.anotherBranch', () =>
  {
    const sha = primarySha();
    if (!sha)
    {
      return;
    }
    useUiStore().openDialog('reset.other', { sha });
  });

  implementCommand('patch.apply', () => useUiStore().openDialog('patch.apply'));

  implementCommand('patch.format', () =>
  {
    // Two selected commits are a range, and exporting one is the reason anybody picks two.
    const picks = useSelectionStore().ordered;
    let ref: string | undefined;
    if (picks.length > 1)
    {
      ref = picks[0];
    }
    else
    {
      ref = undefined;
    }
    useUiStore().openDialog('patch.format', {
      ref,
      sha: picks.at(-1) ?? undefined
    });
  });

  implementCommand('workdir.clean', () =>
  {
    useUiStore().openDialog('workdir.clean');
  });

  implementCommand('reset.changes', () =>
  {
    useUiStore().openDialog('reset.changes', { discardScope: DISCARD_SCOPE_ALL });
  });

  implementCommand('conflicts.resolve', () =>
  {
    useUiStore().openDialog('conflicts.resolve');
  });

  implementCommand('commit.undo', () =>
  {
    useUiStore().openDialog('commit.undo');
  });

  implementCommand('commit.open', () =>
  {
    useUiStore().openDialog('commit.open');
  });

  implementCommand('commit.checkout', () =>
  {
    const sha = primarySha();
    if (!sha)
    {
      return;
    }
    useUiStore().openDialog('commit.checkout', { sha });
  });

  implementCommand('commit.revert', () =>
  {
    const sha = primarySha();
    if (!sha)
    {
      return;
    }
    useUiStore().openDialog('commit.revert', { sha });
  });

  implementCommand('commit.cherryPick', () =>
  {
    const sha = primarySha();
    if (!sha)
    {
      return;
    }
    useUiStore().openDialog('commit.cherry-pick', { sha });
  });

  implementCommand('commit.archive', () =>
  {
    const sha = primarySha();
    if (!sha)
    {
      return;
    }
    useUiStore().openDialog('commit.archive', { sha });
  });

  implementCommand('commit.reword', () =>
  {
    const sha = primarySha();
    if (!sha)
    {
      return;
    }
    useUiStore().openDialog('commit.reword', { sha });
  });

  /** Open the compare dialog on two revisions: a window, not a redirected pane, so the file pane below the grid keeps answering for whatever row is clicked. */
  const openCompare = (base: string, to: string): void =>
  {
    useUiStore().openDialog('compare', { compareBase: base, compareTo: to });
  };

  implementCommand('compare.selected', () =>
  {
    // In *display* order, not click order: the older commit is the base, which is what
    // "what changed between these two" means. Click order gave opposite diffs for the
    // same shift-drag with nothing on screen to say so.
    const selection = useSelectionStore();
    const shown = selection.inDisplayOrder(useRevisionsStore().rows);
    if (shown.length < 2)
    {
      return;
    }
    openCompare(shown[shown.length - 1]!, shown[0]!);
  });

  implementCommand('compare.withCurrent', () =>
  {
    const sha = primarySha();
    if (!sha)
    {
      return;
    }
    // HEAD is the *base*: "how does this commit differ from where I am now". The old
    // implementation put HEAD on the far end, which read as the opposite question.
    openCompare(HEAD_REF, sha);
  });

  /**
   * This commit's own changes, in a window of its own: the same compare window,
   * against the first parent, staying on this commit while the grid moves on so two
   * commits can be read side by side.
   *
   * `sha^`, not a looked-up parent: git resolves it, and it's right for a merge too,
   * where the first parent is the side being merged into.
   */
  implementCommand('commit.openInNewWindow', () =>
  {
    const sha = primarySha();
    if (!sha)
    {
      return;
    }
    openCompare(`${sha}${FIRST_PARENT_SUFFIX}`, sha);
  });

  implementCommand('tag.create', () =>
  {
    const sha = primarySha();
    if (!sha)
    {
      return;
    }
    useUiStore().openDialog('tag.create', { sha });
  });

  implementCommand('tag.delete', () =>
  {
    const sha = primarySha();
    if (!sha)
    {
      return;
    }
    const revisions = useRevisionsStore();
    const row = revisions.commitOf(sha);
    const tagRef = row?.refs.find((r) => r.kind === KIND_TAG)?.name ?? sha;
    useUiStore().openDialog('tag.delete', { ref: tagRef });
  });

  /**
   * All three stash rows open the same window, selecting the stash they were about:
   * replacing three dialogs (apply, pop, a `window.confirm` for drop) that never showed the file list.
   */
  const openStash = (): void =>
  {
    // Two surfaces offer these rows: the grid (a stash is a commit with a stash ref)
    // and the left panel (a node). One command has to read whichever surface named
    // one, or the panel's rows would act on the grid's selection.
    const node = useRepoObjectsStore().selected;
    if (node?.kind === KIND_STASH && node.ref)
    {
      useUiStore().openDialog('stash.manage', { stashRef: node.ref });
      return;
    }

    const sha = primarySha();
    if (!sha)
    {
      return;
    }
    const row = useRevisionsStore().commitOf(sha);
    const ref = row?.refs.find((r) => r.kind === KIND_STASH)?.name ?? sha;
    useUiStore().openDialog('stash.manage', { stashRef: ref });
  };

  implementCommand('stash.apply', openStash);
  implementCommand('stash.pop', openStash);
  implementCommand('stash.drop', openStash);
}
