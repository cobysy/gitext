/**
 * The dialogs that act on the working tree, on a file, and on a remote: reverting,
 * cleaning, archiving, ignoring, a file's history, the remote list, worktrees,
 * submodules, and patches in both directions.
 *
 * The second of three files that between them drive every operation dialog: see
 * `e2e/support/dialogsTour.ts` for what they share.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { originOf } from './fixtures/dialogsRepo.js';
import { waitForConsole } from './support/console.js';
import {
  refreshApp,
  selectCommit,
  selectFileRow,
  modClickNeighbour,
  selectFirstCommitRow,
  selectWorkingTreeRow
} from './support/grid.js';
import { openViaPalette, runViaPalette } from './support/palette.js';
import { expandPanel, selectPanelNode } from './support/panel.js';
import { settle } from './support/options.js';
import { IDENT } from './support/repo.js';
import { DIALOG_SETTINGS } from './support/dialogsTour.js';
import { expect, test } from './support/tour.js';

test.use({ tourName: 'dialogs-worktree', seedSettings: DIALOG_SETTINGS });

test('revert a merge commit, naming the mainline parent', async ({ app, repo }, testInfo) =>
{
  // A *merge*, deliberately: reverting one is undefined until a parent is named, and the
  // dialog that could not name one could not revert a merge at all.
  repo.git(['checkout', '-q', '-B', 'side', 'main']);
  repo.write('side.txt', 'from the side\n');
  repo.git(['add', '.']);
  repo.git([...IDENT, 'commit', '-q', '-m', 'side work']);
  repo.git(['checkout', '-q', '-B', 'merge-host', 'main']);
  repo.git([...IDENT, 'merge', '-q', '--no-ff', '-m', 'the merge', 'side']);

  await refreshApp(app);
  await selectCommit(app, 'the merge');

  const dialog = await openViaPalette(app, 'Revert This Commit', 'Revert Commit');
  // The parent list only exists for a merge; its absence here is the bug this step was
  // written for.
  await expect(
    dialog.page.locator('body'),
    'no mainline parent list on a merge commit'
  ).toContainText('Mainline parent');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Revert');
  await app.expectFormsClosed(12_000);

  expect(repo.subject(), 'expected a revert of the merge').toMatch(/^Revert "the merge"/);
  expect(
    repo.exists('side.txt'),
    'the merged-in file is still there: the revert took the wrong side'
  ).toBe(false);
});

test('clean the working directory, previewing first', async ({ app, repo }, testInfo) =>
{
  repo.write('rubbish.txt', 'delete me\n');
  fs.mkdirSync(path.join(repo.dir, 'rubbish-dir'), { recursive: true });
  repo.write('rubbish-dir/inner.txt', 'me too\n');
  await refreshApp(app);

  const dialog = await openViaPalette(app, 'Clean Working Directory', 'Clean Working Directory');
  await dialog.click('Preview');
  // The preview is the reason this dialog exists: it must list the files *before* the
  // button that deletes them, and it must list the ones that are actually there. The list
  // is git's own output, so it is read where all of that goes: the console.
  const dryRun = await waitForConsole(app);
  await dryRun.expectOutput('rubbish.txt');
  await dryRun.dismiss();

  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Clean');
  await settle(800);
  await dialog.click('Delete them');

  // The clean names each file it removed, and that console stays up rather than closing
  // itself: what was deleted is recorded nowhere else in the app, so the window holding
  // the list is not something to blink away.
  const removed = await waitForConsole(app);
  await removed.expectOutput('rubbish.txt');
  await removed.dismiss();
  await app.expectFormsClosed(12_000);

  expect(repo.exists('rubbish.txt'), 'the untracked file survived the clean').toBe(false);
  expect(repo.exists('rubbish-dir'), '-d did not take the untracked directory').toBe(false);
});

test('archive a revision to a file the command names', async ({ app, repo }, testInfo) =>
{
  const target = path.join(repo.dir, '..', `${path.basename(repo.dir)}-archive.zip`);
  fs.rmSync(target, { force: true });
  await refreshApp(app);
  await selectCommit(app, 'base');

  const dialog = await openViaPalette(app, 'Archive This Commit', 'Archive Revision');
  await dialog.setTextByLabel('Save to', target);
  const preview = await dialog.preview();
  await testInfo.attach('preview', { body: preview });
  // The destination is *in* the argv: a version that wrote the file from the main process
  // previewed a command that named nowhere to put it.
  expect(preview, 'the preview does not name the destination').toContain('--output');
  await dialog.click('Create Archive');
  await app.expectFormsClosed(12_000);

  expect(fs.existsSync(target), 'no archive was written').toBe(true);
  fs.rmSync(target, { force: true });
});

test('ignore a file, previewing the lines it will write', async ({ app, repo }, testInfo) =>
{
  repo.write('ignore-me.log', 'noise\n');
  await refreshApp(app);
  // The working-tree row, so the file list below has something in it and the file commands
  // have an operand.
  await selectWorkingTreeRow(app);
  await selectFileRow(app, 'ignore-me.log');

  const dialog = await openViaPalette(app, 'Add to .gitignore', 'Ignore Files');
  // There is no argv for a file append, so the preview is the *result*: the rules it is
  // about to write, and where they will go.
  const result = dialog.page.locator('.result');
  await expect(result, 'the resulting-file preview showed nothing').toContainText('ignore-me.log');
  await testInfo.attach('preview', { body: (await result.textContent()) ?? '' });
  await dialog.click('Add to .gitignore');
  await app.expectFormsClosed(12_000);

  expect(repo.fileText('.gitignore'), '.gitignore does not carry the rule').toContain(
    'ignore-me.log'
  );
  expect(repo.status(), 'git still reports the file as untracked').not.toContain('ignore-me.log');
});

test('file history, its Diff, Blame and View tabs, and the working tree as a blame line', async ({
  app,
  repo
}) =>
{
  // A known edit, independent of whatever earlier steps left the working tree in: its
  // dirty state at this point is not this step's to assume.
  repo.write('a.txt', 'one\nedited by the tour\n');
  await refreshApp(app);

  // Off the working-tree row and back onto it, so the click below is a genuine *change*
  // of selection rather than a no-op re-click of wherever the step before left off.
  await selectFirstCommitRow(app);
  // The working-tree row, so the file list has a.txt in it with something to blame as
  // uncommitted.
  await selectWorkingTreeRow(app);
  await selectFileRow(app, 'a.txt');

  const dialog = await openViaPalette(app, 'File History…', 'File History: a.txt');

  // The list: the fixture's base commit, which created a.txt, and the working directory
  // row first, since that is what the dialog is opened *about*.
  const entries = dialog.page.locator('.list.side .entry');
  await expect(
    entries.filter({ hasText: 'base' }),
    'the commit list is missing the commit that created a.txt'
  ).toHaveCount(1);
  await expect(
    entries.first(),
    'the working-directory row is not first in the list'
  ).toContainText('Working directory');

  // Diff: opens here by default, and a.txt has a real unstaged edit to show.
  await expect(
    dialog.page.locator('.pane:not(.hidden) .placeholder'),
    "the Diff tab found nothing to show for a.txt's unstaged edit"
  ).toHaveCount(0);

  // Blame: the working tree's own edit reads as git's "Not Committed Yet", not as
  // whichever commit last touched the line on disk.
  await dialog.click('Blame');
  await expect(
    dialog.page.locator('.gutter .row').filter({ hasText: 'Uncommitted' }).first(),
    'blaming the working tree did not attribute the edited line to "Not Committed Yet"'
  ).toBeVisible();

  // View: the file's current, uncommitted content, read through Monaco's model.
  await dialog.click('View');
  await settle(800);
  expect(
    await dialog.visiblePaneText(),
    "the View tab did not show the working tree's own content"
  ).toContain('edited by the tour');

  await dialog.click('Close');
  await app.expectFormsClosed();

  // Read-only: a browse dialog that ran no argv must not have moved anything.
  expect(
    repo.status(),
    'the working tree ended up clean: File History must not have touched it'
  ).not.toBe('');
});

test('add a remote with separate fetch and push URLs', async ({ app, repo }, testInfo) =>
{
  const dialog = await openViaPalette(app, 'Manage Remotes', 'Manage Remotes');
  await dialog.clickText('Add a remote…');
  await dialog.setTextByLabel('Name', 'mirror');
  await dialog.setTextByLabel('Fetch from', 'https://example.com/mirror.git');
  await dialog.setTextByLabel('Push to', 'git@example.com:mirror.git');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Add Remote');
  // Both commands, not just the first. This is two runs (`remote add`, then `set-url
  // --push`), and waiting for the fetch URL is waiting for a *sign* that the operation
  // finished rather than for the operation: under load the dialog was closed with the
  // second command still in flight, and the push URL never landed.
  await expect(
    () =>
    {
      const written = repo.git(['remote', '-v']);
      expect(written).toContain('https://example.com/mirror.git');
      // The half a single-URL form could not express at all.
      expect(written).toContain('git@example.com:mirror.git');
    },
    'the remote was not added with both URLs'
  ).toPass({ timeout: 8000 });
  await app.closeDialogs();
});

test('deactivate a remote from the dialog, and switch it back on', async ({ app, repo }) =>
{
  // Its own setup, so the step stands alone: the remote it switches off has to exist.
  if (!repo.git(['remote']).split('\n').includes('mirror'))
  {
    repo.git(['remote', 'add', 'mirror', 'https://example.com/mirror.git']);
    await refreshApp(app);
  }

  const dialog = await openViaPalette(app, 'Manage Remotes', 'Manage Remotes');
  await dialog.selectEntry('mirror');
  await dialog.click('Deactivate');
  await expect(
    () => expect(repo.git(['remote']).split('\n')).not.toContain('mirror'),
    'git still lists mirror after the dialog deactivated it'
  ).toPass({ timeout: 8000 });

  // The row has to reappear under the Inactive heading. A deactivated remote that
  // vanished from this window, which is what happens if the list is read with
  // `git remote`, could never be switched back on from it.
  const inactive = dialog.page.locator('.list.side > li');
  await expect(
    inactive.filter({ hasText: /^\s*Inactive\s*$/ }),
    'the deactivated remote is not under an Inactive heading'
  ).toHaveCount(1);
  await expect(
    dialog.page.locator('.list.side .entry').filter({ hasText: 'mirror' }).first()
  ).toBeVisible();

  // Read-only while it is off: git cannot see the section, so every command the form
  // would build fails with "No such remote".
  await expect(
    dialog.page.locator('.form input').first(),
    'the form is still editable for an inactive remote'
  ).toBeDisabled();

  await dialog.click('Activate');
  await expect(
    () => expect(repo.git(['remote']).split('\n')).toContain('mirror'),
    'mirror did not come back'
  ).toPass({ timeout: 8000 });
  await app.closeDialogs();
  expect(
    repo.git(['config', '--get', 'remote.mirror.url']),
    'mirror came back without the URL it was parked with'
  ).toBe('https://example.com/mirror.git');
  // Nothing may be left under the disabled spelling, or the next deactivation would
  // rename onto a section that already exists and merge the two.
  expect(
    repo.git(['config', '--get', '--', '-remote.mirror.url']),
    'the disabled section was left behind'
  ).toBe('');
});

test('create a worktree on a new branch', async ({ app, repo }, testInfo) =>
{
  const target = path.join(repo.dir, '..', `${path.basename(repo.dir)}-wt`);
  fs.rmSync(target, { recursive: true, force: true });

  const dialog = await openViaPalette(app, 'Create Worktree', 'Create Worktree');
  await dialog.setTextByLabel('Folder', target);
  await dialog.setTextByLabel('Branch name', 'in-a-worktree');
  // Off, or the repository window follows it and every later step is in the worktree.
  await dialog.tick('Open it when it is created');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Create Worktree');
  await app.expectFormsClosed(15_000);

  expect(repo.git(['worktree', 'list']), 'the worktree was not created').toContain(
    'in-a-worktree'
  );
});

test('the submodule list previews what it would run for all of them', async ({ app }, testInfo) =>
{
  // Nothing to assert against git: this repository has no submodules, and the step is
  // about the window opening on the right row with the right command on it.
  const dialog = await openViaPalette(app, 'Manage Submodules', 'Submodules');
  // Waited for rather than read once. This dialog's preview is not in the document when
  // the window draws its heading, so `openViaPalette` has nothing to wait on and a single
  // read gets the empty string: the assertion has to be the one that retries.
  //
  // Opened on the "All submodules" row, which is what makes the two menu rows that act on
  // every submodule at once previewable rather than blind.
  await expect(dialog.page.locator('.preview code').first()).toContainText(
    'submodule update --init --recursive'
  );
  await testInfo.attach('preview', { body: await dialog.preview() });
  await app.closeDialogs();
});

test('format a patch and apply it back', async ({ app, repo }, testInfo) =>
{
  repo.git(['checkout', '-q', '-B', 'patch-me', 'main']);
  repo.write('patched.txt', 'exported\n');
  repo.git(['add', '.']);
  repo.git([...IDENT, 'commit', '-q', '-m', 'a commit to export']);
  await refreshApp(app);

  const out = path.join(repo.dir, '..', `${path.basename(repo.dir)}-patches`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const dialog = await openViaPalette(app, 'Format Patch', 'Format Patch');
  // It opens on "everything on the branch" when nothing named a range, which hides the
  // older end: untick it and the range fields appear.
  await dialog.tick('Everything on the branch');
  await dialog.setTextByLabel('After', 'main');
  await dialog.setTextByLabel('Up to and including', 'patch-me');
  await dialog.setTextByLabel('Write to', out);
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Format Patch');
  await app.expectFormsClosed(12_000);

  const written = fs.readdirSync(out).filter((f) => f.endsWith('.patch'));
  expect(written, 'expected exactly one patch file').toHaveLength(1);

  // And back in: the round trip is the reason `am` is here at all.
  repo.git(['reset', '-q', '--hard', 'main']);
  await refreshApp(app);

  const apply = await openViaPalette(app, 'Apply Patch', 'Apply Patch');
  await apply.setTextByLabel('Patch', path.join(out, written[0]!));
  await testInfo.attach('preview (apply)', { body: await apply.preview() });
  await apply.click('Apply');
  await app.expectFormsClosed(15_000);
  fs.rmSync(out, { recursive: true, force: true });

  expect(repo.subject(), 'the patch did not come back as a commit').toBe('a commit to export');
});

test('compare two commits in a window of its own', async ({ app }) =>
{
  // A window and its panes rather than a repository state: everything here is asserted on
  // screen, and the step must leave the repository exactly as it found it.
  await refreshApp(app);
  await selectCommit(app, 'base');
  await modClickNeighbour(app);

  const dialog = await openViaPalette(app, 'Compare Selected Commits', 'Compare');

  // The two cards are the point of this dialog: a SHA is opaque, so each end says which
  // commit it is and when. Without them "base → compare" names two things and explains
  // neither.
  const slots = dialog.page.locator('.slot-wrap');
  await expect(slots, 'expected two revision slots').toHaveCount(2);
  // Case-insensitive because the labels are uppercased in CSS, and the DOM carries what
  // the template said.
  await expect(slots.nth(0)).toContainText(/^\s*base/i);
  await expect(slots.nth(1)).toContainText(/^\s*compare/i);
  // Each card carries a SHA, a subject and an author line, which is the whole reason it
  // is a card rather than a name.
  for (const card of await slots.allInnerTexts())
  {
    expect(card.split('\n').filter(Boolean).length, 'a slot is not showing a whole commit')
      .toBeGreaterThanOrEqual(4);
  }

  // And the file list is pointed at that range: the dialog's own pane, not the repository
  // window's, which is still answering its own question behind this.
  // `.first()`: the window's own header and the file list's strip both carry `.bar`, and
  // the range is on the header. Left unqualified this is a strict-mode violation rather
  // than a wrong answer, which is Playwright refusing to guess for us.
  const bar = dialog.page.locator('.bar').first();
  await expect(bar, 'the file list is not showing a range').toContainText('→');

  // Swapping has to carry each end's *name* with its endpoint. When the name was a prop
  // and the endpoint a model this swapped one and not the other, and the base card read
  // `main` above the other side's SHA.
  const range = /[0-9a-f]{7,} → [0-9a-f]{7,}/;
  const before = (await bar.innerText()).match(range)?.[0] ?? '';
  await dialog.page.click('.swap');
  if (before)
  {
    // The redraw is the assertion: the range on the header stops being the one read above.
    await expect(bar, `swapping the ends did not change the range (${before})`).not.toContainText(
      before
    );
  }

  await app.closeDialogs();
});

/**
 * Deactivating a remote, and bringing it back.
 *
 * The one operation in the app git has no command for: the config section is renamed from
 * `remote.origin` to `-remote.origin`, which git then cannot see. Driven rather than
 * unit-tested because the failure that matters is not the argv: it is a remote that comes
 * back without its URL, or one that vanishes from the panel with no row left to switch it
 * on again.
 */
test('deactivate a remote, then bring it back with its URL intact', async ({ app, repo }) =>
{
  const before = repo.git(['config', '--get', 'remote.origin.url']);

  await selectPanelNode(app, 'origin', 'Remotes');
  await runViaPalette(app, 'Deactivate Remote');

  expect(
    repo.git(['remote']).split('\n'),
    'git still lists origin after it was deactivated'
  ).not.toContain('origin');
  expect(
    repo.git(['config', '--get', '--', '-remote.origin.url']),
    'the URL did not survive deactivation'
  ).toBe(before);

  // The row it is switched back on from: the assertion that a deactivated remote is still
  // reachable in the panel, which is what makes this reversible at all.
  await refreshApp(app);
  await expandPanel(app);
  await expect(
    app.main
      .locator('.left-panel .row.disabled')
      .filter({ has: app.main.locator('.label', { hasText: /^\s*origin\s*$/ }) })
      .first(),
    'the deactivated remote is nowhere in the panel'
  ).toBeVisible();

  await selectPanelNode(app, 'origin', 'Remotes');
  await runViaPalette(app, 'Activate Remote');

  expect(repo.git(['remote']).split('\n'), 'origin did not come back').toContain('origin');
  expect(
    repo.git(['config', '--get', 'remote.origin.url']),
    'origin came back without its URL'
  ).not.toBe('');
  // Nothing may be left under the disabled spelling, or the next deactivation would
  // rename onto a section that already exists and merge the two.
  expect(
    repo.git(['config', '--get', '--', '-remote.origin.url']),
    'the disabled section was left behind'
  ).toBe('');
});

/**
 * Fetching one remote branch, with no window in the way.
 *
 * The row runs the fetch and only shows the pull form if it fails. The thing worth
 * driving is the *absence* of a dialog: a step that only checked the tracking ref moved
 * would pass just as well if a window had opened and been dismissed.
 */
test('fetch one remote branch: it runs in the console, with no form', async ({ app, repo }) =>
{
  const origin = originOf(repo.dir);
  const other = path.join(repo.dir, '..', `${path.basename(repo.dir)}-fetch-other`);

  repo.git(['push', '-q', 'origin', 'HEAD:refs/heads/fetch-me']);
  repo.git(['fetch', '-q', 'origin']);
  const stale = repo.git(['rev-parse', 'refs/remotes/origin/fetch-me']);

  /*
   * Somebody *else* moves the branch, from a second clone.
   *
   * Pushing it from this repository would not do: a successful push updates the
   * remote-tracking ref for what it pushed, so the fetch under test would have nothing
   * left to bring back and the step would pass without exercising anything. Caught by the
   * guard below, which is why the guard is here.
   */
  fs.rmSync(other, { recursive: true, force: true });
  repo.git(['clone', '-q', '-b', 'fetch-me', origin, other], os.tmpdir());
  fs.writeFileSync(path.join(other, 'theirs.txt'), 'theirs\n');
  repo.git(['add', '.'], other);
  repo.git([...IDENT, 'commit', '-q', '-m', 'their fetch-me commit'], other);
  repo.git(['push', '-q', 'origin', 'fetch-me'], other);
  const landed = repo.git(['rev-parse', 'HEAD'], other);

  expect(
    repo.git(['rev-parse', 'refs/remotes/origin/fetch-me']),
    'the tracking ref moved before the fetch: the step proves nothing'
  ).toBe(stale);
  await refreshApp(app);

  await selectPanelNode(app, 'fetch-me', 'Remotes');
  await runViaPalette(app, 'Fetch This Branch');

  // The console, and nothing else: fetching is over the network, so it is watched
  // whatever the setting says, but there is still no form to fill in. It closes itself
  // once the fetch succeeds, which is what leaves the next step a clean desk.
  const forms = await Promise.all((await app.formWindows()).map((w) => w.title()));
  expect(forms, 'the row opened a dialog instead of just fetching').toEqual([]);
  expect(
    await app.waitClosed(),
    'the console stayed open after a fetch that succeeded'
  ).toBe(true);

  expect(
    repo.git(['rev-parse', 'refs/remotes/origin/fetch-me']),
    'the tracking ref did not pick up their commit'
  ).toBe(landed);
  // The refspec names one branch, so nothing else on the remote may have been touched.
  expect(
    repo.git(['rev-parse', '--verify', 'refs/remotes/origin/main']),
    'the single-branch fetch lost other tracking refs'
  ).not.toBe('');
});

/**
 * Deleting a branch on a real remote, from the row that names it.
 *
 * A push, for everybody, with no local undo: so the thing being checked is that the
 * preview said exactly what ran, and that it ran against the remote rather than only
 * removing the tracking ref locally.
 */
test('delete a branch on the remote, and the local one tracking it', async ({
  app,
  repo
}, testInfo) =>
{
  repo.git(['branch', '-f', 'doomed-remote', 'main']);
  repo.git(['push', '-q', 'origin', 'doomed-remote']);
  repo.git(['branch', '--set-upstream-to=origin/doomed-remote', 'doomed-remote']);
  await refreshApp(app);

  // Under Remotes, not Branches: both sections have a row labelled `doomed-remote`.
  await selectPanelNode(app, 'doomed-remote', 'Remotes');
  const dialog = await openViaPalette(app, 'Delete Remote Branch…', 'Delete Branches on origin');

  // The half nobody remembers: without it the local branch is left tracking a ref that no
  // longer exists, which is where `[gone]` comes from.
  await dialog.tick('Delete the local branch doomed-remote too');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Delete on Remote');
  await app.expectFormsClosed(15_000);

  expect(
    repo.git(['ls-remote', '--heads', 'origin', 'doomed-remote']),
    'the branch is still on the remote'
  ).toBe('');
  expect(repo.branches(), 'the local tracking branch was left behind').not.toContain(
    'doomed-remote'
  );
});

/*
 * Rewording, both shapes.
 *
 * Two steps because they are two different commands: HEAD is one `commit --amend`, and
 * anything below it is an `amend!` marker plus an autosquash rebase. Each builds its own
 * commits rather than using the fixture's: rewording rewrites history, so a step that
 * reworded `base` would move the ground under every step that names it.
 */
