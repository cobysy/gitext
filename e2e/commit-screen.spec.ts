/**
 * Every action the commit screen offers, driven and checked against git.
 *
 * The commit screen is a window of its own with a store of its own, so everything between
 * a click on a row and a change in the index is wiring only a driven run sees: the
 * selection arithmetic, the patch builder, the argv, and the two lists reloading from git
 * afterwards. Each step reads the repository before and after and fails if the state did
 * not move the way the action claims.
 *
 * The screen is opened once and stays open: the steps are a sequence through one session,
 * the way a person uses it. `openCommitScreen` hands back the window that is already
 * there, so a step run on its own opens one for itself.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CommitScreen,
  dialogWindowButton,
  openCommitScreen
} from './support/commitScreen.js';
import { mod } from './support/app.js';
import { settle } from './support/options.js';
import { expect, test } from './support/tour.js';

test.use({
  tourName: 'commit',
  seedSettings: {
    // The list shape and the show-ignored toggles persist, so a previous run would
    // otherwise decide what this one sees. Every step that depends on a setting sets it
    // explicitly; this is the floor those steps start from.
    stagingListView: 'flat',
    stagingDenseTree: true,
    stagingShowUntracked: true,
    stagingShowIgnored: false,
    stagingShowSkipWorktree: false,
    stagingShowAssumeUnchanged: false,
    stagingFilterVisible: true,
    commitNoVerify: false,
    commitCloseWhenDone: false,
    // The screen's own splitters, shrunk to fit the window this leaves it. Their defaults
    // put the staged list and the message box below the fold, which are the two things a
    // run of the commit screen most needs visible.
    commitStagedHeight: 150,
    // The screen's own floor, not lower: below it the pane's fixed chrome leaves the
    // message box a single line.
    commitMessageHeight: 170,
    commitListsWidth: 320
  }
});

/** What the compose pane says it will run. */
function previewOf(screen: CommitScreen): Promise<string>
{
  return screen.page
    .locator('.compose .preview, .compose code')
    .first()
    .innerText()
    .catch(() => '');
}

test('open the commit screen', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);

  await expect(screen.page.locator('.staging-diff'), 'no diff pane').toBeVisible();
  await expect(screen.page.locator('.status'), 'no status bar').toBeVisible();
  // Both lists stream in from git after the window mounts, so these are waited for.
  await expect(screen.rows('unstaged'), 'the unstaged list is empty').not.toHaveCount(0);
  await expect(screen.rows('staged'), 'the staged list is empty').not.toHaveCount(0);
  expect(repo.status(), 'the fixture has nothing to show').not.toBe('');
});

test('stage one hunk of two', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);
  await screen.clickRow('unstaged', 'two-hunks.txt');
  await expect(screen.page.locator('.hunk'), 'expected two hunks in two-hunks.txt').toHaveCount(2);

  await screen.clickHunkAction('.hunk:first-of-type');

  const staged = repo.indexBlob('two-hunks.txt');
  expect(staged, 'the first hunk did not reach the index').toContain('CHANGED AT THE TOP');
  expect(staged, 'the second hunk reached the index and should not have').not.toContain(
    'CHANGED AT THE BOTTOM'
  );
  expect(repo.statusOf('two-hunks.txt'), 'expected MM for a half-staged file').toMatch(/^MM/);
});

test('stage a single line out of a hunk', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);
  // A file with a clean single-line change: the fixture's `docs/api.md` adds one line.
  await screen.clickRow('unstaged', 'api.md');

  // The first added line in this diff is a blank one: the file gained an empty line and
  // then "Documented." Picking the blank would stage whitespace and assert nothing.
  const line = screen.page.locator('.line.kind-add').filter({ hasText: 'Documented' }).first();
  await expect(line, 'no "Documented." line to pick in docs/api.md').toBeVisible();
  await line.dispatchEvent('click');

  await expect(
    screen.page.locator('.hunk-action').filter({ hasText: 'line' }).first(),
    'expected a "Stage N lines" button after picking'
  ).toHaveText(/Stage \d+ line/);

  await screen.clickHunkAction('.hunk', 'line');
  expect(repo.indexBlob('docs/api.md'), 'the picked line did not reach the index').toContain(
    'Documented.'
  );
});

test('unstage a hunk from the staged side', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);
  await screen.clickRow('staged', 'two-hunks.txt');

  // Retried: the diff pane reloads for the side that was just selected, and both sides
  // show the same path, so the verb is the first thing that says which one it is showing.
  await expect(
    screen.hunkAction(),
    'expected an Unstage button on the staged side'
  ).toHaveText(/^Unstage/);

  await screen.clickHunkAction('.hunk:first-of-type');

  expect(
    repo.indexBlob('two-hunks.txt'),
    'the hunk is still in the index after unstaging'
  ).not.toContain('CHANGED AT THE TOP');
  // The working tree must not have moved: unstaging is an index operation.
  expect(
    repo.fileText('two-hunks.txt'),
    'unstaging changed the working tree, which it must never do'
  ).toContain('CHANGED AT THE TOP');
});

test('stage and unstage whole files', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);
  await screen.moveRow('unstaged', 'whitespace.txt');
  expect(repo.statusOf('whitespace.txt'), 'staging the file did not reach the index').toMatch(
    /^M /
  );

  await screen.moveRow('staged', 'whitespace.txt');
  expect(
    repo.statusOf('whitespace.txt'),
    'unstaging the file did not take it out of the index'
  ).toMatch(/^ M/);
});

test('multi-select and stage several files at once', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);
  await screen.clickRow('unstaged', 'no-newline.txt');
  await screen.clickRow('unstaged', 'long-lines.js', { modifier: 'meta' });

  await expect(
    screen.page.locator('.unstaged .staging-list .row.selected'),
    'expected two selected rows'
  ).toHaveCount(2);

  await screen.moveRow('unstaged', 'long-lines.js');

  expect(repo.statusOf('no-newline.txt'), 'the multi-file stage missed no-newline.txt').toMatch(
    /^M /
  );
  expect(repo.statusOf('long-lines.js'), 'the multi-file stage missed long-lines.js').toMatch(
    /^M /
  );
});

test('the four list shapes', async ({ app }) =>
{
  const screen = await openCommitScreen(app);

  for (const shape of ['Folder Tree', 'Group by Extension', 'Group by Status', 'Flat List'])
  {
    await screen.openViewMenu('unstaged');
    await screen.menuClick(shape);
    const rows = await screen.rowTexts('unstaged');

    if (shape === 'Folder Tree')
    {
      // Dense merging is the interesting property: a chain of single-child folders must
      // collapse into one row rather than four.
      expect(
        rows.some((r) => r.includes('deep/nested/further/down')),
        'the folder tree did not dense-merge the single-child chain'
      ).toBe(true);
    }
    if (shape === 'Group by Status')
    {
      // The group's own row, by its label: the twisty beside it is an SVG and contributes
      // no text, so there is nothing in front of the name.
      expect(
        rows.some((r) => r.startsWith('Untracked')),
        'group by status produced no Untracked group'
      ).toBe(true);
    }
  }
});

test('a folder as one operand', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);
  const inside = ['src/components/NewThing.vue', 'src/components/Widget.vue'];
  const outside = 'src/styles/main.css';

  await screen.openViewMenu('unstaged');
  await screen.menuClick('Folder Tree');

  // Shift-click, not a plain one: a plain click on a folder folds it, which is what a
  // twisty is for. The modifier is what turns the row into an operand.
  await screen.clickRow('unstaged', 'components', { modifier: 'shift' });
  const picked = await screen.page
    .locator('.unstaged .staging-list .row.selected')
    .allInnerTexts();
  // The folder row itself is selected alongside its two files, and nothing else is.
  expect(picked, 'selecting the folder picked the wrong number of rows').toHaveLength(3);
  expect(
    picked.some((row) => row.includes('main.css')),
    'selecting one folder reached into another'
  ).toBe(false);

  await screen.moveRow('unstaged', 'components');
  for (const file of inside)
  {
    expect(repo.statusOf(file), `${file} did not stage with its folder`).toMatch(/^[AM] /);
  }
  expect(repo.statusOf(outside), 'staging one folder staged a file in another').toMatch(/^ M/);

  // And back, from the staged side, which is the same row button pointing the other way.
  await screen.openViewMenu('staged');
  await screen.menuClick('Folder Tree');
  await screen.moveRow('staged', 'components');

  await screen.openViewMenu('staged');
  await screen.menuClick('Flat List');
  await screen.openViewMenu('unstaged');
  await screen.menuClick('Flat List');

  for (const file of inside)
  {
    expect(repo.statusOf(file), 'unstaging the folder left something in the index').toMatch(
      /^(\?\?| M)/
    );
  }
});

test('the selection filter', async ({ app }) =>
{
  const screen = await openCommitScreen(app);
  const all = await screen.rows('unstaged').count();

  await screen.typeFilter('unstaged', 'src/');
  const filtered = await screen.rows('unstaged').count();
  expect(filtered, 'the filter did not narrow the list').toBeLessThan(all);
  expect(filtered, 'the filter matched nothing at all').toBeGreaterThan(0);

  // The × inside the box, which only exists while there is a search to undo.
  await screen.page.locator('.unstaged .filter-box .clear').dispatchEvent('click');
  await expect(
    screen.page.locator('.unstaged .filter-box input'),
    'the × left the filter box holding text'
  ).toHaveValue('');

  // Escape does the same from the keyboard, and must not reach the screen behind the box,
  // or clearing a search would close the commit screen with it.
  await screen.typeFilter('unstaged', 'src/');
  await screen.page.locator('.unstaged .filter-box input').focus();
  await screen.page.keyboard.press('Escape');
  await expect(
    screen.page.locator('.unstaged .filter-box input'),
    'Escape did not clear the filter box'
  ).toHaveValue('');
  await expect(
    screen.page.locator('.commit-screen'),
    'Escape in the filter box closed the commit screen'
  ).toBeVisible();
});

test('show ignored files', async ({ app }) =>
{
  const screen = await openCommitScreen(app);
  const without = await screen.rows('unstaged').count();

  await screen.openViewMenu('unstaged');
  await screen.menuClick('Show Ignored Files');
  // The list growing is the assertion, and waiting on it beats guessing how long the
  // re-read from git takes.
  await expect(
    () => expect(screen.rows('unstaged').count()).resolves.toBeGreaterThan(without),
    'showing ignored files added nothing to the list'
  ).toPass({ timeout: 8000 });

  await screen.openViewMenu('unstaged');
  await screen.menuClick('Show Ignored Files');
});

test('skip-worktree: mark, lose, and find again', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);

  await screen.openRowMenu('unstaged', 'src/styles/main.css');
  await screen.menuHover('Tracking');
  await screen.menuClick('Skip Worktree');
  await expect(
    () =>
      expect(repo.indexFlags().some((f) => f.startsWith('S ') && f.includes('main.css'))).toBe(
        true
      ),
    'git did not record the skip-worktree flag'
  ).toPass({ timeout: 8000 });
  await expect(
    screen.rows('unstaged').filter({ hasText: 'main.css' }),
    'the flagged file is still listed: git now calls it unchanged'
  ).toHaveCount(0);

  await screen.openViewMenu('unstaged');
  await screen.menuClick('Show Skip-worktree Files');
  const restored = screen.rows('unstaged').filter({ hasText: 'main.css' }).first();
  await expect(restored, 'showing skip-worktree files did not bring it back').toBeVisible();
  expect(
    (await restored.innerText()).replace(/\s+/g, ' ').trim(),
    'the restored row carries no S marker'
  ).toContain('S');

  // Put it back, so later steps see an ordinary repository.
  repo.git(['update-index', '--no-skip-worktree', '--', 'src/styles/main.css']);
  await screen.openViewMenu('unstaged');
  await screen.menuClick('Show Skip-worktree Files');
});

test('add a file to .git/info/exclude', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);
  const exclude = path.join(repo.dir, '.git/info/exclude');
  let wasThere = '';
  if (fs.existsSync(exclude))
  {
    wasThere = fs.readFileSync(exclude, 'utf8');
  }

  await screen.openRowMenu('unstaged', 'untracked.txt');
  await screen.menuHover('Ignore');
  await screen.menuClick('Add to .git/info/exclude');
  // The menu row opens the Ignore Files window; the rule is written by *its* button, so
  // the step has to drive that too rather than stopping at the menu.
  await dialogWindowButton(app, screen, 'Add to .git/info/exclude');

  await expect(
    () => expect(fs.readFileSync(exclude, 'utf8')).toContain('untracked.txt'),
    'the path did not reach .git/info/exclude'
  ).toPass({ timeout: 8000 });
  // Undo, so the file is available to later steps.
  fs.writeFileSync(exclude, wasThere);
});

test('reset a file’s changes, through the confirmation', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);
  const target = 'src/components/Widget.vue';
  const changed = repo.fileText(target);

  await screen.openRowMenu('unstaged', 'Widget.vue');
  await screen.menuHover('Undo');
  await screen.menuClick('Reset File Changes');

  await expect(
    screen.page.locator('.scrim .frame'),
    'no confirmation appeared before discarding work'
  ).toContainText('cannot be undone');
  await screen.confirm(true);

  expect(repo.fileText(target), 'reset did not change the file on disk').not.toBe(changed);
  expect(repo.statusOf(target), 'git still reports the file as changed').toBe('');
});

test('cancelling a destructive action changes nothing', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);
  const target = 'no-newline.txt';
  const contents = repo.fileText(target);
  const statusBefore = repo.statusOf(target);

  await screen.openRowMenu('staged', target);
  await screen.menuHover('Undo');
  await screen.menuClick('Reset File Changes');
  await screen.confirm(false);

  expect(repo.fileText(target), 'cancelling still changed the file').toBe(contents);
  expect(repo.statusOf(target), 'cancelling still changed the index').toBe(statusBefore);
});

test('stage everything, then unstage everything', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);

  await screen.clickListButton('unstaged', 'Stage All');
  const unstagedLeft = (): number =>
    repo.status().split('\n').filter((l) => l.trim() !== '' && l[1] !== ' ').length;
  await expect(
    () => expect(unstagedLeft()).toBe(0),
    'Stage All left unstaged changes behind'
  ).toPass({ timeout: 8000 });

  /*
   * And the screen, not only git.
   *
   * The lists reload after the index moves, and *Unstage All* acts on what the staged
   * list is *holding*. "It has some rows" is not enough: clicked while the reload is
   * still arriving it acts on the handful that got there first, and the rest stay staged
   * with nothing left to move them. So the condition is that the list holds everything
   * git says is staged.
   */
  const stagedInGit = (): number =>
    repo.git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean).length;
  await expect(screen.rows('unstaged'), 'the unstaged list to empty').toHaveCount(0);
  await expect(
    () => expect(screen.rows('staged').count()).resolves.toBe(stagedInGit()),
    'the staged list to hold everything git says is staged'
  ).toPass({ timeout: 8000 });

  await screen.clickListButton('staged', 'Unstage All');
  /*
   * The one pause left in this file, and it is deliberate.
   *
   * Pressing *Unstage All* the instant the staged list finishes filling does nothing at
   * all: the store is still settling behind the rows, and the command acts on what it
   * finds. Every condition worth waiting on here (git's index, both lists' counts) is
   * already true at that moment, so there is nothing left to poll for: this is the gap
   * between the list being drawn and the store behind it being ready, which the screen
   * does not report. The assertion below still polls, so this is a floor rather than the
   * whole wait.
   */
  await settle(1400);
  const stagedLeft = (): number =>
    repo.status().split('\n').filter((l) => l.trim() !== '' && l[0] !== ' ' && l[0] !== '?').length;
  await expect(
    () => expect(stagedLeft()).toBe(0),
    'Unstage All left files in the index'
  ).toPass({ timeout: 8000 });
});

test('the Options menu reflects and changes commit state', async ({ app }) =>
{
  const screen = await openCommitScreen(app);
  // A message and something staged, so the preview has an argv to show at all.
  await screen.moveRow('unstaged', 'api.md');
  await screen.writeMessage('docs: document the api');

  await screen.openScreenMenu('Options');
  await screen.menuClick('No Verify');

  await expect(
    async () => expect(await previewOf(screen)).toContain('--no-verify'),
    'No Verify did not reach the argv'
  ).toPass({ timeout: 8000 });

  // Ticks must show the state, or the menu is lying about what the commit will be.
  await screen.openScreenMenu('Options');
  const ticked = await screen.page.locator('.menu > .row[aria-checked="true"]').allInnerTexts();
  expect(
    ticked.some((t) => t.includes('No Verify')),
    'No Verify is on but shows no tick'
  ).toBe(true);
  await screen.closeMenus();

  // Back off, so the commit in the next step is a plain one.
  await screen.openScreenMenu('Options');
  await screen.menuClick('No Verify');
});

test('commit', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);
  // Its own operand, so the step stands alone: something staged, and a message.
  if (repo.git(['diff', '--cached', '--name-only']) === '')
  {
    await screen.moveRow('unstaged', 'api.md');
  }
  const headBefore = repo.head();
  const stagedFiles = repo
    .git(['diff', '--cached', '--name-only'])
    .split('\n')
    .filter(Boolean);

  await screen.writeMessage('docs: document the api');
  await screen.page.locator('.controls button.primary').first().dispatchEvent('click');
  await expect(
    () => expect(repo.head()).not.toBe(headBefore),
    'no commit was made'
  ).toPass({ timeout: 12_000 });
  expect(repo.subject()).toBe('docs: document the api');
  const committed = repo.git(['show', '--stat', '--format=', 'HEAD']);
  for (const file of stagedFiles)
  {
    expect(committed, `${file} was staged but is not in the commit`).toContain(
      path.basename(file)
    );
  }
  // Committing closes the screen, the way every dialog closes when its work is done.
  // Reopening is `openCommitScreen`'s job, not this step's.
});

test('amend brings the previous message back', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);
  const subject = repo.subject();

  await screen.toggleCheckbox('Amend last commit');

  await expect(
    async () => expect(await screen.messageText()).toContain(subject),
    'amend did not bring the previous message back'
  ).toPass({ timeout: 8000 });
  expect(await previewOf(screen), '--amend is not in the argv').toContain('--amend');

  await screen.toggleCheckbox('Amend last commit');
});

test('reset chunk: undo one hunk on disk', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);
  await screen.clickRow('unstaged', 'two-hunks.txt');

  // Clicking a line in the FIRST hunk is what makes it the focused one.
  await screen.page.locator('.hunk:first-of-type .line.pickable').first().dispatchEvent('click');
  // The first hunk's own button naming a line count is that hunk reporting it is the
  // focused one, which is what the menu row below acts on.
  await expect(
    screen.page.locator('.hunk:first-of-type .hunk-action').first(),
    'the clicked line did not become the pick'
  ).toHaveText(/line/);

  await screen.openRowMenu('unstaged', 'two-hunks.txt');
  await screen.menuHover('Undo');
  await screen.menuClick('Reset Chunk of File');
  await screen.confirm(true);
  await expect(
    () => expect(repo.fileText('two-hunks.txt')).not.toContain('CHANGED AT THE TOP'),
    'reset chunk did not remove the first hunk from the working tree'
  ).toPass({ timeout: 8000 });

  const onDisk = repo.fileText('two-hunks.txt');
  expect(onDisk, 'reset chunk removed the second hunk too').toContain('CHANGED AT THE BOTTOM');
});

test('the Undo menu asks before throwing work away', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);
  // Stage one file so there is something that must survive.
  await screen.moveRow('unstaged', 'long-lines.js');

  const stagedBefore = repo.git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  const unstagedBefore = repo.status().split('\n').filter((l) => l[1] === 'M').length;

  await screen.openScreenMenu('Undo');
  await screen.menuClick('Reset Unstaged Changes');
  // A window, not a scrim: see `dialogWindowButton`.
  await dialogWindowButton(app, screen, 'Discard Changes');
  await expect(
    () =>
      expect(repo.status().split('\n').filter((l) => l[1] === 'M').length).toBeLessThan(
        unstagedBefore
      ),
    'Reset Unstaged Changes discarded nothing'
  ).toPass({ timeout: 8000 });

  const unstagedAfter = repo.status().split('\n').filter((l) => l[1] === 'M').length;
  const stagedAfter = repo.git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  expect(unstagedAfter, 'Reset Unstaged Changes discarded nothing').toBeLessThan(unstagedBefore);
  expect(
    stagedAfter,
    'Reset Unstaged Changes also threw away staged work'
  ).toHaveLength(stagedBefore.length);
});

test('a file written outside the app, and one edited behind its back', async ({ app, repo }) =>
{
  const screen = await openCommitScreen(app);

  // Not through the app: this is an editor, a build, or a script, the case the `.git`
  // watcher cannot see, because it watches `.git` and nothing else.
  repo.write('written-outside.txt', 'made by another tool\n');
  repo.append('two-hunks.txt', 'appended behind the app\n');

  await expect(
    screen.rows('unstaged').filter({ hasText: 'written-outside.txt' }),
    'the list showed a file nobody had told the app about'
  ).toHaveCount(0);

  /*
   * Away and back, which is when a person who edited elsewhere returns.
   *
   * `emit('focus')` rather than a real blur and focus: this runs in the background, whose
   * whole point is windows that are built but never shown, and a window never given real
   * screen presence has nothing for the OS to hand focus to. `CommitScreen.vue` reacts to
   * the window's own `focus` event, which is an ordinary `EventEmitter` event under
   * `BrowserWindow`: so emitting it reaches the same listener a real window manager
   * would, without needing one.
   */
  await app.electronApp.evaluate(({ BrowserWindow }) =>
  {
    for (const win of BrowserWindow.getAllWindows())
    {
      win.emit('focus');
    }
  });

  // Not a pause: the row cannot appear until a status read, the two list reads it sets
  // off, and the patch read those set off have all come back from real git.
  const added = screen.rows('unstaged').filter({ hasText: 'written-outside.txt' });
  await expect(added, 'the file written outside the app never appeared').toHaveCount(1);

  const rows = await screen.rowTexts('unstaged');
  const newFile = rows.find((row) => row.includes('written-outside.txt'));
  const edited = rows.find((row) => row.includes('two-hunks.txt'));
  expect(edited, 'the edit made behind the app never appeared').toBeTruthy();
  expect(newFile, 'the new file is not marked untracked').toMatch(/^\?/);
  expect(edited, 'the edited file is not marked modified').toMatch(/^M/);
});

test('keyboard: pane focus and arrow navigation', async ({ app }) =>
{
  const screen = await openCommitScreen(app);

  await screen.page.keyboard.press(mod('1'));
  await expect(
    async () =>
      expect(
        await screen.page.evaluate(() => document.activeElement?.className ?? '')
      ).toContain('rows'),
    'Mod+1 did not focus the unstaged list'
  ).toPass({ timeout: 8000 });

  const primary = screen.page.locator('.row.primary').first();
  const first = await primary.innerText();
  await screen.page.keyboard.press('ArrowDown');
  await expect(
    async () => expect(await primary.innerText()).not.toBe(first),
    'ArrowDown did not move the selection'
  ).toPass({ timeout: 8000 });
});

test('close the screen', async ({ app }) =>
{
  const screen = await openCommitScreen(app);

  /*
   * The keystroke that closes the window it was sent to.
   *
   * Playwright reports the target going away mid-call as an error, and here that *is* the
   * result: Escape closes the commit screen, so the press has no window left to
   * acknowledge it. Swallowed, and the claim asserted where it actually lives, in the
   * window list. Anything else that could throw here shows up there too, as a screen that
   * did not close.
   */
  await screen.page.keyboard.press('Escape').catch(() =>
  {});

  // Its window goes with it, so "did it close" is a question about the window list.
  expect(
    await app.waitFormsClosed(8000),
    'Escape did not close the commit screen'
  ).toBe(true);
  await expect(
    app.main.locator('.grid'),
    'the repository window is not behind it'
  ).toBeVisible();
});
