import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { settle } from './options.js';

/**
 * The tallest a form may be before it has outgrown the display.
 *
 * 700px is the smallest current Mac laptop worked backwards through the 92% ceiling and
 * the fit's headroom. The machine a change is written on is the biggest one it will ever
 * meet, so the budget is checked rather than the window that happened to fit.
 */
const FORM_BUDGET = 700;

/** One reading of a dialog's height: `measureFit`'s answer. */
interface Fit {
  /** The window's height is its own decision, so neither rule applies to it. */
  fixed: boolean;
  /** How far the form runs past the bottom of the body that holds it. */
  past: number;
  /** How tall the form wants to be, header and footer included. */
  content: number;
}

/** Match an element whose whole trimmed text is exactly this. */
function exactly(text: string): RegExp
{
  return new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
}

/**
 * One dialog window, and the form primitives for driving it.
 *
 * Everything here is a locator, so everything here waits: a button is clicked once it is
 * enabled, an option chosen once git has supplied it, a field filled once it is editable.
 * That is what replaced the tours' own poll-and-throw helpers, which existed because a
 * helper that can silently do nothing is a bug: it left the form on its default and the
 * step drove the wrong branch, reported three assertions later as the app doing nothing.
 */
export class Dialog
{
  constructor(readonly page: Page)
  {}

  /** The dialog's own heading, which is how a step names which window it has. */
  async title(): Promise<string>
  {
    return (await this.page.locator('h2').first().textContent())?.trim() ?? '';
  }

  /** What the dialog says it will run. Recorded beside what actually happened. */
  async preview(): Promise<string>
  {
    const lines = this.page.locator('.preview code');
    if ((await lines.count()) === 0)
    {
      return '';
    }
    return (await lines.allTextContents()).join('\n');
  }

  /** Choose an option in the dialog's first picker, once git has supplied it. */
  async setSelect(optionValue: string): Promise<void>
  {
    const select = this.page.locator('select').first();
    await expect(
      select.locator(`option[value="${optionValue}"]`),
      `the "${optionValue}" option in the dialog's picker`
    ).toBeAttached();
    await select.selectOption(optionValue);
  }

  /** Choose an option in the picker whose form row carries this label. */
  async setSelectByLabel(label: string, optionValue: string): Promise<void>
  {
    const select = this.rowFor(label).locator('select').first();
    await expect(
      select.locator(`option[value="${optionValue}"]`),
      `the "${optionValue}" option in the "${label}" picker`
    ).toBeAttached();
    await select.selectOption(optionValue);
  }

  /** Type into the dialog's only writable text field. */
  async setText(text: string): Promise<void>
  {
    await this.fillAndCommit(this.page.locator('input[type=text]:not([readonly])').first(), text);
  }

  /**
   * Fill a field and tell the form the user has left it.
   *
   * `fill` sends `input`, which is what `v-model` reads, and that is not the whole
   * contract: a field that rewrites what you typed does it on the way out. The branch-name
   * normaliser is on `@blur`, so a fill alone leaves `tour: a branch` in the box, git
   * refuses the name, the confirming button never enables and the dialog never closes.
   *
   * Dispatched rather than `locator.blur()`, which calls the native method and so fires
   * nothing unless the element still holds focus. `change` goes with it, because a field
   * that commits on leaving listens for whichever of the two it was written against.
   */
  private async fillAndCommit(field: Locator, text: string): Promise<void>
  {
    await field.fill(text);
    await field.dispatchEvent('change');
    await field.dispatchEvent('blur');
  }

  /**
   * The `FormRow` whose label starts with this.
   *
   * `FormRow` is a `<label class="row">` whose first `<span class="label">` is the words
   * on the left. That is the only stable way to name one field of six.
   */
  rowFor(label: string): Locator
  {
    return this.page
      .locator('label.row')
      .filter({ has: this.page.locator('.label', { hasText: new RegExp(`^\\s*${label}`) }) })
      .first();
  }

  /** Type into the field whose form row carries this label. */
  async setTextByLabel(label: string, text: string): Promise<void>
  {
    await this.fillAndCommit(
      this.rowFor(label).locator('input[type=text], input:not([type]), textarea').first(),
      text
    );
  }

  /**
   * Replace the whole of the dialog's text area.
   *
   * By element rather than by label: the editor's box carries no label, the window's
   * title says which file it is, and it is the only one in the window. `fill` waits for
   * it to be editable, which is also how the step avoids typing into a box still being
   * filled in from disk: that write would land and replace what was typed.
   */
  async setTextArea(text: string): Promise<void>
  {
    await this.page.locator('textarea').first().fill(text);
  }

  /** Wait for an editor dialog to have finished reading its file. */
  async editorReady(): Promise<void>
  {
    await expect(this.page.locator('textarea').first()).toBeEnabled();
  }

  /**
   * Press a control, the way the app's own handlers see it.
   *
   * **A dispatched click, not a real one, and that is deliberate.** A real click has to
   * hit-test: Playwright finds the point, checks what is on top of it, and refuses while
   * anything else is. Every dialog here puts a `.scrim` over its form while a
   * confirmation is up, so the button underneath is visible, enabled and stable and still
   * un-hittable, and the click retries until it times out. The app does not care: its
   * handler is a `@click` on the element, and a bubbling click reaches it.
   *
   * The wait that matters is kept. `toBeEnabled` is a DOM poll, so a button that is
   * disabled until git answers (the ancestor check behind *Move Branch*, the name check
   * behind *Create Branch*) is still waited for rather than pressed into the void: the
   * property the tours' own helpers had, without the hit-test that cannot succeed.
   *
   * Where a *real* click is the thing under test it is still a real click, and says so:
   * the conflict editor's block toolbars, and the grid's modifier-held multi-select.
   *
   * **The disabled check and the dispatch happen in the same turn of the page**, and that
   * is not tidiness. A dispatched click reaches a `@click` handler whether or not the
   * button is disabled: only a real one is stopped by the attribute. So a button that is
   * enabled when Playwright looks and disabled a round trip later is pressed into a
   * handler whose own guard then returns, and the step reads as the app doing nothing at
   * all. Dialogs disable a button while the repository is being re-read, so that gap is
   * open on every press. Asked again until it lands, since a button being briefly
   * disabled is the app working, not failing.
   */
  protected async press(target: Locator, what: string): Promise<void>
  {
    await expect(target, what).toBeEnabled();
    await expect(async () =>
    {
      const landed = await target.evaluate((el) =>
      {
        if (el instanceof HTMLButtonElement && el.disabled)
        {
          return false;
        }
        if (el instanceof HTMLInputElement && el.disabled)
        {
          return false;
        }
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      });
      expect(landed, `${what} was still disabled`).toBe(true);
    }).toPass({ timeout: 8000 });
  }

  /**
   * Click a labelled checkbox or radio by the words beside it.
   *
   * A click and not `check()`: these are toggles, and what a step means is "press this",
   * which is why every setting a spec toggles is pinned in its seed rather than
   * inherited.
   */
  async tick(label: string): Promise<void>
  {
    const box = this.page
      .locator('label')
      .filter({ hasText: label })
      .first()
      .locator('input')
      .first();
    await this.press(box, `a control labelled "${label}"`);
  }

  /**
   * Tick one row of a `FormCheckList`, by the name the row starts with.
   *
   * The rows carry a detail after the name (what a branch is behind by, where a remote
   * points), so this matches the start rather than the whole row: the name is the operand
   * and the rest is why you would pick it.
   */
  async tickInList(name: string): Promise<void>
  {
    const box = this.page
      .locator('.checks label')
      .filter({ hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
      .first()
      .locator('input')
      .first();
    await this.press(box, `a row in the list for "${name}"`);
  }

  /** Click a button by its text: in the dialog, or in a confirmation on top of it. */
  async click(text: string): Promise<void>
  {
    await this.press(this.button(text), `an enabled "${text}" button`);
  }

  button(text: string): Locator
  {
    return this.page.locator('button').filter({ hasText: exactly(text) }).first();
  }

  /** Click whatever element carries this text: a list row, usually. */
  async clickText(text: string): Promise<void>
  {
    const target = this.page.locator('button, .entry').filter({ hasText: text }).first();
    await this.press(target, `something to click carrying "${text}"`);
  }

  /**
   * Unfold a `FormDisclosure`, for a step whose control lives inside one.
   *
   * A dialog opens on its common case, so anything past the common question has to be
   * revealed before it can be driven, which is also the assertion that the fold is there
   * and opens.
   */
  async openAdvanced(label = 'Advanced options'): Promise<void>
  {
    await this.clickText(label);
    await settle(250);
  }

  /**
   * Open one of the settings window's pages.
   *
   * Settings is a list of pages beside a pane, so a row on any page but the first is not
   * in the document at all until its page is picked: every switch a step wants is behind
   * one of these clicks.
   */
  async settingsPage(label: string): Promise<void>
  {
    const heading = this.page.locator('.pane h3');
    if ((await heading.textContent())?.trim() === label)
    {
      return;
    }
    const row = this.page.locator('nav .row').filter({ hasText: exactly(label) }).first();
    await this.press(row, `a settings page called "${label}"`);
    await expect(heading).toHaveText(label);
  }

  /**
   * Pick a row out of a collection dialog's list, by the entry's name alone.
   *
   * Not `clickText`, which matches anywhere in a row's text: the remotes rows carry their
   * URLs, and the fixture's origin *is* a path ending in `-origin`.
   */
  async selectEntry(name: string): Promise<void>
  {
    const entry = this.page
      .locator('.entry')
      .filter({ has: this.page.locator('.title', { hasText: exactly(name) }) })
      .first();
    await this.press(entry, `a list entry named "${name}"`);
  }

  /**
   * Click the list entry whose title *contains* this.
   *
   * The looser sibling of `selectEntry`, for a list whose rows are titled by a subject or
   * by an object kind and a short SHA rather than by a name you can spell exactly.
   */
  async clickEntryContaining(text: string): Promise<void>
  {
    const entry = this.page
      .locator('.list .entry')
      .filter({ has: this.page.locator('.title', { hasText: text }) })
      .first();
    await this.press(entry, `a list entry titled with "${text}"`);
  }

  /**
   * What a Monaco pane is holding, through its model rather than off the screen.
   *
   * Monaco renders only the lines in view, so reading the editor's DOM reports the
   * visible window and nothing below it. The model is the whole document. There is no
   * locator for this: it is the editor's state, not its markup.
   */
  paneText(selector: string): Promise<string>
  {
    return this.page.evaluate((sel) =>
    {
      const container = document.querySelector(sel);
      const editor = (window as unknown as { monaco?: typeof import('monaco-editor') }).monaco
        ?.editor.getEditors()
        .find((e) => container && e.getDomNode() && container.contains(e.getDomNode()!));
      return editor?.getValue() ?? '';
    }, selector);
  }

  /**
   * What the *visible* pane's Monaco editor is holding.
   *
   * A tabbed dialog mounts every pane and hides all but one, so naming the editor by
   * language or by taking the first would read whichever pane happens to come first in
   * the DOM rather than the tab the step just clicked.
   */
  visiblePaneText(): Promise<string>
  {
    return this.paneText('.pane:not(.hidden) .monaco');
  }

  /**
   * Fail if this dialog has outgrown the display.
   *
   * Read from the DOM rather than from the window's size: what matters is whether the
   * *form* fits the room it was given, and the body is the element that would have to
   * scroll for it not to. `data-fixed-height` is `DialogFrame` saying which kind of
   * window this is, and a window whose height is a decision rather than a measurement is
   * exempt from both rules: its body scrolling is what that decision means.
   *
   * Here, at the moment a dialog opens, because opening every dialog is something only
   * this suite does: it is the one place the check can live.
   */
  async expectFits(): Promise<void>
  {
    const first = await this.measureFit();
    if (!first || first.fixed)
    {
      return;
    }
    const title = await this.title();
    // Measured again on every attempt rather than once: a picker that fills itself in
    // from git grows the form a frame or two after it is drawn, and the window that
    // follows it is an IPC round trip behind that. A single reading lands in that gap and
    // reports the gap instead of the form.
    await expect(async () =>
    {
      const fit = await this.measureFit();
      if (!fit)
      {
        return;
      }
      // Two pixels of tolerance on the scroll, the same slack `applyWanted` uses: a
      // fractional line height rounds to a scrollbar that nothing can actually scroll.
      expect(
        fit.past,
        `"${title}" is ${fit.past}px past the bottom of this display, so the form scrolls`
      ).toBeLessThanOrEqual(2);
      expect(
        fit.content,
        `"${title}" is ${fit.content}px of form, ${fit.content - FORM_BUDGET}px over the ${FORM_BUDGET}px budget`
      ).toBeLessThanOrEqual(FORM_BUDGET);
    }).toPass({ timeout: 4000 });
  }

  /** What the form measures right now: whether it is scrolling, and how tall it wants to be. */
  private measureFit(): Promise<Fit | null>
  {
    return this.page
      .evaluate(() =>
      {
        const frame = document.querySelector<HTMLElement>('.frame');
        const body = document.querySelector<HTMLElement>('.body');
        if (!frame || !body)
        {
          return null;
        }
        // The form's own height, which is not `scrollHeight`: that is the content height
        // *or the element's own*, whichever is larger, so a form with room to spare
        // measures the window it is already in. Un-constrained, read, and put back inside
        // one frame, which is what `DialogFrame` does to report it in the first place;
        // its observer recognises writes to the body as measurement and ignores them.
        const style = {
          flex: body.style.flex,
          height: body.style.height,
          overflowY: body.style.overflowY
        };
        body.style.flex = 'none';
        body.style.height = 'auto';
        body.style.overflowY = 'visible';
        const natural = body.offsetHeight;
        body.style.flex = style.flex;
        body.style.height = style.height;
        body.style.overflowY = style.overflowY;
        const chrome =
          (document.querySelector<HTMLElement>('.head')?.offsetHeight ?? 0) +
          (document.querySelector<HTMLElement>('.actions')?.offsetHeight ?? 0);
        return {
          fixed: frame.dataset.fixedHeight === 'true',
          past: body.scrollHeight - body.clientHeight,
          content: natural + chrome
        };
      })
      .catch(() => null);
  }
}
