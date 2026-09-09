/**
 * Merging, and everything that happens when it goes wrong.
 *
 * Its own spec rather than a handful of the dialogs' steps, because conflict handling
 * stopped being one dialog. It is now a list whose every row carries its own actions, a
 * three-way editor in a window of its own, a word-level merge that offers to settle
 * blocks git could not, and four different operations (`merge`, `rebase`, `cherry-pick`,
 * `am`) that each hide the incoming side somewhere different and invert what "mine"
 * means.
 *
 * What this catches that the unit tests cannot:
 *
 * - The **editor is a separate window opened from a row of another dialog**, so every
 *   payload, route and prop between "the icon was clicked" and "the right file opened" is
 *   wiring only a driven run sees.
 * - Its **toolbars are raw DOM handed to Monaco as view zones**, outside Vue entirely,
 *   and under a sibling layer that hit-tests as opaque. A toolbar can draw perfectly and
 *   take no clicks, which only a test that clicks can tell apart.
 * - **A command that ends in conflicts must raise the resolver itself.** That hand-off is
 *   between two windows and belongs to neither.
 * - **A conflict made outside the app must raise it just the same**, and an operation
 *   ended outside the app must close it: which takes a repository moving underneath a
 *   running window to observe at all.
 * - The **words invert per operation**. Mid-rebase the commit being replayed is your own,
 *   so a suite that only ever merges would never see "Mine" move to the other side.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GitextApp } from './support/app.js';
import { CommitScreen } from './support/commitScreen.js';
import { openEditorOn, openResolver } from './support/conflicts.js';
import { conflictingMerge } from './fixtures/conflictsRepo.js';
import { refreshApp } from './support/grid.js';
import { openViaPalette } from './support/palette.js';
import { expect, test } from './support/tour.js';

test.use({
  tourName: 'conflicts',
  seedSettings: {
    filesPaneMode: 'changed',
    filePaneView: 'diff',
    mergeNoFastForward: false,
    mergeNoCommit: false,
    rebaseAutostash: false
  }
});

/**
 * Finish a conflicted merge through the commit screen it hands off to.
 *
 * A merge finishes with a commit, so Continue hands off to the commit screen rather than
 * running one blind: its message box already holding what git prepared.
 */
async function commitTheMerge(app: GitextApp): Promise<void>
{
  const commitScreen = new CommitScreen(await app.waitForWindow('Commit', 12_000));
  // The prepared message arriving is what says the screen is ready to commit a merge:
  // it is read from `MERGE_MSG` after the window mounts, and committing before it lands
  // would write whatever was in the box instead.
  await expect(
    async () => expect(await commitScreen.messageText()).not.toBe(''),
    'the commit screen did not fill in with the message git prepared'
  ).toPass({ timeout: 12_000 });
  await commitScreen.click('Commit');
  expect(
    await app.waitFormsClosed(12_000),
    'the commit screen did not close after committing the merge'
  ).toBe(true);
}

test('a merge run from its dialog stops, and the resolver opens by itself', async ({
  app,
  repo
}, testInfo) =>
{
  // Diverged, but merged through the *app* rather than by raw git: what this step is
  // about is the hand-off. A command that ends in conflicts has to raise the resolver on
  // its own (`useDialog` → `surfaceConflicts`), and nothing about that path is visible to
  // a test that creates the conflict itself and then opens the window.
  repo.git(['checkout', '-q', '-B', 'auto-base', 'main']);
  repo.write('shared.txt', 'the original\n');
  repo.commitAll('auto: base');
  repo.git(['checkout', '-q', '-B', 'auto-other']);
  repo.write('shared.txt', 'their version\n');
  repo.commitAll('auto: their edit');
  repo.git(['checkout', '-q', 'auto-base']);
  repo.write('shared.txt', 'my version\n');
  repo.commitAll('auto: my edit');
  await refreshApp(app);

  const dialog = await openViaPalette(app, 'Merge into Current Branch', 'Merge Branch');
  await dialog.setSelect('auto-other');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Merge');

  // The claim: nobody asked for this window. The merge dialog closes and the resolver
  // takes its place, because the command left conflicts behind.
  const resolver = await openResolver(app, 'Merge');
  await resolver.keepSide('shared.txt', 'ours');
  await expect(() => expect(repo.conflicts()).toEqual([])).toPass();

  await resolver.click('Continue Merge');
  await commitTheMerge(app);

  expect(repo.parents(), 'the merge did not complete').toHaveLength(2);
  expect(repo.fileText('shared.txt').trim(), 'expected our side to survive').toBe('my version');
});

test('a merge conflict, one side taken per file from the file’s own row', async ({
  app,
  repo
}, testInfo) =>
{
  // Two files, both changed on both sides, so each side button has something to do.
  conflictingMerge(repo, 'two', {
    'x.txt': ['base\n', 'mine\n', 'other\n'],
    'y.txt': ['base\n', 'mine\n', 'other\n']
  });
  await refreshApp(app);

  const resolver = await openResolver(app, 'Merge');
  await testInfo.attach('preview', { body: await resolver.preview() });

  // One of each side, so the step proves the two buttons do different things, and proves
  // it per row, which is the thing the row buttons exist to make unambiguous.
  await resolver.keepSide('x.txt', 'ours');
  await expect(() => expect(repo.conflicts()).toEqual(['y.txt'])).toPass();
  await resolver.keepSide('y.txt', 'theirs');
  await expect(() => expect(repo.conflicts()).toEqual([])).toPass();

  await resolver.click('Continue Merge');
  await commitTheMerge(app);

  expect(repo.parents(), 'the merge did not complete').toHaveLength(2);
  // `--cleanup=strip` keeps MERGE_MSG's own comment block out of the message. A raw `-m`
  // that left it in would produce the same subject and pass a subject assertion.
  expect(repo.message(), "MERGE_MSG's comment block survived into the message").not.toContain(
    '# Conflicts:'
  );
  // If both files came out the same, the two buttons are running the same command and
  // nobody would notice until it mattered.
  expect(repo.fileText('x.txt').trim(), 'x.txt should have kept ours').toBe('mine');
  expect(repo.fileText('y.txt').trim(), 'y.txt should have kept theirs').toBe('other');
});

test('one file resolved in the built-in editor, block by block', async ({ app, repo }) =>
{
  conflictingMerge(repo, 'editor', {
    'recipe.txt': [
      'Pancakes\n2 cups flour\n1 tsp salt\n2 eggs\n',
      'Pancakes\n2 cups flour\n2 tsp salt\n2 eggs\n',
      'Pancakes\n2 cups flour\n1 tbsp vanilla\n2 eggs\n'
    ]
  });
  await refreshApp(app);

  const { resolver, editor } = await openEditorOn(app, 'recipe.txt');

  // Both reference panes are real Monaco diff editors, and the result pane is a third:
  // four editors in the window. Anything less means one of them failed to mount, which is
  // invisible from a screenshot of a dark pane.
  expect(await editor.mountedPanes(), 'the editor did not mount all its Monaco panes')
    .toBeGreaterThanOrEqual(3);
  await expect(editor.blocksLeft()).toHaveText('1');

  // A real click, on raw DOM inside a Monaco view zone: the layer above it hit-tests as
  // opaque, so a toolbar can draw perfectly and take nothing.
  await editor.blockAction('Keep Mine');
  await expect(editor.blocksLeft()).toHaveText('0');

  await editor.click('Save & Mark Resolved');
  await expect(() => expect(editor.page.isClosed()).toBe(true)).toPass({ timeout: 12_000 });
  // The window going and the file being written are two different moments, so the file
  // itself is what to wait on: markers gone is the editor's save having landed.
  await expect(
    () => expect(repo.fileText('recipe.txt')).not.toContain('<<<<<<<'),
    'the editor closed without writing the resolved file'
  ).toPass({ timeout: 8000 });

  // Read before the abort below puts the file back: what this step is about is what the
  // editor wrote.
  const saved = repo.fileText('recipe.txt');
  const stagedAfterSave = repo.status();

  // Abort from the resolver, which is the other half of the window's job and leaves the
  // fixture clean for the step after.
  await resolver.click('Abort Merge');
  await app.expectFormsClosed(12_000);

  expect(saved, 'the editor saved a file still holding markers').not.toMatch(/<{7}|>{7}/);
  expect(saved, 'expected my side to survive').toContain('2 tsp salt');
  expect(saved, 'the incoming side was kept as well').not.toContain('vanilla');
  // Saving marks it resolved: a staged `M`, not a `UU`.
  expect(stagedAfterSave, 'the file was saved but left unmerged').not.toContain('UU');
  expect(repo.operation(), 'abort left the repository mid-operation').toBe('none');
  expect(repo.conflicts(), 'abort left conflicts').toEqual([]);
});

test('a conflict git could not settle, merged automatically at word level', async ({
  app,
  repo
}) =>
{
  // The case the word-level pass exists for: both sides changed the *same line*, but
  // different words of it. Git's merge is line-based and conflicts; the two edits do not
  // actually collide.
  conflictingMerge(repo, 'words', {
    'recipe.txt': [
      'Pancakes\n2 cups flour\n1 tsp salt\n2 eggs\n',
      'Pancakes\n2 cups flour\n2 tsp salt\n2 eggs\n',
      'Pancakes\n2 cups flour\n1 tsp sea salt\n2 eggs\n'
    ]
  });
  await refreshApp(app);

  const { resolver, editor } = await openEditorOn(app, 'recipe.txt');

  // The offer is a claim about this specific conflict, so it is asserted rather than
  // assumed: a pass that silently found nothing to merge would prove nothing at all.
  await expect(editor.page.locator('.auto'), 'an offer to merge the one block').toContainText(
    '1 of 1'
  );

  await editor.click('Merge it');
  await expect(editor.blocksLeft()).toHaveText('0');

  await editor.click('Save & Mark Resolved');
  await expect(() => expect(editor.page.isClosed()).toBe(true)).toPass({ timeout: 12_000 });
  // The window going and the file being written are two different moments, so the file
  // itself is what to wait on: markers gone is the editor's save having landed.
  await expect(
    () => expect(repo.fileText('recipe.txt')).not.toContain('<<<<<<<'),
    'the editor closed without writing the resolved file'
  ).toPass({ timeout: 8000 });
  const saved = repo.fileText('recipe.txt');

  await resolver.click('Continue Merge');
  await commitTheMerge(app);

  // Both edits, in one line, in the right order: the whole claim of the word-level pass.
  // `2 tsp sea salt`: mine changed the number, theirs added the word.
  expect(saved, 'the two edits were not merged into one line').toContain('2 tsp sea salt');
  expect(repo.parents(), 'the merge did not complete').toHaveLength(2);
  expect(repo.conflicts()).toEqual([]);
});

test('a rebase conflict, where “mine” is the commit being replayed, not HEAD', async ({
  app,
  repo
}) =>
{
  repo.git(['checkout', '-q', '-B', 'replay-onto', 'main']);
  repo.write('clash.txt', 'the base branch\n');
  repo.commitAll('onto: base branch edit');

  repo.git(['checkout', '-q', '-B', 'replay-me', 'main']);
  repo.write('clash.txt', 'my own work\n');
  repo.commitAll('me: my own work');

  // Stops on the first conflicting commit, which is the state being driven.
  repo.git(['rebase', 'replay-onto']);
  await refreshApp(app);

  const resolver = await openResolver(app, 'Rebase');

  // The inversion, asserted in the words on screen. Mid-rebase git's "ours" is the branch
  // being replayed *onto*, and the commit the user wrote is the incoming side: so a
  // dialog that said "Keep Mine" for HEAD would be telling them to throw their own work
  // away. Only this spec can catch that: a merge never inverts.
  const legend = resolver.page.locator('.hint');
  await expect(legend, 'the rebase legend does not name the base branch').toContainText('Base');
  await expect(legend).toContainText('replaying onto');
  await expect(legend, 'the rebase legend does not call the replayed commit mine').toContainText(
    'Mine'
  );
  await expect(legend).toContainText('being replayed');

  // "Mine" during a rebase is `--theirs` to git. Taking it must keep the user's work.
  await resolver.keepSide('clash.txt', 'theirs');
  await expect(() => expect(repo.conflicts()).toEqual([])).toPass();

  await resolver.click('Continue Rebase');
  await app.expectFormsClosed(15_000);

  expect(repo.operation(), 'the rebase did not finish').toBe('none');
  expect(repo.branch(), 'the rebase did not land back on its branch').toBe('replay-me');
  // The user's own work survived, which is what taking "Mine" had to mean.
  expect(repo.fileText('clash.txt').trim(), '"Mine" did not keep the replayed commit').toBe(
    'my own work'
  );
  expect(repo.subject()).toBe('me: my own work');
});

test('a `git am` conflict: the incoming side is a patch, and is still named', async ({
  app,
  repo
}) =>
{
  repo.git(['checkout', '-q', '-B', 'am-onto', 'main']);
  repo.write('patched.txt', 'the original line\n');
  repo.commitAll('am: base');

  repo.git(['checkout', '-q', '-B', 'am-source']);
  repo.write('patched.txt', 'the patched line\n');
  repo.commitAll('am: a change worth sending');

  repo.git(['checkout', '-q', 'am-onto']);
  repo.write('patched.txt', 'a conflicting local line\n');
  repo.commitAll('am: my own change');

  const patch = repo.git(['format-patch', '--stdout', 'am-onto...am-source']);
  const patchFile = path.join(repo.dir, '..', `e2e-am-${process.pid}.patch`);
  fs.writeFileSync(patchFile, `${patch}\n`);
  repo.git(['am', '--3way', patchFile]);
  fs.rmSync(patchFile, { force: true });

  expect(repo.operation(), 'the fixture is not mid-am').toBe('am');
  await refreshApp(app);

  // "Apply patch", not "Am": the dialog names operations in the app's words.
  const { editor } = await openEditorOn(app, 'patched.txt', 'Apply patch');

  // A patch mid-apply is not a commit: no ref to resolve, nothing to blame. Its identity
  // comes out of the sequencer's scratch files, in git's format rather than ours, which
  // is why it is asserted against a real `am` rather than in a unit test.
  const incoming = editor.page.locator('.pane-label').filter({ hasText: 'Base → Incoming' });
  await expect(incoming, 'no incoming pane label').toBeVisible();
  await expect(incoming, 'the patch is not named on the incoming pane').toContainText(
    'am: a change worth sending'
  );
  await expect(incoming, "the patch's author is missing from the incoming pane").toContainText(
    'Tour'
  );

  await app.closeDialogs();
  repo.git(['am', '--abort']);
  expect(repo.operation(), 'the am was not aborted').toBe('none');
});

test('a conflict made outside the app, and taken back outside it', async ({ app, repo }) =>
{
  // Nothing in this step touches the app, and that is the whole claim: a repository
  // moving underneath a running window is noticed anyway. `main/watcher.ts` sees `.git`
  // change, and the repository window raises the resolver off the conflict count rather
  // than off a command of its own: `watchForConflicts`.
  //
  // The app's own writes suppress the watcher for a second (`ECHO_MS`,
  // `main/ipc/repoChanges.ts`), so the step before has to fall out of that window before
  // this one writes. Unscaled, deliberately: it is a deadline in the main process, not a
  // pause for the renderer to catch up, and shrinking it would only make this step fail
  // depending on what ran before it.
  await app.main.waitForTimeout(1500);
  conflictingMerge(repo, 'outside', { 'drift.txt': ['base\n', 'mine\n', 'other\n'] });

  await openResolver(app, 'Merge');

  // And the other direction. A window titled for a merge that is over, offering to
  // continue it, is worse than no window: so the resolver closes itself when the
  // operation ends, wherever it ended.
  repo.git(['merge', '--abort']);
  expect(
    await app.waitFormsClosed(15_000),
    'the resolver stayed open after the merge was aborted outside the app'
  ).toBe(true);

  expect(repo.operation(), 'the abort did not take').toBe('none');
  expect(repo.conflicts()).toEqual([]);
});
