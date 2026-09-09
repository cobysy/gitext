import { expect } from '@playwright/test';
import type { GitextApp } from './app.js';
import { settle } from './options.js';
import { GRID_ROW } from './selectors.js';

/**
 * Select the grid row whose text contains this, so a command with an operand has one.
 *
 * **Clicked until it takes, and waited on `primary` rather than `selected`.** Two
 * separate traps, both paid for by one step that reset the wrong branch:
 *
 * - The step before this one usually moved the repository, and the grid reloads when it
 *   hears about that. A click cancels the reveal that reload carries, but the rows
 *   themselves are replaced underneath it: clicking again on every attempt is how this
 *   side survives a row recycled out from under a click that had already landed.
 * - A row carries `selected` for the multi-selection and `primary` for the one commit a
 *   dialog is opened *about* (`selection.primary`, which is what a command's payload
 *   reads). The reload put `primary` back on HEAD while leaving `selected` where it was,
 *   so waiting on the wrong one of those passed with the operand still wrong.
 */
export async function selectCommit(app: GitextApp, needle: string): Promise<void>
{
  await app.main.bringToFront();
  const row = app.main.locator(GRID_ROW).filter({ hasText: needle }).first();

  await expect(async () =>
  {
    const isPrimary = await row.evaluate((el) => el.classList.contains('primary'));
    if (!isPrimary)
    {
      await row.dispatchEvent('click');
      await expect(row).toHaveClass(/primary/, { timeout: 2000 });
    }
    // Held, not merely achieved. A click now cancels a reveal still waiting for its batch,
    // so this is the shorter check that it did rather than a wait long enough to outlast
    // one: a selection that is still there after a beat is one nothing is going to take.
    await settle(300);
    await expect(row).toHaveClass(/primary/, { timeout: 2000 });
  }, `the grid row for "${needle}" to stay the one a dialog would open about`).toPass({
    timeout: 20_000
  });
}

/**
 * Tell the app the repository moved.
 *
 * The watcher sees `.git`, but a step that writes files and commits from underneath the
 * app is faster than the debounce, and several steps set the scene that way.
 */
export async function refreshApp(app: GitextApp): Promise<void>
{
  await app.main.bringToFront();
  // F5, which is what `view.refresh` binds in the repository window. Not Mod+Shift+R:
  // that is `staging.refresh`, whose scope is the *commit screen*, so it does nothing.
  await app.main.keyboard.press('F5');
  // The reload streams in, so what says it finished is the grid having rows again rather
  // than a number of milliseconds.
  await expect(
    app.main.locator(GRID_ROW).first(),
    'the revision grid to reload'
  ).toBeVisible();
  // The grid says it has rows again; the panes beside it are still catching up, and this
  // is the one moment here with nothing better to watch.
  await settle(250);
}

/**
 * Select the working-tree row, so the file commands have an operand.
 *
 * Two traps in one helper. The artificial rows only exist while the working tree is
 * dirty, and a file just written from underneath the app reaches the grid through the
 * watcher, so on a slow run the row is genuinely not there yet: without the retry the
 * next dialog opens about whichever file was previously selected. And the grid is
 * virtualized, so a row that is not on screen is not in the DOM at all: by this point the
 * grid is scrolled to whichever commit an earlier step selected, which leaves the
 * artificial rows (always the first ones) unrendered.
 *
 * Matched by `.artificial` rather than by the word "Working": the row's own class is what
 * the grid actually promises, and the text is a label that may be reworded.
 */
export async function selectWorkingTreeRow(app: GitextApp): Promise<void>
{
  const row = app.main.locator('.grid .row.artificial').first();
  await expect(async () =>
  {
    await app.main.evaluate(() =>
    {
      const scroller = document.querySelector('.grid .scroller');
      if (scroller)
      {
        scroller.scrollTop = 0;
      }
    });
    await expect(row).toBeVisible({ timeout: 2000 });
  }, 'a working-tree row in the grid to select').toPass({ timeout: 15_000 });
  await row.dispatchEvent('click');
  // The file list filling is what the working-tree row is selected *for*, and it is what
  // the next gesture reaches into.
  await expect(
    app.main.locator('.files .row').first(),
    'the working tree\'s file list to fill'
  ).toBeVisible();
}

/**
 * Click the row for one path in whichever file list the window is showing.
 *
 * The list is virtualized like the grid, and by this point in a spec several earlier
 * steps have left other changed files behind, so the wanted row may simply not be in the
 * DOM until the list is scrolled to where it sorts. Scrolled to the top and retried
 * rather than trusted once.
 */
export async function selectFileRow(app: GitextApp, name: string): Promise<void>
{
  const row = app.main.locator('.files .row, .list .row').filter({ hasText: name }).first();
  await expect(async () =>
  {
    await app.main.evaluate(() =>
    {
      const scroller = document.querySelector('.files .list');
      if (scroller)
      {
        scroller.scrollTop = 0;
      }
    });
    await expect(row).toBeVisible({ timeout: 2000 });
  }, `a file-list row for ${name}`).toPass({ timeout: 12_000 });
  await row.scrollIntoViewIfNeeded();
  await row.dispatchEvent('click');
  await expect(row, `the ${name} row to take the selection`).toHaveClass(/selected/);
}

/**
 * Select the first real commit row, whichever it is.
 *
 * For a step that needs the selection to genuinely *move* before it lands back on the
 * working-tree row: the app's watcher cannot see a plain external file write (it watches
 * `.git`, not the working tree), so the file pane only re-reads when the selection
 * actually changes, and re-clicking an already-selected row does not. By text would be
 * wrong here: the grid is virtualized and a named commit may be scrolled out of it.
 */
export async function selectFirstCommitRow(app: GitextApp): Promise<void>
{
  await app.main.evaluate(() =>
  {
    const scroller = document.querySelector('.grid .scroller');
    if (scroller)
    {
      scroller.scrollTop = 0;
    }
  });
  await app.main.locator('.grid .row:not(.artificial):not(.probe)').first().dispatchEvent('click');
  await settle(250);
}

/**
 * Extend the grid's selection to a neighbour of whatever is selected, by Mod-clicking it.
 *
 * A *real* click with the modifier physically held, not a synthetic MouseEvent. The grid
 * reads the modifier off the event it actually receives, and a dispatched one replaces
 * the selection instead of extending it: which leaves one commit selected and the command
 * unavailable, a failure that reads as the dialog refusing to open.
 *
 * A neighbour rather than a named commit, so a step using this stands alone: it does not
 * depend on a commit some earlier step created still being on screen. Located by index
 * rather than by a filtered locator for the same reason the click is real: the grid is
 * virtualized, so Playwright would wait for a stable element that is being recycled
 * underneath it.
 */
export async function modClickNeighbour(app: GitextApp): Promise<void>
{
  const index = await app.main.evaluate(() =>
  {
    const rows = [...document.querySelectorAll('.grid .row')];
    const selected = rows.findIndex((r) => r.classList.contains('selected'));
    if (selected < 0)
    {
      return -1;
    }
    if (selected + 1 < rows.length)
    {
      return selected + 1;
    }
    return selected - 1;
  });
  expect(index, 'no second commit on screen to Mod-click').toBeGreaterThanOrEqual(0);

  const box = await app.main.locator('.grid .row').nth(index).boundingBox();
  expect(box, 'the second commit has no box to click').not.toBeNull();

  let held = 'Control';
  if (process.platform === 'darwin')
  {
    held = 'Meta';
  }
  await app.main.keyboard.down(held);
  await app.main.mouse.click(box!.x + 40, box!.y + box!.height / 2);
  await app.main.keyboard.up(held);
  await settle(600);

  await expect(app.main.locator('.grid .row.selected')).toHaveCount(2);
}
