/**
 * A dialog reads its operand from its payload.
 *
 * The rule the whole dialog rebuild rests on: a dialog window is a renderer process of
 * its own, with its own store, so the main window's selection is not merely stale by the
 * time the form is filled in: it is not there at all. `propsFor` is the one place the
 * payload becomes props, and the failure it exists to prevent is silent: the dialog opens,
 * shows *something*, and operates on the wrong ref.
 *
 * So this test asks two things of that table. Every dialog with an operand must derive it
 * from the payload rather than from a constant, and the dialogs that genuinely have no
 * operand must be listed as such, which is what stops a new dialog being forgotten here
 * and quietly defaulting to `{}`.
 */

import { describe, expect, it } from 'vitest';
import { DIALOG_WINDOWS, boundsKeyFor, type DialogName } from '@shared/dialogs.js';
import { propsFor } from '@renderer/dialogs/props.js';

/** Every field a payload can carry, filled with a value nothing else could produce. */
const FULL_PAYLOAD = {
  repoPath: '/tmp/marker-repo',
  ref: 'marker-ref',
  branchName: 'marker-branch',
  stashRef: 'stash@{7}',
  stashIndex: 7,
  remoteName: 'marker-remote',
  pullAction: 'rebase',
  sha: 'markersha1234',
  filePath: 'marker/path.txt',
  filePaths: ['marker/path.txt'],
  ignoreTarget: 'exclude',
  // Not the editor dialog's default, so reading the payload and falling back look different.
  repoTextFile: 'gitattributes',
  pop: true,
  discardScope: 'unstaged',
  compareBase: 'marker-base',
  compareTo: 'marker-compare'
} as const;

/**
 * Dialogs that act on the whole repository or on nothing.
 *
 * A line each, because "this one has no operand" is a decision and the alternative: an
 * empty props object nobody notices, is how a dialog ends up reading a selection.
 */
const NO_OPERAND: Partial<Record<DialogName, string>> = {
  settings: 'the app, not a repository',
  about: 'the app',
  shortcuts: 'the command registry',
  // The two that make a repository rather than acting on one. There is nothing to open
  // them onto: what is being cloned and where it goes are typed into the form, and both
  // are reached with no repository open at all.
  'repo.clone': 'a URL and a folder, both typed into the dialog',
  'repo.init': 'a folder and a name, both typed into the dialog',
  // `reset.changes` *does* take a payload, which half of the working tree, but the value
  // is a mode rather than an operand, so it is checked on its own below.
  'commit.undo': 'HEAD, always, undoing the last commit is not about a selected row',
  // A window of its own now (`fullWindow`), but still nothing you open *onto* a commit:
  // it reads the working tree and the index, same as before it had a window at all.
  'commit.open': 'the working tree and the index, not a selected row',
  'remote.manage': 'the remote list; the dialog is the list',
  // The working directory as a whole. Opening it on a path from the file list would be a
  // second way to say what the "Only these paths" box already says.
  'workdir.clean': 'the whole working directory',
  'conflicts.resolve': 'whatever is conflicted right now',
  // Both act on the object database as a whole. There is nothing to select before running
  // them, which is why neither is on the revision grid's menu.
  'repo.gc': 'the whole object database',
  'repo.fsck': 'every object in the repository',
  // The patch file is chosen inside the window, from a native picker: nothing that opens
  // it knows which file you mean.
  'patch.apply': 'a patch file, chosen in the dialog',
  // Deliberately not the selected commit: you open this to reach a commit you are *not*
  // on. It seeds itself from the clipboard instead, which is where the SHA you are
  // chasing actually is: see `GoToCommitDialog.vue`.
  'navigate.goToCommit': 'a revision you name in it, seeded from the clipboard'
};

const names = Object.keys(DIALOG_WINDOWS) as DialogName[];

/**
 * Excluded from the generic loop below the same way `reset.changes` is excluded from
 * `NO_OPERAND`, for the opposite reason: what the payload carries is real, but it is not
 * a string, so the generic check, which only recognises string values, cannot see it.
 * Each gets its own dedicated test instead, same as `reset.changes` already does.
 *
 * `stash` is here for the `reset.changes` reason rather than this one: what it takes is a
 * mode and not an operand, and its mode happens to be a boolean where that one's is a
 * string.
 */
const STRUCTURED_OPERAND: DialogName[] = [
  'view.advancedFilter',
  'file.history',
  'search.grep',
  'commandOutput',
  'stash'
];

describe('propsFor', () =>
{
  it.each(names.filter((name) => !(name in NO_OPERAND) && !STRUCTURED_OPERAND.includes(name)))(
    '%s takes its operand from the payload',
    (name) =>
    {
      const props = propsFor(name, FULL_PAYLOAD);
      const values = Object.values(props).filter((value) => typeof value === 'string');
      expect(values.length).toBeGreaterThan(0);
      // Every string it produced came out of the payload: nothing was invented.
      for (const value of values)
      {
        expect(Object.values<unknown>(FULL_PAYLOAD)).toContain(value);
      }
    }
  );

  it.each(names.filter((name) => name in NO_OPERAND))('%s has none, on purpose', (name) =>
  {
    expect(propsFor(name, FULL_PAYLOAD)).toEqual({});
  });

  it('reset.changes takes a scope, which is a mode rather than an operand', () =>
  {
    // The commit screen offers both halves and the menu bar offers one; the dialog must
    // never decide which for itself, or the same window would discard different things
    // depending on where it was opened from.
    expect(propsFor('reset.changes', { discardScope: 'unstaged' })).toEqual({
      scope: 'unstaged'
    });
    expect(propsFor('reset.changes', {})).toEqual({ scope: 'all' });
  });

  it('stash takes a mode, since the working tree is the only thing it can be about', () =>
  {
    // "Stash Staged Changes" is this window with one box ticked, opened from the commit
    // screen; the plain row opens it with the box clear. The stashes already saved are a
    // window of their own, so nothing here selects one.
    expect(propsFor('stash', { stagedOnly: true })).toEqual({ stagedOnly: true });
    expect(propsFor('stash', {})).toEqual({ stagedOnly: undefined });
  });

  it('stash.manage opens on the stash a row named, or on none', () =>
  {
    expect(propsFor('stash.manage', { stashRef: 'stash@{2}' })).toEqual({
      stashRef: 'stash@{2}'
    });
    // The Manage row names no stash: the window opens on the newest, which it can only
    // know once it has read the list.
    expect(propsFor('stash.manage', {})).toEqual({ stashRef: undefined });
  });

  it('view.advancedFilter takes the session filter it opens on, not a selected row', () =>
  {
    const logFilter = { authorFilter: 'ada', useRegex: true };
    expect(propsFor('view.advancedFilter', { logFilter })).toEqual({ logFilter });
    // No payload, no filter yet (a first open, or opened from the menu rather than the
    // dialog's own re-open of itself): an empty draft, not an invented one.
    expect(propsFor('view.advancedFilter', {})).toEqual({ logFilter: {} });
  });

  it('commandOutput takes the runs it follows, ids and all', () =>
  {
    const outputSteps = [{ label: 'Compressing', argv: ['gc'], requestId: 7 }];
    expect(propsFor('commandOutput', { outputSteps })).toEqual({
      steps: outputSteps,
      keepOpen: false
    });
    // Output that is the answer rather than progress: the window stays up for it.
    expect(propsFor('commandOutput', { outputSteps, outputKeepOpen: true })).toEqual({
      steps: outputSteps,
      keepOpen: true
    });
    // Nothing to follow rather than an invented run: the window shows an empty console
    // and its Close button, which is what a console opened over nothing should be.
    expect(propsFor('commandOutput', {})).toEqual({ steps: [], keepOpen: false });
  });

  it('leaves an absent operand absent rather than inventing one', () =>
  {
    // The menu bar's Checkout Branch… opens the picker: no ref, and the dialog shows a
    // list instead of a name. A default here would silently pre-fill it with something.
    expect(propsFor('branch.checkout', {})).toEqual({ gitRef: undefined });
  });

  // Two surfaces, one window: a branch row names the branch, a remote row names the
  // remote and lists its branches.
  it('lets the delete-remote-branch dialog be opened over a branch or over a remote', () =>
  {
    expect(propsFor('branch.deleteRemote', { ref: 'origin/x' })).toEqual({
      gitRef: 'origin/x',
      remoteName: undefined
    });
    expect(propsFor('branch.deleteRemote', { remoteName: 'origin' })).toEqual({
      gitRef: undefined,
      remoteName: 'origin'
    });
  });

  it('carries a failed push into the push dialog as git said it', () =>
  {
    // Commit and Push has no answers to a rejection and the push dialog has three, so the
    // stderr travels rather than the outcome: the dialog reads it with the same predicate
    // it uses on a push of its own, and opens on the remedy screen or on the form.
    expect(propsFor('remote.push', { ref: 'main', pushRejection: '! [rejected] main' })).toEqual({
      branch: 'main',
      tagName: undefined,
      failure: '! [rejected] main'
    });
  });

  it('prefers the SHA where a dialog acts on a commit', () =>
  {
    // Both fields carry a revision; `sha` is the one the grid fills in.
    expect(propsFor('commit.checkout', FULL_PAYLOAD)).toEqual({ gitRef: 'markersha1234' });
  });

  it('falls back to the ref when no SHA was passed', () =>
  {
    expect(propsFor('commit.checkout', { ref: 'v1.0' })).toEqual({ gitRef: 'v1.0' });
  });

  it('file.history builds a revision from the SHA, or reads null as the working tree', () =>
  {
    // `file.history` opens on Diff; a SHA in the payload names the commit it opens on.
    expect(propsFor('file.history', { filePath: 'a.txt', sha: 'markersha1234' })).toEqual({
      filePath: 'a.txt',
      revision: { kind: 'commit', sha: 'markersha1234' },
      tab: 'diff'
    });
    // `file.blame` opens the same window on Blame; no SHA means the working tree, which
    // is not the same as defaulting to HEAD: an uncommitted edit would then be blamed as
    // if it were already part of HEAD's commit.
    expect(propsFor('file.history', { filePath: 'a.txt', fileHistoryTab: 'blame' })).toEqual({
      filePath: 'a.txt',
      revision: null,
      tab: 'blame'
    });
  });

  it('search.grep opens on the commit a surface named, or on the working tree', () =>
  {
    // The grid's row hands over the commit whose files are to be searched…
    expect(propsFor('search.grep', { sha: 'markersha1234' })).toEqual({
      revision: { kind: 'commit', sha: 'markersha1234' }
    });
    // …and the Edit menu names none, which means the code you have rather than a commit
    // nobody pointed at. Null, not HEAD: the working tree is a real endpoint here, and
    // the one whose contents an uncommitted edit is actually in.
    expect(propsFor('search.grep', {})).toEqual({ revision: null });
  });
});

describe('boundsKeyFor', () =>
{
  it('is the dialog name for a dialog that has never been rebuilt', () =>
  {
    expect(boundsKeyFor('branch.deleteRemote')).toBe('branch.deleteRemote');
  });

  it('is the suffixed key for one that has', () =>
  {
    // Rebuilt in D1 and much taller: reusing the name would reopen the new form at the
    // size somebody dragged for the stub, cropped, and nothing would say why.
    expect(boundsKeyFor('branch.checkout')).toBe('branch.checkout.v2');
  });

  it('never collides: two dialogs cannot share a stored position', () =>
  {
    const keys = names.map(boundsKeyFor);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
