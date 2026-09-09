/**
 * The dialogs that rewrite history, and the ones that act on the repository itself:
 * rewording, going to a commit, searching, `gc`, `fsck`, the stale lock, the files a
 * repository is configured by, and making or cloning one.
 *
 * The last of three files that between them drive every operation dialog: see
 * `e2e/support/dialogsTour.ts` for what they share.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Dialog } from './support/dialog.js';
import { SCRATCH } from './fixtures/dialogsRepo.js';
import { waitForConsole } from './support/console.js';
import { refreshApp, selectCommit } from './support/grid.js';
import { openViaPalette, runViaPalette } from './support/palette.js';
import { IDENT } from './support/repo.js';
import { DIALOG_SETTINGS } from './support/dialogsTour.js';
import { expect, test } from './support/tour.js';

test.use({ tourName: 'dialogs-history', seedSettings: DIALOG_SETTINGS });

test('reword HEAD, one amend, and staged work left alone', async ({ app, repo }, testInfo) =>
{
  repo.write('reword-head.txt', 'reword me\n');
  repo.git(['add', 'reword-head.txt']);
  repo.git([...IDENT, 'commit', '-q', '-m', 'tour: a typo in the subejct']);

  // Staged, and it must still be staged afterwards: `--only` is what keeps a reword from
  // quietly committing whatever happened to be in the index, and this is the only place
  // that promise is actually driven.
  repo.write('reword-staged.txt', 'work in progress\n');
  repo.git(['add', 'reword-staged.txt']);

  await refreshApp(app);
  await selectCommit(app, 'tour: a typo in the subejct');
  const dialog = await openViaPalette(app, 'Reword Commit', 'Reword Commit');

  // The box opens on the message it is about to replace: a reword that made you retype
  // the message from memory would not be one. It arrives from git after the window has
  // already drawn, so it is waited for rather than read once.
  await expect(
    dialog.page.locator('textarea'),
    "the message box to prefill with the commit's own message"
  ).toHaveValue('tour: a typo in the subejct');

  // HEAD, so no warning about rebuilt SHAs: nothing below it is touched.
  await expect(
    dialog.page.locator('.note.warning'),
    'rewording HEAD warned about rewriting descendants'
  ).toHaveCount(0);

  await dialog.setTextByLabel('Message', 'tour: a typo in the subject');
  const preview = await dialog.preview();
  await testInfo.attach('preview', { body: preview });
  expect(preview, 'rewording HEAD should be one amend --only').toContain('--amend');
  expect(preview).toContain('--only');
  expect(preview, 'rewording HEAD should not rebase').not.toContain('rebase');
  await dialog.click('Reword');
  await app.expectFormsClosed(15_000);

  expect(repo.subject(), 'the message did not change').toBe('tour: a typo in the subject');
  // The commit still holds its own file, and the staged one was left in the index rather
  // than swept into it.
  expect(
    repo.git(['show', '--name-only', '--format=', 'HEAD']),
    'the reword committed what was staged: --only is not doing its job'
  ).not.toContain('reword-staged.txt');
  expect(
    repo.git(['diff', '--cached', '--name-only']),
    'the staged file is no longer staged'
  ).toContain('reword-staged.txt');
  repo.git(['reset', '-q', 'HEAD', '--', 'reword-staged.txt']);
});

test('reword an older commit, an amend! marker, folded in by autosquash', async ({
  app,
  repo
}, testInfo) =>
{
  repo.write('reword-older.txt', 'older\n');
  repo.git(['add', 'reword-older.txt']);
  repo.git([...IDENT, 'commit', '-q', '-m', 'tour: the older commit\n\nwith a body to replace']);
  repo.write('reword-newer.txt', 'newer\n');
  repo.git(['add', 'reword-newer.txt']);
  repo.git([...IDENT, 'commit', '-q', '-m', 'tour: sits on top of it']);

  // Where things *were*, read now rather than assumed: what the assertions below compare
  // against is this, not wherever the branch might already have been.
  const wasHead = repo.head();
  const wasTarget = repo.git(['rev-parse', 'HEAD~1']);
  const wasCount = repo.git(['rev-list', '--count', 'HEAD']);

  await refreshApp(app);
  await selectCommit(app, 'tour: the older commit');
  const dialog = await openViaPalette(app, 'Reword Commit', 'Reword Commit');

  await expect(
    dialog.page.locator('textarea'),
    'the message box to prefill with the whole message, body and all'
  ).toHaveValue(/with a body to replace/);

  // Not HEAD, so the warning is up. This is the sentence the whole two-command case turns
  // on, every commit after this one is rebuilt, and a step that only checked the argv
  // would pass with it missing.
  await expect(
    dialog.page.locator('.note.warning'),
    'no warning that descendants are rebuilt'
  ).toContainText(/new SHA/i);

  await dialog.setTextByLabel('Message', 'tour: the older commit, reworded');
  const preview = await dialog.preview();
  await testInfo.attach('preview', { body: preview });
  // Two commands, both shown: the marker and the rebase that consumes it. A preview
  // naming only the first would be describing half of what runs.
  expect(preview, 'the preview does not show the amend! marker').toContain('amend!');
  expect(preview).toContain('--allow-empty');
  expect(preview, 'the preview does not show the autosquash rebase').toContain('--autosquash');
  await dialog.click('Reword');
  await app.expectFormsClosed(20_000);

  // The marker was consumed rather than left sitting on the branch, which is the one
  // failure that looks like success until you read the log.
  expect(
    repo.git(['rev-list', '--count', 'HEAD']),
    'the amend! marker is still on the branch: the rebase did not fold it in'
  ).toBe(wasCount);
  // And history really was rebuilt, which is what the warning promised.
  expect(repo.head(), 'HEAD did not move').not.toBe(wasHead);
  expect(
    repo.git(['rev-parse', 'HEAD~1']),
    'the reworded commit kept its SHA, so nothing was rewritten'
  ).not.toBe(wasTarget);

  expect(repo.message('HEAD~1').trim()).toBe('tour: the older commit, reworded');
  // The replacement is a replacement: the old body must be gone, not appended to.
  expect(
    repo.message('HEAD~1'),
    'the old body survived: the message was added to, not replaced'
  ).not.toContain('with a body to replace');
  expect(repo.subject(), 'the commit above it did not survive').toBe('tour: sits on top of it');
  expect(
    repo.git(['log', '--format=%s', '-20']),
    'an amend! commit is still in the history'
  ).not.toContain('amend!');
});

/**
 * Go to Commit: one of the two dialogs here that change nothing and still have to be
 * driven.
 *
 * Everything else in this file asserts against git afterwards. This one cannot: it
 * resolves a revision and moves the *repository window's* selection, so the only evidence
 * it worked is a row in the other window, and the whole path between the two
 * (`dialog:goToRevision` → main → `event:goToRevision` → `reveal`) exists precisely
 * because a dialog is a renderer process with no grid in it.
 */
test('go to a commit by SHA, and watch the grid move in the window behind', async ({
  app,
  repo
}) =>
{
  const headBefore = repo.head();
  const branchesBefore = repo.branches().length;
  await refreshApp(app);

  // The root commit: as far from HEAD as this repository goes, so "the selection moved"
  // is unmistakable, and it exists whatever else has run, which `HEAD~3` does not when
  // this step runs alone. Named by what it *is* rather than by a row number, since the
  // grid's rows shift whenever anything lands above them.
  const root = repo.git(['rev-list', '--max-parents=0', 'HEAD']).split('\n')[0]!;
  const target = repo.git(['rev-parse', '--short', root]);
  const wanted = repo.subject(root).slice(0, 30);

  // Start somewhere else, so "the selection moved" is a real observation rather than a
  // coincidence of where the grid happened to be.
  await selectCommit(app, repo.subject('HEAD'));
  const selected = app.main.locator('.grid .row.selected').first();
  const before = await selected.innerText();

  const dialog = await openViaPalette(app, 'Go to Commit', 'Go to Commit');

  // `fill`, never a keystroke at a time: the box seeds itself from the clipboard, so
  // whatever this machine happens to be holding is already in it. The same trap as the
  // palette's remembered query, one window along.
  await dialog.page.locator('.search').fill(target);

  // The row that says which commit you are about to jump to: the reason this is a
  // resolving picker and not a text box with a Go button beside it.
  await expect(
    dialog.page.locator('.row.active'),
    `the picker to resolve ${target} and show "${wanted}"`
  ).toContainText(wanted);

  await dialog.click('Go');
  await app.expectFormsClosed(20_000);

  // The other window: a SHA typed into a dialog put a different row under the selection.
  // This is the assertion the whole step exists for.
  await expect(selected, `the grid's selection to move to "${wanted}"`).toContainText(wanted);
  expect(await selected.innerText(), 'the selection did not move').not.toBe(before);

  // Nothing ran. A navigation that quietly committed, checked out or moved a ref would be
  // a far worse bug than one that failed to navigate.
  expect(repo.head(), 'going to a commit moved HEAD').toBe(headBefore);
  expect(repo.branches(), 'going to a commit changed the branches').toHaveLength(branchesBefore);
});

/**
 * Find in Files: the other dialog here that changes nothing, and the only one that runs a
 * git command without changing anything.
 *
 * Three things only a driven run can see. That `git grep`'s exit code 1, which is what
 * "no matches" is, reaches the window as an empty list rather than as an error, since
 * `searchGrep` is the only place that distinction is made and a unit test of it proves
 * nothing about what the dialog does with the answer. That the results really are the
 * repository's, hit by hit, rather than a list built from stale state. And the relay out
 * the far side: clicking a hit moves the *repository window's* file pane, which is the
 * same `dialog:*` → `event:*` path Go to Commit drives.
 */
test('search the working tree, and open a hit in the window behind', async ({
  app,
  repo
}, testInfo) =>
{
  const headBefore = repo.head();
  const branchesBefore = repo.branches().length;

  // **The step plants what it looks for.** Many steps have committed, merged, reverted
  // and rebased in this fixture before this one runs, so any word already in it is a word
  // whose count is a function of everything above. These two strings cannot be anywhere.
  const inTracked = 'zzfindmetrackedzz';
  const inUntracked = 'zzfindmeuntrackedzz';

  // Whichever file git says it is tracking, rather than a name from the fixture builder
  // that an earlier step may have moved, deleted or checked away.
  const tracked = repo.git(['ls-files']).split('\n').filter(Boolean)[0];
  expect(tracked, 'the fixture is tracking no files at all').toBeTruthy();

  repo.append(tracked!, `${inTracked}: an uncommitted edit\n`);
  // Not added, so git is not tracking it: `git grep` must not see it, which is half of
  // why this app searches with git rather than walking the directory.
  repo.write('untracked-marker.txt', `${inUntracked}\n`);
  const line = repo.fileText(tracked!).split('\n').length - 1;

  await refreshApp(app);
  // Taken after the two writes: a search must not change the working tree, and what it
  // must not change is what this step has just arranged.
  const dirtyBefore = repo.status();

  const dialog = await openViaPalette(app, 'Find in Files', 'Find in Files');

  // The edit is uncommitted, so a search that finds it can only have read the working
  // tree, which is what the card above the box says it is reading.
  await dialog.setText(inTracked);
  const preview = await dialog.preview();
  await testInfo.attach('preview', { body: preview });
  expect(preview, 'the preview is not a grep').toContain('grep');
  await dialog.click('Find');

  const hits = dialog.page.locator('.results .row');
  await expect(hits, `exactly one hit for ${inTracked}`).toHaveCount(1);
  await expect(dialog.page.locator('.results .path')).toHaveText(tracked!);
  // `--line-number` really is a line number, and the right one: the marker is the last
  // line of the file this step just appended to.
  await expect(hits.locator('.line')).toHaveText(String(line));

  // The same marker, in a file git is not tracking. No matches: *and no error*. Git exits
  // 1 when it finds nothing, and if that is not read as an answer then every fruitless
  // search in the app looks broken.
  await dialog.setText(inUntracked);
  await dialog.click('Find');
  await expect(hits, 'an untracked file should be invisible to the search').toHaveCount(0);
  await expect(dialog.page.locator('.results .placeholder')).toContainText('No file matches');
  await expect(
    dialog.page.locator('.error'),
    'a search that found nothing was reported as an error'
  ).toHaveCount(0);

  // Back to the hit, and out through the relay: the file pane in the *other* window.
  await dialog.setText(inTracked);
  await dialog.click('Find');
  await expect(hits, 'the first search again').toHaveCount(1);
  await hits.first().click();
  await app.expectFormsClosed(20_000);

  // The assertion the step exists for: a click in one window moved the file pane in
  // another. Both halves: the grid selects the working tree, since that is what was
  // searched, and the pane selects the file the hit is in.
  await expect(
    app.main.locator('.row.selected').filter({ hasText: path.basename(tracked!) }).first(),
    `the repository window to select ${path.basename(tracked!)} in its file pane`
  ).toBeVisible();
  await expect(
    app.main.locator('.grid .row.selected').filter({ hasText: 'Working directory' }),
    'the grid did not move to the working tree the search was of'
  ).toHaveCount(1);

  expect(repo.status(), 'searching changed the working tree').toBe(dirtyBefore);
  // A search reads. Anything it moved would be a far worse bug than one that failed to
  // find something.
  expect(repo.head(), 'searching moved HEAD').toBe(headBefore);
  expect(repo.branches(), 'searching changed the branches').toHaveLength(branchesBefore);
});

test('compress the git database, watching it run', async ({ app, repo }, testInfo) =>
{
  const headBefore = repo.head();
  const branchesBefore = repo.branches().length;
  const reachableBefore = repo.git(['rev-list', '--count', 'HEAD']);

  const dialog = await openViaPalette(app, 'Compress Git Database', 'Compress Git Database');
  const preview = await dialog.preview();
  await testInfo.attach('preview', { body: preview });
  expect(preview.trim(), 'the dialog opened on something other than a bare gc').toBe('git gc');

  await dialog.click('Run');
  // The run is watched in a window of its own, which this dialog hands off to and then
  // closes. `gc` is spawned inside a pty precisely so there is progress to watch, so the
  // output itself is worth asserting on, not only the outcome line.
  const running = await waitForConsole(app);
  await expect(
    running.page.locator('.success, .error, .warn'),
    'gc did not finish cleanly'
  ).toContainText('Done');
  await running.expectOutput('Enumerating objects');

  // Kept, then closed. The window closes itself once the command succeeds, counting down
  // on the button that will do it, so `Close` is not a button to press until the
  // countdown is stopped: Keep Open is what stops it, and this is the only place that
  // pair is driven.
  await running.keepOpen();
  await running.click('Close');
  await app.expectFormsClosed();

  // The assertion gc is actually risky for: repacking must lose nothing reachable.
  expect(
    repo.git(['rev-list', '--count', 'HEAD']),
    'gc changed how many commits are reachable'
  ).toBe(reachableBefore);
  // gc repacks; it must never move a ref.
  expect(repo.head(), 'gc moved HEAD').toBe(headBefore);
  expect(repo.branches(), 'gc changed the branches').toHaveLength(branchesBefore);
});

test('find a commit thrown away by reset --hard, and branch from it', async ({
  app,
  repo
}, testInfo) =>
{
  // Make something genuinely lost: commit it, then throw the commit away. It stays in the
  // object database, which is the whole premise of the dialog.
  repo.write('recover-me.txt', 'the file on the lost commit\n');
  repo.git(['add', 'recover-me.txt']);
  repo.git([...IDENT, 'commit', '-q', '-m', 'the commit to recover']);
  const lost = repo.head();
  repo.git(['reset', '--hard', 'HEAD~1']);
  await refreshApp(app);

  const dialog = await openViaPalette(app, 'Recover Lost Objects', 'Recover Lost Objects');

  // It opens with `--unreachable --no-reflogs` already ticked, which is what makes it
  // useful: with the reflog counted as a root, a commit discarded seconds ago is perfectly
  // reachable and this list would be empty.
  const preview = await dialog.preview();
  await testInfo.attach('preview', { body: preview });
  expect(preview, 'the dialog did not open on --no-reflogs').toContain('--no-reflogs');

  // Click the row this step means, rather than trusting the pre-selected one. Commits sort
  // above trees and blobs and newest first, but by this point the fixture has been reset
  // and rebased often enough to hold several orphans: the same reason `openViaPalette`
  // clicks the row it named instead of pressing Enter.
  await dialog.clickEntryContaining('the commit to recover');

  await dialog.click('Create Branch…');
  const branchDialog = new Dialog(await app.waitForWindow('Create Branch'));
  await branchDialog.setText('recovered');
  // The name is validated by `repo:validBranchName`, so the button is disabled until git
  // has answered; the click waits that out rather than landing on a disabled button and
  // then asserting on a branch that was never asked for.
  await branchDialog.click('Create Branch');
  // The *branch* dialog going is what says the command ran, and it is the only window
  // here that goes: this one was handed off *from* the Recover Lost Objects window, which
  // is a workspace and stays open on purpose, since you may want to recover more than one
  // object. Waiting for every window to close instead would wait out its whole timeout,
  // every run, on a condition that is never true.
  await expect(() => expect(branchDialog.page.isClosed()).toBe(true)).toPass({ timeout: 12_000 });
  await app.closeDialogs();

  await expect(() => expect(repo.branches()).toContain('recovered')).toPass({ timeout: 8000 });

  // The point of the whole dialog, asserted against the SHA this step threw away rather
  // than against anything the UI reported: the commit is reachable again, from a branch,
  // and it is *that* commit and not some other.
  expect(repo.git(['rev-parse', 'recovered']), 'the branch was made on the wrong commit').toBe(
    lost
  );
  expect(
    repo.git(['branch', '--contains', lost]),
    'the recovered commit is still unreachable'
  ).toContain('recovered');
  // Belt and braces the other way round: fsck must now have nothing to say about it.
  expect(
    repo.git(['fsck', '--no-progress', '--unreachable', '--no-reflogs']),
    'fsck still reports the commit as unreachable'
  ).not.toContain(lost);
  // Deliberately no HEAD assertion. The create-branch dialog checks the new branch out,
  // so HEAD moving is the *correct* outcome here rather than a regression, and where it
  // moved to is already pinned above, against the SHA that was lost.
});

/**
 * The step above recovers a lost commit; this one *reads* one, and the two are separate
 * because they fail for different reasons.
 *
 * It exists because the step above cannot catch either defect this pane had. It looks up
 * the newest lost commit, and the newest is the one commit that was described correctly
 * while every other row rendered as bare hex: `git log --pretty=format:` separates records
 * with a newline, which landed at the front of the next record's SHA, so only the first
 * record of each batch was ever found again. Hence the operand here is deliberately the
 * *older* of two lost commits.
 *
 * And it reads all three object kinds, because a commit, a tree and a blob went through
 * one text pane that showed git's plumbing verbatim: `commit`/`Author:`/`Date:` above an
 * unwrapped message, `100644 blob <40 hex>` per tree entry, and a blob's raw bytes.
 */
test('read a lost commit, a lost tree and a lost blob, each drawn as what it is', async ({
  app,
  repo
}) =>
{
  // Two lost commits, so the row asserted below is not the newest one. Under the describe
  // defect the newest was the only one with a subject, which is exactly why the step above
  // passed throughout.
  fs.mkdirSync(path.join(repo.dir, 'lost-dir'), { recursive: true });
  repo.write('lost-dir/inside.txt', 'a file in a lost directory\n');
  repo.git(['add', 'lost-dir']);
  repo.git([...IDENT, 'commit', '-q', '-m', 'the older lost commit']);
  const older = repo.head();

  repo.write('newer.txt', 'newer\n');
  repo.git(['add', 'newer.txt']);
  repo.git([...IDENT, 'commit', '-q', '-m', 'the newer lost commit']);
  repo.git(['reset', '--hard', 'HEAD~2']);

  // A blob with no commit anywhere near it: `hash-object -w` writes it straight into the
  // object database, which is the one route to a *dangling* blob rather than an
  // unreachable one. Three lines, so the pane has a line count to get right, and the file
  // is removed afterwards so it does not read as an untracked change to any step that
  // follows.
  const blobText = 'the lost blob\nhas three lines\nand no name at all\n';
  repo.write('orphan-blob.txt', blobText);
  const blob = repo.git(['hash-object', '-w', 'orphan-blob.txt']);
  fs.rmSync(path.join(repo.dir, 'orphan-blob.txt'));
  expect(blob, 'hash-object did not write a blob').toMatch(/^[0-9a-f]{40}$/);

  await refreshApp(app);
  const dialog = await openViaPalette(app, 'Recover Lost Objects', 'Recover Lost Objects');

  // ── The commit ────────────────────────────────────────────────────────────
  //
  // By subject, on a row that is not the first: this is the regression guard for the
  // describe read. A row reading `commit 1a2b3c4d` is what the defect looked like.
  await dialog.clickEntryContaining('the older lost commit');

  const card = dialog.page.locator('.lost-object .commit');
  await expect(card.locator('.subject'), 'the header card names the wrong commit').toHaveText(
    'the older lost commit'
  );
  // Who and when, which is what tells one orphan from another, and which sat below the
  // fold of the card until the message stopped being drawn above them.
  const labels = await card.locator('.meta dt').allInnerTexts();
  for (const label of ['Author', 'Date', 'Commit'])
  {
    expect(labels.map((l) => l.trim()), `the header card has no ${label} row`).toContain(label);
  }
  const values = (await card.locator('.meta dd').allInnerTexts()).map((v) => v.trim());
  expect(values, 'the header card does not carry the full SHA').toContain(older);
  // git's own three-line header must not be in the pane as well as drawn above it.
  expect(
    values.some((value) => value.startsWith(`commit ${older}`)),
    "the card is repeating git show's plumbing header"
  ).toBe(false);

  // What it changed is `ChangedFiles` beside `DiffViewer`, pointed at the commit's range,
  // not a patch dumped into a text pane. `.panes` is `RepoFilePanes`' own root.
  await expect(
    dialog.page.locator('.lost-object .panes'),
    'the file list and diff viewer for the commit'
  ).toBeVisible();
  // `.pane` stays mounted for every kind: `useReadOnlyEditor` creates its editor in
  // `onMounted`, and an element that does not exist then never gets one, so a commit hides
  // it with `.gone { display: none }` rather than removing it. The regression this guards
  // against is the pane actually being *on screen*, not merely present.
  await expect(
    dialog.page.locator('.lost-object .pane'),
    'a commit is being drawn in the blob text pane'
  ).toBeHidden();
  // The file the commit added, in whichever mode the file pane is left in: the changed
  // list and the tree both contain it, and which one is showing is a setting this step has
  // no business changing. In the tree, though, the folder holding it starts collapsed, so
  // it has to be opened before the file underneath is drawn at all.
  const inside = dialog.page.locator('.files .row').filter({ hasText: 'inside.txt' }).first();
  await expect(async () =>
  {
    if (await inside.isVisible())
    {
      return;
    }
    const folder = dialog.page.locator('.files .row.folder[title^="lost-dir/"]').first();
    if (await folder.isVisible())
    {
      await folder.click();
    }
    await expect(inside).toBeVisible({ timeout: 2000 });
  }, "the commit's own file in the file list").toPass({ timeout: 15_000 });

  // ── The tree ──────────────────────────────────────────────────────────────
  //
  // Every tree in the list, until one holds the file committed above: the fixture has been
  // reset and rebased often enough by now to hold plenty of orphaned trees, and which of
  // them sorts first is not this step's to assume.
  const trees = dialog.page
    .locator('.list .entry')
    .filter({ has: dialog.page.locator('.title', { hasText: /^\s*tree / }) });
  const treeCount = await trees.count();
  expect(treeCount, 'no lost tree in the list to read').toBeGreaterThan(0);

  const entries = dialog.page.locator('.lost-object .entries li');
  const count = dialog.page.locator('.lost-object .count');
  let drewTheFile = false;
  for (let at = 0; at < treeCount && !drewTheFile; at++)
  {
    await trees.nth(at).click();
    await expect(count, 'the tree to finish listing its entries').not.toContainText('Reading');
    drewTheFile = (await entries.allInnerTexts()).some((e) => e.includes('inside.txt'));
  }
  expect(drewTheFile, 'no lost tree drew the committed file').toBe(true);
  // A file list, not `cat-file -p`: the mode and the forty-character SHA are what the
  // plumbing put in front of every name.
  for (const entry of await entries.allInnerTexts())
  {
    expect(entry.replace(/\s+/g, ' ').trim(), 'a tree row is still raw cat-file output').not.toMatch(
      /^\d{6} (blob|tree|commit) [0-9a-f]{40}/
    );
  }

  // ── The blob ──────────────────────────────────────────────────────────────
  //
  // Found by the short SHA the row is titled with, since a blob has no name to find it by,
  // which is the whole reason the pane says so in words.
  await dialog.clickEntryContaining(`blob ${blob.slice(0, 8)}`);

  // The count line, once it is *finished*, not merely present. It renders the moment the
  // selection changes and says "Reading…" until git has answered, so waiting for the
  // element alone reads the placeholder and asserts against a size nobody has fetched yet.
  await expect(count, 'the blob to finish reporting its size').not.toContainText('Reading');
  // Size and line count in words, and the admission that there is no name: three things
  // `cat-file -p` cannot tell you on its own. The size is measured here rather than
  // written down, so the assertion cannot drift from the fixture text above.
  await expect(count).toContainText(`${Buffer.byteLength(blobText)} bytes`);
  await expect(count, 'the blob does not report its line count').toContainText('4 lines');
  await expect(count, 'the blob does not say it has no name').toContainText('name is not recorded');

  // Named here rather than defaulted in the support layer: which pane holds the text is a
  // fact about *this* dialog, and a shared helper carrying one dialog's selector as its
  // default is how a suite ends up silently reading the wrong element.
  expect(
    await dialog.paneText('.lost-object .pane'),
    'the blob pane is not showing its contents'
  ).toBe(blobText);

  // `closeDialogs`, not a Close button: this window has none. It is `fullWindow`, so it
  // closes by its frame's own ✕ or by Escape, and its footer is left to the four buttons
  // that actually do something.
  await app.closeDialogs();

  // A reading step: it set its scene with commits it then threw away, so what must be true
  // afterwards is that nothing was recovered and nothing was pruned.
  expect(repo.branches(), 'reading a lost commit created a branch').not.toContain(
    'the older lost commit'
  );
  expect(repo.status(), 'the blob file was left in the working tree').not.toContain(
    'orphan-blob.txt'
  );
});

test('delete a stale index.lock, after being warned about it', async ({ app, repo }) =>
{
  const headBefore = repo.head();
  const lock = path.join(repo.dir, '.git/index.lock');
  fs.writeFileSync(lock, '');

  await runViaPalette(app, 'Delete index.lock');

  // The warning is the point of the command: the app cannot tell a lock left by a crash
  // from one a running git process is holding, so the person has to. This assertion is
  // what a real defect was found by: the prompt was being answered by the same Enter that
  // opened it, and the file went without anyone being asked.
  await expect(app.main.locator('body'), 'the index.lock warning').toContainText(
    'Delete index.lock?'
  );
  expect(
    fs.existsSync(lock),
    'the lock was deleted before the question was answered'
  ).toBe(true);

  await app.main.locator('button').filter({ hasText: /^\s*Delete it\s*$/ }).first().click();
  await expect(() => expect(fs.existsSync(lock)).toBe(false)).toPass({ timeout: 8000 });

  expect(repo.head(), 'deleting the lock moved HEAD').toBe(headBefore);
});

test('read a patch file without applying it', async ({ app, repo }) =>
{
  const headBefore = repo.head();
  const branchesBefore = repo.branches().length;
  // `format-patch` writes a mail-formatted patch: headers, message, diffstat, then the
  // diff. Reading one back is the case this dialog is for.
  const dirtyBefore = repo.status();

  const into = path.join(repo.dir, '.git', 'tour-patches');
  fs.rmSync(into, { recursive: true, force: true });
  repo.git(['format-patch', '-1', '-o', into]);
  const patch = fs
    .readdirSync(into)
    .map((name) => path.join(into, name))
    .find((name) => name.endsWith('.patch'));
  expect(patch, 'format-patch wrote no patch to read').toBeTruthy();

  const dialog = await openViaPalette(app, 'View Patch File', 'View Patch File');
  await dialog.setText(patch!);
  await dialog.click('Open');

  const entries = dialog.page.locator('.list .entry');
  await expect(
    entries,
    'the patch to be split into its sections'
  ).not.toHaveCount(1);
  // The mail preamble is named by its Subject rather than listed as "(unnamed)", and the
  // file it touches is listed beside it.
  await expect(
    entries.filter({ hasText: '(unnamed)' }),
    'the preamble was listed as unnamed'
  ).toHaveCount(0);

  await dialog.click('Close');
  await app.expectFormsClosed();

  // Reading a patch must not apply it. `.git/tour-patches` is inside `.git`, so
  // `format-patch` writing there leaves the working tree exactly as it was.
  expect(repo.status(), 'viewing a patch changed the working tree').toBe(dirtyBefore);
  expect(repo.head(), 'viewing a patch moved HEAD').toBe(headBefore);
  expect(repo.branches(), 'viewing a patch changed the branches').toHaveLength(branchesBefore);
});

test('edit .gitignore, and have the file on disk say so', async ({ app, repo }) =>
{
  const headBefore = repo.head();
  const file = path.join(repo.dir, '.gitignore');
  const wasThere = fs.existsSync(file);
  const before = repo.fileText('.gitignore');

  const dialog = await openViaPalette(app, 'Edit .gitignore', 'Edit .gitignore');
  await dialog.editorReady();
  // The box holds the file, so what is read back proves the read as well as the write.
  await expect(
    dialog.page.locator('textarea'),
    'the box does not hold the file'
  ).toHaveValue(before);

  const wanted = `${before}tour-ignored/\n`;
  await dialog.setTextArea(wanted);
  await dialog.click('Save');
  await app.expectFormsClosed();

  expect(repo.fileText('.gitignore')).toBe(wanted);
  // Put it back: an ignore rule left behind changes what every later run sees as
  // untracked.
  if (wasThere)
  {
    fs.writeFileSync(file, before);
  }
  else
  {
    fs.rmSync(file);
  }

  expect(repo.head(), 'editing .gitignore moved HEAD').toBe(headBefore);
});

test('refuse a .git/config the repository could not survive', async ({ app, repo }) =>
{
  const headBefore = repo.head();
  const file = path.join(repo.dir, '.git', 'config');
  const before = fs.readFileSync(file, 'utf8');

  const dialog = await openViaPalette(app, 'Edit .git/config', 'Edit .git/config');
  await dialog.editorReady();
  await dialog.setTextArea('[broken\n');
  await dialog.click('Save');

  // It must stay open holding the text, with git's own complaint under it. A window that
  // closed here would have written the file.
  const complaint = dialog.page.locator('.error');
  await expect(complaint, 'git to refuse the broken config').toContainText('line 1');
  await expect(
    complaint,
    'it named the temp copy rather than the file'
  ).not.toContainText('gitext-config-check');

  expect(fs.readFileSync(file, 'utf8'), 'the broken config was written anyway').toBe(before);
  // And the repository still answers, which is what the check protects.
  expect(repo.head(), 'git can no longer read this repository').not.toBe('');

  // Now a config it accepts, through the same button.
  await dialog.setTextArea(`${before}[tour]\n\tchecked = true\n`);
  await dialog.click('Save');
  await app.expectFormsClosed();

  expect(
    repo.git(['config', '--local', '--get', 'tour.checked']),
    'the good config was not written'
  ).toBe('true');
  fs.writeFileSync(file, before);

  expect(repo.head(), 'editing .git/config moved HEAD').toBe(headBefore);
});

test('set an identity for this repository from Settings', async ({ app, repo }) =>
{
  /*
   * The repository scope, and only the repository scope.
   *
   * The dialog can write `--global` too, and a step that did would edit the git identity
   * of whoever ran the suite. This one writes into the fixture's own `.git/config`, which
   * is deleted when the run is done.
   */
  const headBefore = repo.head();
  const branchesBefore = repo.branches().length;

  const dialog = await openViaPalette(app, 'Settings…', 'Settings');
  // The git-config fields are one page of several, and the window opens on another.
  await dialog.settingsPage('Git Config');
  await dialog.tick('This repository');
  await expect(
    dialog.page.locator('input[type=radio][value="local"]'),
    'the scope to move to this repository'
  ).toBeChecked();

  /*
   * The gesture is retried, not just the reading of it, and both directions need it.
   *
   * This page re-reads git into its fields whenever the scope changes and again after
   * every write, and `save` writes only when the field differs from the value it last
   * read. So a fill that lands mid-read is either overwritten by the read (the name never
   * reaches git) or compared against a stale value and skipped (the unset never happens).
   * Neither is a wait that can be spelled as a condition on the page: the field looks
   * identical before the read and after it. Asking again until git agrees is what the
   * page's own contract allows.
   */
  const nameField = dialog.rowFor('Name').locator('input').first();
  const localName = (): string => repo.git(['config', '--local', '--get', 'user.name']);

  await expect(async () =>
  {
    await dialog.setTextByLabel('Name', 'Tour Identity');
    expect(localName()).toBe('Tour Identity');
  }, 'the local user.name to be written').toPass({ timeout: 15_000 });

  // Clearing the field unsets the key rather than writing an empty one.
  await expect(nameField).toHaveValue('Tour Identity');
  await expect(async () =>
  {
    await dialog.setTextByLabel('Name', '');
    expect(localName()).toBe('');
  }, 'the local user.name to be unset again').toPass({ timeout: 15_000 });

  await dialog.click('Done');
  await app.expectFormsClosed();

  expect(repo.head(), 'editing config moved HEAD').toBe(headBefore);
  expect(repo.branches(), 'editing config changed the branches').toHaveLength(branchesBefore);
});

/**
 * The two that make a repository rather than acting on one, and so the two steps that
 * assert against a directory instead of against the fixture. Both run git in a folder of
 * their own: everything else here runs in the repository the window has open, and that is
 * the whole reason these are worth driving.
 *
 * They are last because they leave the app looking at a different repository. Nothing
 * after them would be about the fixture any more.
 */
test('make a repository, and open what was made', async ({ app, repo }, testInfo) =>
{
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });

  const dialog = await openViaPalette(app, 'New Repository', 'New Repository');
  await dialog.setTextByLabel('Create in', SCRATCH);
  await dialog.setTextByLabel('Repository name', 'made-here');
  // Named, so the assertion is about this dialog rather than about whatever
  // `init.defaultBranch` happens to be on the machine running this.
  await dialog.setTextByLabel('First branch', 'trunk');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Create');
  await app.expectFormsClosed();

  const made = path.join(SCRATCH, 'made-here');
  expect(fs.existsSync(path.join(made, '.git')), `no repository at ${made}`).toBe(true);
  expect(
    repo.git(['symbolic-ref', '--short', 'HEAD'], made),
    'expected the first branch to be trunk'
  ).toBe('trunk');
});

test('clone a repository, from a URL that is a path on this machine', async ({
  app,
  repo
}, testInfo) =>
{
  fs.mkdirSync(SCRATCH, { recursive: true });
  const dialog = await openViaPalette(app, 'Clone Repository', 'Clone Repository');
  // The fixture itself: no network, so the step is as fast and as reliable as the rest of
  // the suite, and `clone` still takes the console path either way.
  await dialog.setTextByLabel('Repository URL', repo.dir);
  await dialog.setTextByLabel('Clone into', SCRATCH);
  await dialog.setTextByLabel('Directory name', 'cloned-here');
  await testInfo.attach('preview', { body: await dialog.preview() });
  await dialog.click('Clone');
  // A clone raises a console window and the form outlives it, so this waits on the
  // repository arriving rather than on the form going.
  await expect(
    () => expect(fs.existsSync(path.join(SCRATCH, 'cloned-here', '.git'))).toBe(true),
    'the clone to land on disk'
  ).toPass({ timeout: 30_000 });
  await app.closeDialogs();

  expect(
    repo.git(['remote', 'get-url', 'origin'], path.join(SCRATCH, 'cloned-here'))
  ).toBe(repo.dir);
});
