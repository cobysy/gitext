/**
 * The dialogs that move a branch: creating one, checking one out, resetting, stashing,
 * and the two that talk to a remote about one.
 *
 * The first of three files that between them drive every operation dialog. What they have
 * in common, and why a driven run is the only thing that can see it, is in
 * `e2e/support/dialogsTour.ts`; each file is a third of that list, with its own app and
 * its own repository, so the three run beside each other.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GitextApp } from './support/app.js';
import { Dialog } from './support/dialog.js';
import { waitForConsole } from './support/console.js';
import { originOf } from './fixtures/dialogsRepo.js';
import { refreshApp, selectCommit } from './support/grid.js';
import { openViaPalette } from './support/palette.js';
import { runFromPanelMenu, selectPanelNode } from './support/panel.js';
import { settle } from './support/options.js';
import { IDENT } from './support/repo.js';
import type { Repo } from './support/repo.js';
import { DIALOG_SETTINGS } from './support/dialogsTour.js';
import { expect, test } from './support/tour.js';

test.use({ tourName: 'dialogs-branches', seedSettings: DIALOG_SETTINGS });

/**
 * Wait for the question a stashing checkout asks when it is done, if it asks one.
 *
 * Drawn *inside* the checkout window, on a scrim over its own form: `ui.confirm` is the
 * one dialog this app still draws in the page rather than in a window, so the thing to
 * wait for is a scrim over the form that was just driven, not a second window. Bounded
 * and tolerant of absence, because whether it is asked at all is what the settings under
 * test decide.
 */
async function stashPrompt(checkout: Dialog): Promise<boolean>
{
  return checkout.page
    .locator('.scrim')
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
}

/**
 * Tick *Stash* and *Set as default* in the checkout dialog, and run it.
 *
 * A helper and not only a step, because the step *after* it is about what happens once
 * the choice has been made, and running that step alone skips the step that makes it. A
 * step that quietly needs the one before it is a step that passes in sequence and fails
 * alone, which is the one thing this spec must not do.
 *
 * The stash it takes is popped again when it is standing in for the missing step, so the
 * caller's before-and-after arithmetic is the same either way.
 */
async function teachStashDefault(
  app: GitextApp,
  repo: Repo,
  { keepStash = true } = {}
): Promise<{ preview: string; restore: () => void }>
{
  const restore = repo.keepWorkingTree();
  repo.git(['checkout', '-q', 'main']);
  repo.append('a.txt', 'changes to stash\n');
  await refreshApp(app);

  const dialog = await openViaPalette(app, 'Checkout Branch', 'Checkout Branch');
  await dialog.setSelect('feature');
  await dialog.tick('Stash');
  await dialog.tick('Remember this choice');
  const preview = await dialog.preview();
  await dialog.click('Checkout');
  // Left where the stash put them: the step after this one is about a checkout that asks
  // nothing at all, and it needs the working tree it starts from to be its own. Waited
  // for rather than guessed at: a snapshot taken on a guess at how long the checkout
  // takes finds no question, answers nothing, and leaves the stash where it is, which the
  // step after this one then reports as its own failure.
  if (await stashPrompt(dialog))
  {
    await dialog.click('Cancel');
  }
  await app.expectFormsClosed();
  if (!keepStash)
  {
    repo.git(['stash', 'pop', '-q']);
    restore();
  }
  return { preview, restore };
}

/** Turn one of the Advanced settings switches, through the window that owns it. */
async function toggleAdvanced(app: GitextApp, ...labels: string[]): Promise<void>
{
  const settings = await openViaPalette(app, 'Settings…', 'Settings');
  // A page nobody opened has no rows: every switch a step wants is behind this click.
  await settings.settingsPage('Advanced');
  for (const label of labels)
  {
    await settings.tick(label);
    await settle(300);
  }
  await settings.click('Done');
  await app.expectFormsClosed();
}

test('create branch', async ({ app, repo }, testInfo) =>
{
  const before = repo.branches();
  await selectCommit(app, 'main moves on');
  const dialog = await openViaPalette(app, 'Create Branch Here', 'Create Branch');
  await dialog.setText('tour: a branch');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Create Branch');
  await app.expectFormsClosed();

  // The name was typed with a colon and a space, both of which git refuses. The
  // normaliser is the reason this passes at all.
  const made = repo.branches().filter((b) => !before.includes(b));
  expect(made, 'the name was not normalised into one git accepts').toContain('tour__a_branch');
});

test('checkout branch, with local changes stashed', async ({ app, repo }, testInfo) =>
{
  const stashesBefore = repo.stashCount();
  const dialog = await openViaPalette(app, 'Checkout Branch', 'Checkout Branch');
  await dialog.setSelect('feature');
  await dialog.tick('Stash');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Checkout');
  // The stash round trip asks whether to put the changes back; say yes.
  if (await stashPrompt(dialog))
  {
    await dialog.click('Pop the stash');
  }
  await app.expectFormsClosed();

  expect(repo.branch()).toBe('feature');
  expect(repo.stashCount(), 'the stash was taken but not popped').toBe(stashesBefore);
  expect(repo.status(), 'the local changes did not come back').toContain('a.txt');
});

/**
 * The fifth answer to a dirty tree.
 *
 * The usual four are refuse, carry, hide, destroy. This one keeps the work *and* goes
 * where you were going, so the step has to prove both halves: a commit that holds the
 * changes on a branch of its own, and a HEAD that landed on the branch that was asked
 * for.
 */
test('checkout branch, parking the local changes on a branch of their own', async ({
  app,
  repo
}, testInfo) =>
{
  // Its own setup, so the step proves the same thing alone as it does in sequence: a
  // known branch to leave, and something in the way of leaving it.
  repo.git(['checkout', '-q', 'main']);
  repo.git(['branch', '-q', '-D', 'wip/main']);
  // Taken before the line below is added, so the restore at the end is the fixture's own
  // tree and not the fixture's plus this step's.
  const restore = repo.keepWorkingTree();
  repo.append('a.txt', 'work worth keeping\n');
  await refreshApp(app);

  const dialog = await openViaPalette(app, 'Checkout Branch', 'Checkout Branch');
  await dialog.setSelect('feature');
  await dialog.tick('Put them on a branch');
  await settle(500);
  await dialog.tick('Commit them to a new branch first');
  await dialog.setText('wip/main');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Checkout');
  await app.expectFormsClosed(12_000);

  // It took *everything*: a file left behind would have been carried into the branch
  // checked out next, which is what `add -A` is there to prevent. Asserted before the
  // line that puts the fixture's own dirt back.
  expect(repo.status(), 'the working tree is still dirty').toBe('');
  restore();
  await refreshApp(app);

  // Where it left you: the half that separates this strategy from the other two.
  expect(repo.branch()).toBe('feature');

  // What it kept. The branch, the commit on it, and the line inside that commit.
  expect(repo.branches(), 'wip/main was never created').toContain('wip/main');
  expect(repo.subject('wip/main')).toBe('WIP on main');
  expect(
    repo.git(['show', 'wip/main:a.txt']),
    'the parked commit does not contain the local changes'
  ).toContain('work worth keeping');

  // Asserted, so it has done its job, and it is not left lying around. The push dialog
  // fills its branch in from what the grid has selected, and a fresh branch on the commit
  // this step just made is what it lands on: the push step opened aimed at `wip/main`,
  // pushed it happily, and failed for want of the rejection it exists to drive. Nothing
  // downstream should be able to tell this step ran.
  repo.git(['branch', '-q', '-D', 'wip/main']);
});

test('set as default, teaching it what to do with local changes', async ({
  app,
  repo,
  settings
}, testInfo) =>
{
  const { preview, restore } = await teachStashDefault(app, repo);
  await testInfo.attach('preview', { body: preview });

  // Read from the app's own settings file rather than from the dialog that wrote it: a
  // checkbox that ticks and forgets looks identical on screen. Read until it says so: the
  // file is written after the dialog has gone, so a single read is a race with the write.
  await expect(
    () => expect(settings.read('checkoutLocalChanges')).toBe('stash'),
    'the choice was not remembered'
  ).toPass({ timeout: 8000 });

  // Put the stash back where it came from, and the working tree with it. The stash step
  // further down asserts an *absolute* count of one, so a stash left lying here is read
  // there as its own `git stash push` having done nothing: a failure twenty rows from its
  // cause.
  repo.git(['stash', 'pop', '-q']);
  restore();
});

/**
 * And then it stops asking.
 *
 * With the answer already given, a dirty working tree is no longer a question, so the
 * checkout runs from the panel row with no window at all. The thing worth driving is the
 * *absence* of the dialog: a step that only checked the branch moved would pass just as
 * well if a window had opened and been dismissed.
 */
test('then it stops asking: a dirty tree, checked out from the panel, no dialog', async ({
  app,
  repo,
  settings
}) =>
{
  const stashesBefore = repo.stashCount();
  const restore = repo.keepWorkingTree();
  // The step before teaches it this. Alone, nothing has: so it is taught here, and the
  // stash that teaching takes is put back so the counting below is unchanged.
  if (settings.read('checkoutLocalChanges') !== 'stash')
  {
    await teachStashDefault(app, repo, { keepStash: false });
  }

  // Both of these are this spec's own doing: the seed pins the always-show flag on so
  // every other step gets a window to drive. This step is the one that wants it off.
  await toggleAdvanced(
    app,
    'Always show the checkout dialog',
    'Use my Local changes choice without asking'
  );

  repo.git(['checkout', '-q', 'main']);
  repo.append('a.txt', 'in the way again\n');
  await refreshApp(app);
  expect(repo.status(), 'nothing is in the way: the step proves nothing').not.toBe('');

  await runFromPanelMenu(app, 'feature', 'Branches', 'Checkout');

  // A checkout is watched, so the window that opens is the console, not a form: it is
  // what git said rather than a question. Dismissed here so its countdown does not run
  // on into the next step.
  const watching = await waitForConsole(app);
  await watching.expectOutput('feature');
  await watching.dismiss();

  const opened = await Promise.all((await app.formWindows()).map((w) => w.title()));
  expect(opened, 'it still asked').toEqual([]);

  /*
   * Put the panel's selection back on `main` before anything else.
   *
   * This step is the only one above the halfway mark that drives the panel, and the push
   * dialog eighteen rows below fills itself in from whatever is selected there. Leaving
   * `feature` selected sends that step off to push the wrong branch, where it is accepted
   * rather than rejected: so the rejection it exists to drive never happens.
   */
  await selectPanelNode(app, 'main', 'Branches');

  /*
   * And put the two switches back, through the same dialog that set them.
   *
   * They are not this step's to leave behind: "don't ask" applies to every checkout
   * afterwards, so the steps below this one would stash their way past a dirty tree and
   * the stash step would then find nothing to stash.
   */
  await toggleAdvanced(
    app,
    'Use my Local changes choice without asking',
    'Always show the checkout dialog'
  );

  expect(repo.branch()).toBe('feature');
  expect(repo.stashCount(), 'expected one more stash').toBe(stashesBefore + 1);
  // Tracked changes only. `stash push` leaves untracked files exactly where they are
  // unless it is given `-u`, which is the `autoStashUntracked` setting and is off by
  // default: so the fixture's untracked file surviving is the behaviour, not a miss.
  expect(
    repo.git(['status', '--porcelain', '--untracked-files=no']),
    'the changes were not stashed'
  ).toBe('');
  // Restored for the steps after this one, which expect the fixture's own seed.
  repo.git(['stash', 'pop', '-q']);
  restore();
});

test('merge, always creating a merge commit', async ({ app, repo }, testInfo) =>
{
  const dialog = await openViaPalette(app, 'Merge into Current Branch', 'Merge Branch');
  await dialog.setSelect('main');
  await dialog.tick('Always create a merge commit');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Merge');
  await app.expectFormsClosed(12_000);

  expect(repo.parents(), 'expected a merge commit').toHaveLength(2);
});

test('reset another branch, forced past the stranding warning', async ({ app, repo }, testInfo) =>
{
  /*
   * Give `behind` a commit of its own, so moving it really would strand something.
   *
   * *Move it anyway* is disabled unless the move is **not** a fast-forward
   * (`wouldStrandCommits`), and in the fixture as built `behind` is an ancestor of
   * `feature work`: so there is nothing to force past and the box never enables. Built
   * here rather than inherited, because a step that only strands when some earlier step
   * happens to have moved a ref is a step that passes in sequence and fails alone.
   */
  repo.git(['checkout', '-q', 'behind']);
  repo.write('stranded.txt', 'a commit only behind has\n');
  repo.git(['add', 'stranded.txt']);
  // `--only`, so this commits that one path and leaves the rest of the working tree
  // alone. `add -A` here would sweep the fixture's own dirty files onto `behind` and hand
  // the next step a clean tree, which is not its to change: that step's *Reset* box is
  // disabled when there is nothing to reset.
  repo.git([...IDENT, 'commit', '-q', '--only', 'stranded.txt', '-m', 'behind: stranded work']);
  repo.git(['checkout', '-q', '-']);
  await refreshApp(app);

  // Read before the dialog runs. Asserted against where it *was*, not against a commit it
  // might already have been at: a step whose expectation is satisfied by the fixture
  // proves nothing.
  const wasAt = repo.git(['rev-parse', 'behind']);

  await selectCommit(app, 'feature work');
  const dialog = await openViaPalette(app, 'Reset Another Branch to Here', 'Reset Another Branch');
  await dialog.setSelect('behind');
  // The ancestor check is a git call, and the button stays disabled until it answers,
  // which is what the tick below waits through.
  await dialog.tick('Move it anyway');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Move Branch');
  await app.expectFormsClosed();

  const moved = repo.git(['rev-parse', 'behind']);
  expect(moved, 'behind did not move at all').not.toBe(wasAt);
  expect(repo.subject(moved)).toBe('feature work');
});

test('checkout revision, a tag, onto a detached HEAD', async ({ app, repo }, testInfo) =>
{
  await selectCommit(app, 'base');
  const dialog = await openViaPalette(app, 'Checkout This Commit', 'Checkout Revision');
  await dialog.tick('Reset');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Checkout');
  await app.expectFormsClosed();

  expect(repo.branch(), 'expected a detached HEAD').toBe('HEAD');
});

test('reset current branch, hard', async ({ app, repo }, testInfo) =>
{
  // Back onto a branch first: resetting a detached HEAD moves nothing anyone can find.
  repo.git(['checkout', '-q', 'feature']);
  await refreshApp(app);
  await selectCommit(app, 'base');

  const dialog = await openViaPalette(app, 'Reset Current Branch to Here', 'Reset Current Branch');
  await dialog.tick('Hard');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Reset');
  await settle(900);
  const [confirm] = app.dialogWindows();
  if (confirm)
  {
    await new Dialog(confirm).click('Reset and discard changes');
  }
  await app.expectFormsClosed();

  expect(repo.subject()).toBe('base');
});

test('undo last commit', async ({ app, repo }, testInfo) =>
{
  repo.git(['checkout', '-q', '-B', 'undo-me', 'main']);
  await refreshApp(app);
  const dialog = await openViaPalette(app, 'Undo Last Commit', 'Undo Last Commit');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Undo Commit');
  await app.expectFormsClosed();

  expect(repo.subject()).toBe('base');
  // The whole point of a soft reset: the changes come back staged, not lost.
  expect(
    repo.status().split('\n').some((line) => line.startsWith('A ')),
    "the undone commit's changes did not come back staged"
  ).toBe(true);
});

test('reset changes, deleting new files too', async ({ app, repo }, testInfo) =>
{
  repo.write('scratch.txt', 'delete me\n');
  await refreshApp(app);
  const dialog = await openViaPalette(app, 'Reset Changes', 'Reset all changes');
  await dialog.tick('Also delete new files');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Discard Changes');
  await app.expectFormsClosed();

  expect(repo.status(), 'working tree not clean').toBe('');
  expect(repo.exists('scratch.txt'), 'the untracked file survived the clean').toBe(false);
});

test('stash from one window, pop it back from the other', async ({ app, repo }, testInfo) =>
{
  repo.git(['checkout', '-q', '-B', 'stash-me', 'main']);
  repo.write('a.txt', 'stashed edit\n');
  repo.write('fresh.txt', 'untracked\n');
  await refreshApp(app);

  // Two windows, and the pair is the point: this one only saves, so its title is what it
  // does and there is no row on it that puts a stash back.
  const saving = await openViaPalette(app, 'Stash Changes…', 'Stash Changes');
  await saving.setText('from the tour');
  await testInfo.attach('preview', { body: await saving.preview() });
  await saving.click('Stash');
  // Waited for by asking git, which is the assertion anyway: it returns the moment the
  // stash lands rather than a fixed guess at how long that takes.
  await expect(() =>
  {
    expect(repo.status(), 'the stash left changes behind').toBe('');
    expect(repo.stashCount(), 'no stash was created').toBe(1);
  }).toPass({ timeout: 8000 });
  await saving.page.close().catch(() =>
  {});
  await settle(600);

  // The other window: a list of what is stashed, opened on the newest, with the three
  // things you can do to one under it. It is never the save form, whatever the repository
  // holds, which is the fault it was split out to fix.
  const managing = await openViaPalette(app, 'Manage Stashes…', 'Manage Stashes');
  await expect(
    managing.page.locator('.list.side .entry'),
    'the stash just made to appear in the list'
  ).toHaveCount(1);
  await managing.click('Pop');
  await expect(
    () => expect(repo.stashCount()).toBe(0),
    'the stash was not dropped by the pop'
  ).toPass({ timeout: 8000 });
  await managing.page.close().catch(() =>
  {});
  // Both halves came back: the tracked edit and the untracked file `-u` swept in.
  expect(repo.status(), 'the tracked change did not come back').toContain('a.txt');
  expect(repo.exists('fresh.txt'), 'the untracked file did not come back, was -u dropped?').toBe(
    true
  );
});

test('fetch with pruning, against a real remote', async ({ app, repo }, testInfo) =>
{
  repo.git(['checkout', '-q', '-B', 'main-again', 'main']);
  // A tracking ref for a branch that is not on the remote, so the prune has work.
  repo.git(['update-ref', 'refs/remotes/origin/ghost', 'main']);
  await refreshApp(app);

  const dialog = await openViaPalette(app, 'Pull', 'Pull / Fetch');
  await dialog.tick('Fetch only');
  // Pruning is one of the eight things a fetch can also be told, so it lives behind the
  // fold: "pull from origin" is what the window opens on.
  await dialog.openAdvanced();
  await dialog.tick('Delete tracking refs');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Fetch');
  await app.expectFormsClosed(15_000);

  const refs = repo.git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes']);
  expect(refs, 'the stale tracking ref survived the prune').not.toContain('origin/ghost');
  expect(refs, 'the fetch removed real refs').toContain('origin/main');
});

test('push, get rejected, and recover with pull-and-rebase', async ({ app, repo }, testInfo) =>
{
  const origin = originOf(repo.dir);
  const other = path.join(repo.dir, '..', `${path.basename(repo.dir)}-other`);

  // Somebody else pushes first. That is the whole scenario: the rejection is the normal
  // outcome of a shared branch, not a failure of the dialog.
  fs.rmSync(other, { recursive: true, force: true });
  repo.git(['clone', '-q', origin, other], os.tmpdir());
  fs.writeFileSync(path.join(other, 'theirs.txt'), 'theirs\n');
  repo.git(['add', '.'], other);
  repo.git([...IDENT, 'commit', '-q', '-m', 'their commit'], other);
  repo.git(['push', '-q', 'origin', 'main'], other);

  // Guarded, because it is the whole scenario: if `main` does not land on `origin/main`
  // the two have unrelated histories by the time the dialog opens, the recovery rebase
  // cannot apply, and the step reports "the dialog stayed open": which is true and says
  // nothing about a setup line that refused twenty lines earlier.
  const reset = repo.git(['checkout', '-q', '-B', 'main', 'origin/main']);
  expect(
    repo.git(['rev-parse', 'main']),
    `setup: main would not reset to origin/main, ${reset}`
  ).toBe(repo.git(['rev-parse', 'origin/main']));
  repo.git(['fetch', '-q', 'origin']);
  repo.git(['reset', '-q', '--hard', 'origin/main~1']);
  repo.write('mine.txt', 'mine\n');
  repo.git(['add', '.']);
  repo.git([...IDENT, 'commit', '-q', '-m', 'my commit']);

  await refreshApp(app);

  const dialog = await openViaPalette(app, 'Push', 'Push');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Push');
  // The branch may have no upstream, in which case the tracking prompt comes first. Given
  // a couple of seconds to appear: if it does not, this push already had one and the
  // rejection below is what comes next.
  const upstream = dialog.button('Push and set upstream');
  if (await upstream.isVisible({ timeout: 2000 }).catch(() => false))
  {
    await upstream.click();
  }

  // A rejection replaces the form rather than adding buttons under it, so what is on
  // screen now is the explanation, the three answers as a radio group, and one confirming
  // button carrying the chosen answer's name.
  // Over the network, so it is given longer than the usual wait: a condition, not a sleep.
  await expect(dialog.page.locator('body'), 'the rejection did not replace the form').toContainText(
    'git refused rather than discarding them',
    { timeout: 20_000 }
  );
  expect(await dialog.preview(), 'the chosen remedy was not previewed').toContain('pull --rebase');

  await dialog.click('Pull with rebase, then push');
  await app.expectFormsClosed(20_000);

  // Replayed on top of theirs, and pushed: both commits reachable from origin/main.
  const remote = repo.git(['log', '--oneline', '-2', 'origin/main']);
  expect(remote, 'the push never landed').toContain('my commit');
  expect(remote, 'the rebase dropped the commit that caused the rejection').toContain(
    'their commit'
  );
});

test('create an annotated tag and push it', async ({ app, repo }, testInfo) =>
{
  repo.git(['checkout', '-q', '-B', 'tag-me', 'main']);
  await refreshApp(app);
  await selectCommit(app, 'base');

  const dialog = await openViaPalette(app, 'Create Tag Here', 'Create Tag');
  await dialog.setText('v9.9');
  // `-a` with no `-F` sends git to an editor, and the one a spawn here gets writes
  // nothing, so git answers `no tag message?`. The form is what has to refuse it.
  await expect(
    dialog.button('Create Tag'),
    'the form offered an annotated tag with no message'
  ).toBeDisabled();
  await dialog.setTextArea('tagged by the tour');
  // Where the tag goes is behind the fold: a name and a message is the whole of it nearly
  // every time.
  await dialog.openAdvanced();
  await dialog.setSelect('origin');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Create Tag');
  await app.expectFormsClosed(15_000);

  // An *annotated* tag: the kind is the choice this dialog exists to offer, and a
  // lightweight one would have no message to read back.
  expect(repo.git(['cat-file', '-t', 'v9.9']), 'the tag is not an annotated tag object').toBe(
    'tag'
  );
  expect(
    repo.git(['tag', '-l', '--format=%(contents)', 'v9.9']),
    'the message did not reach the tag'
  ).toContain('tagged by the tour');
  expect(repo.git(['tag', '-l'], originOf(repo.dir)), 'the tag was not pushed').toContain('v9.9');
});

test('delete two branches at once, forcing the unmerged one', async ({ app, repo }, testInfo) =>
{
  repo.git(['branch', '-f', 'doomed-merged', 'main']);
  repo.git(['checkout', '-q', '-B', 'doomed-unmerged', 'main']);
  repo.write('doomed.txt', 'only here\n');
  repo.git(['add', '.']);
  repo.git([...IDENT, 'commit', '-q', '-m', 'unmerged work']);
  repo.git(['checkout', '-q', 'main']);
  await refreshApp(app);

  const dialog = await openViaPalette(app, 'Delete Branches', 'Delete Branches');
  await dialog.tickInList('doomed-merged');
  await dialog.tickInList('doomed-unmerged');
  await dialog.tick('Delete even the ones that are not merged');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Delete 2 Branches');
  await app.expectFormsClosed(12_000);

  const names = repo.branches();
  expect(names, 'the merged branch survived').not.toContain('doomed-merged');
  expect(names, 'the unmerged branch survived the force').not.toContain('doomed-unmerged');
});

test('set a branch’s upstream, from the panel row it belongs to', async ({ app, repo }, testInfo) =>
{
  // Created rather than borrowed: the assertion is that the two config keys were written,
  // so the branch has to start with neither. `git branch <name>` sets no upstream, which
  // is exactly the state this dialog exists for.
  repo.git(['branch', '-f', 'untracked-branch', 'main']);
  await refreshApp(app);

  // The command's operand is the panel row, so the row has to be selected before the
  // palette will offer it at all: its `when` is a local branch node.
  await selectPanelNode(app, 'untracked-branch', 'Branches');
  const dialog = await openViaPalette(app, 'Set Upstream', 'Set Upstream');
  await dialog.setSelect('origin/main');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Set Upstream');
  await app.expectFormsClosed();

  // Asserted here rather than only at the end: the second half clears it again, and
  // "tracks nothing" afterwards is satisfied by a branch that never tracked anything.
  expect(
    repo.git(['config', '--get', 'branch.untracked-branch.merge']),
    'the upstream was not set'
  ).toBe('refs/heads/main');

  // And back to nothing, which is the picker's own first row: a branch that should track
  // nothing is an answer, so it is in the list rather than behind a second button.
  await selectPanelNode(app, 'untracked-branch', 'Branches');
  const clearing = await openViaPalette(app, 'Set Upstream', 'Set Upstream');
  await clearing.setSelect('');
  await testInfo.attach('preview (clearing)', { body: await clearing.preview() });
  // A different button label, because it is a different command: see `actionLabel`.
  await clearing.click('Stop Tracking');
  await app.expectFormsClosed();

  expect(repo.git(['config', '--get', 'branch.untracked-branch.remote'])).toBe('');
  expect(repo.git(['config', '--get', 'branch.untracked-branch.merge'])).toBe('');
});
