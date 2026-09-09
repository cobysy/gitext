import { expect } from '@playwright/test';
import type { GitextApp } from './app.js';
import { settle } from './options.js';

/** How many unfolding rounds to allow before calling the panel stuck. */
const UNFOLD_LIMIT = 60;

/**
 * Open every folder in the left panel, so its rows are all in the DOM.
 *
 * The list is virtualized and the panel remembers what was open across runs, so a remote
 * branch two folders deep simply is not there to be clicked or asserted on until its
 * ancestors are unfolded. Re-queried after each click rather than snapshotted, because
 * unfolding a folder reveals folders inside it.
 *
 * Dispatched clicks: see `Dialog.press`. A real one hit-tests, and these are rows of a
 * virtualized list being recycled underneath the cursor.
 */
export async function expandPanel(app: GitextApp): Promise<void>
{
  await app.main.bringToFront();
  // `:has(svg)` is what "this row can actually fold" looks like in the DOM. `Twisty`
  // keeps its width on a row with nothing to fold, so the rows under it stay indented
  // from the same edge, and draws the chevron only when `expandable`. Without that half
  // of the selector every leaf row's empty placeholder is a twisty that is not `.open`,
  // and clicking it forever is a loop that only ends in the round limit below.
  const closed = app.main.locator('.left-panel .row .twisty:not(.open):has(svg)');
  for (let round = 0; round < UNFOLD_LIMIT; round++)
  {
    if ((await closed.count()) === 0)
    {
      await settle(300);
      return;
    }
    await closed.first().dispatchEvent('click');
  }
  throw new Error('the left panel still has folded rows after 60 rounds of unfolding');
}

/**
 * Which panel row carries this label, counting only the rows under one section.
 *
 * `section` is not optional decoration. A local branch and the remote branch it tracks
 * have the *same label*, the remote's children drop the `origin/` prefix, so the label
 * alone selects whichever comes first in the tree, which is the local one. The rows are
 * one flat virtualized list with `.section` markers in it, and there is no selector for
 * "between this marker and the next", so the arithmetic is done over the DOM and the
 * index it returns is what gets clicked.
 */
async function rowIndex(app: GitextApp, label: string, section?: string): Promise<number>
{
  const found = await app.main.evaluate(
    ({ text, sectionLabel }) =>
    {
      const rows = [...document.querySelectorAll('.left-panel .row')];
      // `.label`, not the row's text: a section row's text starts with the twisty glyph,
      // and the label itself is title-case in the DOM and only uppercased by CSS.
      const labelOf = (row: Element): string =>
        row.querySelector('.label')?.textContent?.trim() ?? '';

      let start = -1;
      if (sectionLabel)
      {
        start = rows.findIndex(
          (row) =>
            row.classList.contains('section') &&
            labelOf(row).toUpperCase() === sectionLabel.toUpperCase()
        );
        if (start === -1)
        {
          return { error: 'no-section' as const };
        }
      }

      const after = rows.slice(start + 1);
      let end = -1;
      if (sectionLabel)
      {
        end = after.findIndex((row) => row.classList.contains('section'));
      }
      let scope = after;
      if (end !== -1)
      {
        scope = after.slice(0, end);
      }

      const at = scope.findIndex((row) => labelOf(row) === text);
      if (at === -1)
      {
        return { error: 'no-row' as const };
      }
      return { index: start + 1 + at };
    },
    { text: label, sectionLabel: section }
  );

  if (found.error === 'no-section')
  {
    throw new Error(`no panel section "${section}"`);
  }
  if (found.error === 'no-row')
  {
    let under = '';
    if (section)
    {
      under = ` under ${section}`;
    }
    throw new Error(`no panel row labelled "${label}"${under}`);
  }
  return found.index!;
}

/** Select the left-panel row with this label, under this section. */
export async function selectPanelNode(
  app: GitextApp,
  label: string,
  section?: string
): Promise<void>
{
  await expandPanel(app);
  const index = await rowIndex(app, label, section);
  const row = app.main.locator('.left-panel .row').nth(index);
  await row.dispatchEvent('click');
  await expect(row, `the "${label}" panel row to take the selection`).toHaveClass(/selected/);
}

/**
 * Right-click a left-panel row and click a row of the menu it opens.
 *
 * The palette cannot stand in for this one. Two commands are labelled from the same verb:
 * the panel's *Checkout* on a ref, and the menu bar's *Checkout Branch…* which always
 * opens the dialog: so a palette query would be choosing between them by luck.
 */
export async function runFromPanelMenu(
  app: GitextApp,
  rowLabel: string,
  section: string | undefined,
  menuLabel: string
): Promise<void>
{
  await expandPanel(app);
  const index = await rowIndex(app, rowLabel, section);
  const row = app.main.locator('.left-panel .row').nth(index);
  await row.dispatchEvent('click');
  // The context menu is opened by the event the app listens for, `contextmenu`, rather
  // than by a real right-click: the row is in a virtualized list, and what the app reads
  // off the event is that it happened, not where.
  await row.dispatchEvent('contextmenu');

  const menu = app.main.locator('.menu');
  await expect(menu, 'the panel context menu').toBeVisible();
  await menu.locator('.row').filter({ hasText: menuLabel }).first().dispatchEvent('click');
  // The menu closing is the app acknowledging the row; what the row then does is what the
  // step asserts.
  await expect(menu, 'the panel context menu to close').toHaveCount(0);
  await settle(500);
}
