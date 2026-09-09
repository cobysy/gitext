import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import type { GitextApp } from './app.js';
import { POLL_MS, mod, pause } from './app.js';
import { Dialog } from './dialog.js';
import { settle } from './options.js';

/** Which of the screen's two lists a gesture is aimed at. */
export type Side = 'unstaged' | 'staged';

/** How a row is clicked: the four gestures the list reads differently. */
export interface RowClick
{
  modifier?: 'meta' | 'shift';
  kind?: 'click' | 'contextmenu' | 'dblclick';
}

/**
 * The commit screen, which is a window of its own.
 *
 * It stopped being an overlay inside the repository window, and a tour that was never
 * told looked for every selector in a window that no longer held them. So this is
 * addressed like any other dialog: found by title, driven through its own page.
 */
export class CommitScreen extends Dialog
{
  /**
   * One of the two lists.
   *
   * By the wrapper class rather than by index: the two `.staging-list` elements sit in
   * separate `.unstaged` / `.staged` wrappers, so each is the *first* of its type inside
   * its own parent and an `:nth-of-type(2)` matches nothing at all.
   */
  list(side: Side): Locator
  {
    return this.page.locator(`.${side} .staging-list`);
  }

  rows(side: Side): Locator
  {
    return this.page.locator(`.${side} .staging-list .row`);
  }

  row(side: Side, text: string): Locator
  {
    return this.rows(side).filter({ hasText: text }).first();
  }

  /** The rows of one list as text: for reporting and for shape assertions. */
  rowTexts(side: Side): Promise<string[]>
  {
    return this.rows(side)
      .allInnerTexts()
      .then((all) => all.map((t) => t.replace(/\s+/g, ' ').trim()));
  }

  /**
   * Click a row, with the modifier the gesture means.
   *
   * The modifier is carried on the event rather than held on the keyboard: the list reads
   * `metaKey`/`shiftKey` off the event it receives, and dispatching lets a virtualized row
   * be addressed without a hit-test. `ctrlKey` stands in for `metaKey` off macOS, which
   * is what the app's own modifier check does.
   */
  async clickRow(side: Side, text: string, options: RowClick = {}): Promise<void>
  {
    const row = this.row(side, text);
    await expect(row, `a "${text}" row in the ${side} list`).toBeVisible();
    await row.dispatchEvent(options.kind ?? 'click', {
      bubbles: true,
      metaKey: options.modifier === 'meta' && process.platform === 'darwin',
      ctrlKey: options.modifier === 'meta' && process.platform !== 'darwin',
      shiftKey: options.modifier === 'shift'
    });
    // What a click means here is that the row is now selected, which the row says itself.
    // A right-click selects nothing, so that one waits for the menu it opened instead.
    if ((options.kind ?? 'click') === 'contextmenu')
    {
      await expect(this.page.locator('.menu').first(), 'the row menu to open').toBeVisible();
      return;
    }
    await expect(row, `the "${text}" row to take the selection`).toHaveClass(/selected/);

    /*
     * And then the diff pane, which is what most steps read next.
     *
     * It reloads from git *after* the selection moves, so a step that went straight on
     * would read the previous file's hunks. The header names the file it is showing, so
     * that is the condition: only when the row names a file, since a folder row and a
     * multi-select have no single path to wait for. It cannot tell the two sides apart,
     * the same path is on both, so a step reading the *verb* on a button waits for that
     * itself.
     */
    const namesAFile = text.includes('.') && !options.modifier;
    if (namesAFile)
    {
      await expect(
        this.page.locator('.staging-diff .head .path'),
        `the diff pane to load ${text}`
      ).toContainText(text);
    }
  }

  /** Select a row, then open its context menu. */
  async openRowMenu(side: Side, text: string): Promise<void>
  {
    await this.clickRow(side, text);
    await this.clickRow(side, text, { kind: 'contextmenu' });
  }

  /** Open one of the list headers' `⋯` view menus. */
  async openViewMenu(side: Side): Promise<void>
  {
    await this.press(this.page.locator(`.${side} .view`).first(), `the ${side} list's ⋯ button`);
    await expect(this.page.locator('.menu').first(), 'the list-options menu').toBeVisible();
  }

  /**
   * Press one of a list header's own buttons: *Stage All*, *Unstage All*.
   *
   * Through `press`, which waits for the button to be enabled. It is disabled while there
   * is nothing for it to act on, and the lists reload from git after every index move, so
   * a raw dispatch lands on a dead button and does nothing at all: reported later as the
   * command having run and achieved nothing.
   */
  async clickListButton(side: Side, label: string): Promise<void>
  {
    const button = this.page.locator(`.${side} button`).filter({ hasText: label }).first();
    await this.press(button, `an enabled "${label}" button on the ${side} list`);
  }

  /** Open one of the buttons on the row beside Commit. */
  async openScreenMenu(label: string): Promise<void>
  {
    const button = this.page.locator('.controls button').filter({ hasText: label }).first();
    await this.press(button, `the "${label}" button`);
    await expect(this.page.locator('.menu').first(), `the "${label}" menu`).toBeVisible();
  }

  /**
   * Press a row's `→` / `←` button, which moves the whole file to the other list.
   *
   * The button is hidden until the row is hovered, which a dispatched click does not need
   * and a real one would have to arrange.
   */
  async moveRow(side: Side, text: string): Promise<void>
  {
    const move = this.row(side, text).locator('.move');
    await expect(move, `a move button on the "${text}" row in the ${side} list`).toBeAttached();
    const before = await this.rows(side).count();
    await move.dispatchEvent('click');
    // The file leaving the list it was in is what "moved" means, and the list says so as
    // soon as it has reloaded from git. A folder takes its children with it, so this
    // waits on the count rather than on that one row.
    await expect(
      this.rows(side),
      `the "${text}" row to leave the ${side} list`
    ).not.toHaveCount(before);
  }

  /**
   * Press a hunk's stage/unstage button.
   *
   * `needle` picks among several by what the button says, and has to match the button's
   * text content rather than its rendered text: the words live in a tooltip span that is
   * `display: none` until hover, so anything reading only what is visible reads back
   * empty.
   */
  async clickHunkAction(hunkSelector: string, needle?: string): Promise<void>
  {
    let button = this.page.locator(`${hunkSelector} .hunk-action`);
    if (needle)
    {
      button = button.filter({ hasText: needle });
    }
    await expect(
      button.first(),
      `a hunk action button in ${hunkSelector}`
    ).toBeAttached();
    await button.first().dispatchEvent('click');
    await settle(400);
  }

  /**
   * The first hunk action's button, for a step asserting on which direction it offers.
   *
   * A locator rather than the text, so the step's own `expect` retries: the two sides
   * show the same path, so selecting a row on the staged side cannot be waited out by
   * watching the diff pane's header, and the verb is the first thing that says the pane
   * has caught up.
   */
  hunkAction(): Locator
  {
    return this.page.locator('.hunk-action').first();
  }

  /**
   * What is in the commit message box.
   *
   * Through Monaco's model, not the DOM: the box is an editor, its textarea is one
   * character wide and holds nothing, and what it renders is only the lines on screen.
   */
  messageText(): Promise<string>
  {
    return this.page.evaluate(() =>
    {
      const editor = (window as unknown as { monaco?: typeof import('monaco-editor') }).monaco
        ?.editor.getEditors()
        .find((e) => e.getModel()?.getLanguageId() === 'markdown');
      return editor?.getValue() ?? '';
    });
  }

  /**
   * Type a commit message.
   *
   * **Really typed**: a real click to take focus, then keystrokes. `insertText` goes in
   * through the same input the keyboard does, so autocomplete, auto-indent and anything
   * else the editor does to what you type happens here too. Assigning the model would
   * skip all of it, and skipping it is how a suite passes on an editor nobody can
   * actually type into. Monaco takes focus from the mouse event, so a dispatched click
   * would leave the keyboard wherever it already was: this is one of the few places a
   * real click is load-bearing.
   */
  async writeMessage(text: string): Promise<void>
  {
    await this.page.click('.compose .message .monaco-editor');
    await this.page.keyboard.press(mod('a'));
    await this.page.keyboard.insertText(text);
    await settle(500);
    expect((await this.messageText()).trim(), 'the message box did not take what was typed').toBe(
      text.trim()
    );
  }

  /** Type into a list's filter box. */
  async typeFilter(side: Side, text: string): Promise<void>
  {
    const box = this.page.locator(`.${side} .filter-box input`);
    await box.fill(text);
    await settle(700);
  }

  /** Tick or untick one of the checkboxes on the controls row. */
  /**
   * Flip one of the commit screen's checkboxes, named by the label beside it.
   *
   * By label rather than by position, and waited for rather than assumed: an index into
   * `.controls input[type=checkbox]` is a bet that the row is rendered *and* that nothing
   * has been added before it, and a freshly opened screen loses that bet often enough to
   * fail about one run in three under load. `toBeVisible` is the gate, and the returned
   * state is read back so the caller knows the click landed.
   */
  async toggleCheckbox(label: string): Promise<boolean>
  {
    const box = this.page
      .locator('.controls label.check', { hasText: label })
      .locator('input[type=checkbox]');
    await expect(box, `a checkbox labelled "${label}"`).toBeVisible();
    const before = await box.isChecked();
    await box.dispatchEvent('click');
    // The state flipping is the app acknowledging the click, which is the whole condition
    // rather than a sign of it: a fixed pause here was what the old positional version
    // leaned on.
    await expect(box, `"${label}" did not change state`).toBeChecked({ checked: !before });
    return !before;
  }

  /**
   * Click a menu row by its label.
   *
   * The tick is stripped before matching. A checked row reads `✓ <label>`, so a plain
   * prefix match catches the *first* press of a toggle and then misses the second, which
   * is how a toggle appeared to work going on and vanish coming off.
   */
  async menuClick(label: string): Promise<void>
  {
    const row = this.menuRow(label);
    await expect(row, `a menu row starting with "${label}"`).toBeVisible();
    await row.dispatchEvent('click');
    // The menu closing is the app acknowledging the row, and it is what the next gesture
    // needs to be true before it can reach anything underneath.
    await expect(this.page.locator('.menu'), 'the menu to close').toHaveCount(0);
    await settle(400);
  }

  /** Hover a submenu row so its panel opens: a hover, not a click. */
  async menuHover(label: string): Promise<void>
  {
    await this.menuRow(label).dispatchEvent('mouseenter');
    // A submenu is a second `.menu` panel: waiting for it beats guessing how long the
    // hover takes to open one.
    await expect(this.page.locator('.menu').nth(1), `the "${label}" submenu`).toBeVisible();
  }

  private menuRow(label: string): Locator
  {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page
      .locator('.menu > .row')
      .filter({ hasText: new RegExp(`^\\s*(✓\\s*)?${escaped}`) })
      .first();
  }

  async closeMenus(): Promise<void>
  {
    await this.page.keyboard.press('Escape');
    // The panel going is the whole of what this does, so it is what to wait for.
    await expect(this.page.locator('.menu'), 'the menu to close').toHaveCount(0);
  }

  /**
   * Answer the in-page confirmation.
   *
   * `.scrim .frame` and not a window: the confirmations are the one dialog still drawn in
   * the page. Every *operation* dialog is its own window, and the Undo menu's resets open
   * one: those are answered with `dialogWindowButton` instead.
   */
  async confirm(accept = true): Promise<string>
  {
    const buttons = this.page.locator('.scrim .frame .actions button');
    await expect(buttons.first(), 'a confirmation to answer').toBeVisible();
    const count = await buttons.count();
    let button = buttons.first();
    if (accept)
    {
      button = buttons.nth(count - 1);
    }
    const label = ((await button.textContent()) ?? '').trim();
    await button.dispatchEvent('click');
    await expect(this.page.locator('.scrim'), 'the confirmation to close').toHaveCount(0);
    await settle(500);
    return label;
  }
}

/**
 * Open the commit screen, and hand back the window it opened.
 *
 * Through the palette, like every other command. The palette's first matches are the View
 * toggles that merely mention "commit", so the row is picked by its label rather than by
 * pressing Enter on whatever ranked first.
 */
export async function openCommitScreen(app: GitextApp): Promise<CommitScreen>
{
  /*
   * An already-open screen is reused, but only one that is still there a moment later.
   *
   * The window list can name one that is on its way out: committing closes the screen,
   * and a step that runs while that is in flight finds the window, hands it back, and
   * fails on the first keystroke with "target closed". So the check is made, held, and
   * made again, the same shape `selectCommit` uses against the grid's reveal.
   */
  const standing = async (): Promise<CommitScreen | null> =>
  {
    for (const win of app.dialogWindows())
    {
      if ((await win.title().catch(() => null)) !== 'Commit')
      {
        continue;
      }
      const alive = (): Promise<boolean> =>
        win.locator('.commit-screen').isVisible().catch(() => false);
      if (!(await alive()))
      {
        continue;
      }
      await pause(150);
      if (!win.isClosed() && (await alive()))
      {
        return new CommitScreen(win);
      }
    }
    return null;
  };

  const already = await standing();
  if (already)
  {
    return already;
  }

  await app.main.bringToFront();
  await app.main.keyboard.press(mod('p'));
  await expect(app.main.locator('.palette'), 'the command palette to open').toBeVisible();
  await app.main.keyboard.press(mod('a'));
  await app.main.keyboard.type('Commit');

  const row = app.main
    .locator('.palette .item')
    .filter({ has: app.main.locator('.label', { hasText: /^\s*Commit…\s*$/ }) })
    .first();
  await expect(row, 'the palette to offer "Commit…"').toBeVisible();
  await row.dispatchEvent('click');

  const screen = new CommitScreen(await app.waitForWindow('Commit', 12_000));
  await expect(screen.page.locator('.commit-screen')).toBeVisible();
  // Its two lists fill from git after it mounts, and the counts are what every step reads,
  // so the rows are waited for rather than the elements that will hold them.
  await expect(screen.page.locator('.staging-list')).toHaveCount(2);
  await expect(
    screen.rows('unstaged'),
    'the unstaged list to fill from git'
  ).not.toHaveCount(0);
  return screen;
}

/**
 * Press a button in a dialog *window* opened over the commit screen.
 *
 * Not every destructive action is an in-page confirmation: `file.reset` still asks with
 * one, but the Undo menu's resets open `reset.changes` as a window of its own. Asking
 * both of them for a scrim is how a step waits for something that window has not drawn.
 */
export async function dialogWindowButton(
  app: GitextApp,
  screen: CommitScreen,
  label: string
): Promise<void>
{
  const deadline = Date.now() + 8000;
  let win = null;
  while (Date.now() < deadline && !win)
  {
    win = app.dialogWindows().find((w) => w !== screen.page) ?? null;
    if (!win)
    {
      await pause(POLL_MS);
    }
  }
  if (!win)
  {
    throw new Error(`no dialog window opened to press "${label}" in`);
  }

  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.frame')).toBeVisible();
  await win.locator('button').filter({ hasText: label }).first().dispatchEvent('click');

  // Gone is how a dialog reports that it ran, the same as everywhere else.
  const closedBy = Date.now() + 8000;
  while (Date.now() < closedBy)
  {
    if (win.isClosed())
    {
      return;
    }
    await pause(POLL_MS);
  }
  throw new Error(`the dialog did not close after pressing "${label}"`);
}
