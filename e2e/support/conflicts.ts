import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import type { GitextApp } from './app.js';
import { Dialog } from './dialog.js';

/** Which side of a conflict a row button takes, in git's own words rather than the UI's. */
export type Side = 'ours' | 'theirs';

/**
 * The conflict list: one row per unmerged path, each carrying its own actions.
 *
 * Never opened from the palette by the specs that use it. Every conflict is made with raw
 * git, outside the app entirely, and the app is expected to notice and raise this window
 * on its own: so waiting for it *is* one of the assertions. Opening it by hand would
 * drive a window that had already been raised and prove nothing about how it got there.
 */
export class Resolver extends Dialog
{
  /**
   * The row for one path.
   *
   * Scoped to the row, never to the window: every row carries the same buttons, so a
   * window-wide selector finds the first row's rather than the one the step named.
   */
  row(filePath: string): Locator
  {
    return this.page
      .locator('.rows .row:not(.folder)')
      .filter({ has: this.page.locator('.path', { hasText: new RegExp(`^\\s*${filePath}\\s*$`) }) })
      .first();
  }

  /** Take one side of one file, from that file's own row. */
  async keepSide(filePath: string, side: Side): Promise<void>
  {
    const button = this.row(filePath).locator(`.row-actions button[data-side="${side}"]`);
    await this.press(button, `the ${side} button on the row for ${filePath}`);
  }

  /** Open one file in the built-in three-way editor, from that file's own row. */
  async resolveHere(filePath: string): Promise<void>
  {
    const button = this.row(filePath).locator('.row-actions button[aria-label^="Resolve "]');
    await this.press(button, `the Resolve button on the row for ${filePath}`);
  }
}

/** The three-way editor, in a window of its own. */
export class ConflictEditor extends Dialog
{
  /**
   * Click a button on a conflict block's floating toolbar, by what its label starts with.
   *
   * By `aria-label` because the buttons are icons: there is no text to match on, which is
   * the trade the legend above the editor pays for.
   *
   * **The one place a real click is kept.** These are raw DOM handed to Monaco as view
   * zones, outside Vue entirely, and under a sibling layer that hit-tests as opaque: a
   * toolbar can draw perfectly and take no clicks, and a dispatched event would reach the
   * handler and prove nothing about whether a person could press it. Everything else in
   * this suite dispatches (see `Dialog.press`); this is what that exception exists for.
   */
  async blockAction(labelPrefix: string): Promise<void>
  {
    const button = this.page
      .locator(`.gitext-conflict-toolbar button[aria-label^="${labelPrefix}"]`)
      .first();
    await expect(button, `a toolbar button labelled "${labelPrefix}…"`).toBeEnabled();
    await button.click();
  }

  /** How many conflict blocks the editor still says are left. */
  blocksLeft(): Locator
  {
    return this.page.locator('.summary .count');
  }

  /** How many Monaco panes actually mounted: two reference diffs and the result. */
  mountedPanes(): Promise<number>
  {
    return this.page.evaluate(
      () =>
        (window as unknown as { monaco?: typeof import('monaco-editor') }).monaco?.editor.getEditors()
          .length ?? 0
    );
  }
}

/**
 * Wait for the conflict list the app raised, and for it to know which operation it is in.
 *
 * The heading is waited on rather than read once. The window has a title before it has an
 * answer from git, and for those first frames it honestly says "none in progress":
 * asserting on it there passes or fails on how quickly git answers.
 */
export async function openResolver(app: GitextApp, operationLabel: string): Promise<Resolver>
{
  const window = await app.waitForWindow('Solve Merge Conflicts', 15_000);
  const resolver = new Resolver(window);
  await expect(
    resolver.page.locator('h2').first(),
    `the resolver to report a ${operationLabel} in progress`
  ).toHaveText(`Solve Merge Conflicts · ${operationLabel} in progress`);
  return resolver;
}

/** Open the resolver, then open one of its files in the editor, and hand back both. */
export async function openEditorOn(
  app: GitextApp,
  filePath: string,
  operationLabel = 'Merge'
): Promise<{ resolver: Resolver; editor: ConflictEditor }>
{
  const resolver = await openResolver(app, operationLabel);
  await resolver.resolveHere(filePath);
  const editor = new ConflictEditor(await app.waitForWindow('Resolve Conflict', 15_000));
  // The panes are Monaco and load off the critical path, so what says the window is ready
  // is a block toolbar existing, not a number of milliseconds.
  await expect(
    editor.page.locator('.gitext-conflict-toolbar').first(),
    'the editor to draw a conflict toolbar'
  ).toBeVisible();
  return { resolver, editor };
}
