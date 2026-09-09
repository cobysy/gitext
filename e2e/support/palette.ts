import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import type { GitextApp } from './app.js';
import { mod } from './app.js';
import { Dialog } from './dialog.js';
import { settle } from './options.js';

/** A trailing ellipsis means "this one opens a window" and is not part of the name. */
function bare(text: string): string
{
  return text.replace(/…$/, '').trim();
}

/** The label, with or without the ellipsis the menu row draws after it. */
function labelPattern(label: string): RegExp
{
  const escaped = bare(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*${escaped}…?\\s*$`);
}

/**
 * Fail before opening anything if a window is still up from the step before.
 *
 * It would otherwise be picked up below as though this command had opened it, and every
 * assertion after that would be about the wrong dialog. The palette cannot be reached
 * from here anyway: the repository window is inert while a modal is up. So this is a bug
 * in the step before, and it says so rather than producing a confusing failure three
 * lines later.
 */
async function refuseStaleWindows(app: GitextApp, commandLabel: string): Promise<void>
{
  const stale = app.dialogWindows();
  if (stale.length === 0)
  {
    return;
  }
  const titles = await Promise.all(stale.map((w) => w.title()));
  throw new Error(
    `"${commandLabel}" cannot open: ${titles.join(', ')} still open from the step before`
  );
}

/** Raise the palette and type a query into it, handing back its result rows. */
async function typeQuery(app: GitextApp, commandLabel: string): Promise<Locator>
{
  const main = app.main;
  await main.bringToFront();
  await main.keyboard.press(mod('p'));
  await expect(main.locator('.palette'), 'the command palette to open').toBeVisible();

  // The palette remembers what was typed into it last time. Without this the second step
  // types its label onto the end of the first step's and the fuzzy match opens whatever
  // that spells, which is a failure that reads as the dialog under test doing nothing.
  await main.keyboard.press(mod('a'));
  await main.keyboard.type(commandLabel);

  const rows = main.locator('.palette .results .item');
  await expect(rows.first(), `the palette to offer a match for "${commandLabel}"`).toBeVisible();
  return rows;
}

/**
 * Click the palette row this step *named*.
 *
 * Rather than pressing Enter on whatever the fuzzy match happened to rank first: two
 * commands can share a prefix, and which of them leads depends on a `when` an earlier
 * step may have made true. Two rows sharing the label is a failure rather than a coin
 * toss, which is the same invariant `menu.test.ts` guards.
 */
async function clickNamedRow(app: GitextApp, rows: Locator, commandLabel: string): Promise<void>
{
  const named = rows.filter({
    has: app.main.locator('.label').filter({ hasText: labelPattern(commandLabel) })
  });
  const matches = await named.count();
  if (matches > 1)
  {
    throw new Error(`"${commandLabel}" matches ${matches} palette rows`);
  }
  if (matches === 1)
  {
    await named.first().dispatchEvent('click');
    return;
  }
  // Said out loud: a step that asked for one command and got another by prefix is the
  // most confusing failure this suite can produce, and this is the line that gives it
  // away.
  const chose = await rows.first().locator('.label').textContent();
  console.log(`  palette: asked "${commandLabel}", ran "${chose?.trim()}"`);
  await rows.first().dispatchEvent('click');
}

/**
 * Open a dialog through the command palette.
 *
 * The palette resolves ids through the same registry the menus do, so this exercises the
 * command's `run`, its payload included, rather than a URL this suite invented.
 */
export async function openViaPalette(
  app: GitextApp,
  commandLabel: string,
  expectedTitle?: string
): Promise<Dialog>
{
  await refuseStaleWindows(app, commandLabel);
  const rows = await typeQuery(app, commandLabel);
  await clickNamedRow(app, rows, commandLabel);

  const dialog = new Dialog(await app.waitForAnyDialog(8000, commandLabel));

  /*
   * `expectedTitle` is the dialog's own heading, not its window title.
   *
   * The two are different strings for a third of the dialogs here: the *Reset Changes*
   * window is headed "Reset all changes", *Edit File* is headed "Edit .gitignore" or
   * "Edit .git/config" depending on what it was handed, and *Delete Remote Branches* is
   * headed "Delete Branches on origin". The heading is the one that names what the dialog
   * was opened *about*, which is what a step wants to pin, so this waits for whatever
   * window opened and then reads its `h2`.
   *
   * Waited for rather than read once: a window exists before its renderer has mounted
   * anything, and reading the heading too early gets nothing and reports it as the wrong
   * dialog.
   */
  await expect(
    dialog.page.locator('h2').first(),
    `"${commandLabel}" to draw its heading`
  ).not.toBeEmpty();
  if (expectedTitle)
  {
    expect(await dialog.title(), `"${commandLabel}" opened the wrong dialog`).toBe(expectedTitle);
  }
  /*
   * A dialog that has drawn its title is not necessarily one whose form has filled in
   * from its payload.
   *
   * Where there is a command preview, it having an argv in it *is* that condition: the
   * preview is computed from the same values the form holds, so a non-empty one says the
   * payload landed. The dialogs with no preview are the ones that run no git, and the
   * form primitives wait for what they need anyway: `setSelect` for its option, `press`
   * for an enabled button.
   */
  const preview = dialog.page.locator('.preview code').first();
  if ((await preview.count()) > 0)
  {
    await expect(preview, `"${commandLabel}" to fill its preview in`).not.toBeEmpty();
  }
  else
  {
    await settle(250);
  }
  await dialog.expectFits();
  return dialog;
}

/**
 * Run a palette command that opens no window: a menu row that just does something.
 *
 * `openViaPalette` waits for a dialog and fails when none appears, which is right for
 * everything else. Some commands are a config edit with no form to fill in, and still
 * deserve driving from a real entry point.
 */
export async function runViaPalette(app: GitextApp, commandLabel: string): Promise<void>
{
  const rows = await typeQuery(app, commandLabel);
  await clickNamedRow(app, rows, commandLabel);
  // Nothing to watch for: the command opens no window, and what it did is what the step
  // goes on to assert against git.
  await settle(800);
}
