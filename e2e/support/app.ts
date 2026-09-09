import * as path from 'node:path';
import { _electron as electron, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { WATCH } from './options.js';
import { electronBinary, isNoise, launchArgs, launchEnv } from './platform.mjs';
import { GRID_ROW } from './selectors.js';

/**
 * The repository root: what the app is launched from.
 *
 * `__dirname` rather than `import.meta`: Playwright transpiles a spec's TypeScript to
 * CommonJS, since the project is not an ES module package, so `import.meta` is a syntax
 * error at load time rather than a value.
 */
export const APP_DIR = path.resolve(__dirname, '..', '..');

/** The window a console command streams into, which is not a form. */
const CONSOLE_TITLE = 'Git Output';

/**
 * How often the window-list polls below look again.
 *
 * The lists these watch are held in this process, so a look costs nothing and the
 * interval is pure latency: at 100ms a dialog that opened in 20ms was still reported
 * 60ms late on average, and the suite opens one per step. In node's own timer rather
 * than `page.waitForTimeout`, which is a round trip to a renderer that has no part in
 * the answer.
 */
export const POLL_MS = 15;

/** Wait, without asking a renderer to do it. */
export function pause(ms: number): Promise<void>
{
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The command-palette accelerator, in whichever spelling this platform's menu bar uses. */
export function mod(key: string): string
{
  if (process.platform === 'darwin')
  {
    return `Meta+${key}`;
  }
  return `Control+${key}`;
}

/**
 * The running application: its windows, and the arithmetic of which is which.
 *
 * Deliberately only that. Driving a *form* is `Dialog`, driving the palette, the panel
 * and the grid are their own modules: this one knows how to start the app and how to
 * tell a dialog from a console, and nothing about what any of them contain.
 */
export class GitextApp
{
  /** Everything the renderer complained about, collected across the run. */
  readonly consoleProblems: string[] = [];

  private constructor(
    readonly electronApp: ElectronApplication,
    /** The repository window. There for the whole run, and what every spec starts from. */
    readonly main: Page
  )
  {}

  /**
   * Launch the built app against `userDataDir`, which is where it keeps its settings,
   * its caches and its lock file for this run: see `launchArgs`.
   */
  static async launch(userDataDir: string): Promise<GitextApp>
  {
    const electronApp = await electron.launch({
      executablePath: electronBinary(APP_DIR),
      args: launchArgs(APP_DIR, userDataDir),
      cwd: APP_DIR,
      env: launchEnv(!WATCH),
      timeout: 30_000
    });

    const main = await electronApp.firstWindow();
    const app = new GitextApp(electronApp, main);
    app.watchForProblems(main);

    await main.waitForLoadState('domcontentloaded');
    // The repository loads over IPC after the window mounts, so what says "ready" is the
    // grid having rows, not a guess at how long that takes.
    await expect(main.locator(GRID_ROW).first()).toBeVisible({ timeout: 30_000 });
    return app;
  }

  /** Collect what a window's renderer complains about, minus the known noise. */
  watchForProblems(page: Page): void
  {
    page.on('console', (m) =>
    {
      if ((m.type() === 'error' || m.type() === 'warning') && !isNoise(m.text()))
      {
        this.consoleProblems.push(`${m.type()}: ${m.text()}`);
      }
    });
    page.on('pageerror', (e) => this.consoleProblems.push(`pageerror: ${e.message}`));
  }

  /** Every window that is not the repository window: a dialog, in practice. */
  dialogWindows(): Page[]
  {
    return this.electronApp.windows().filter((w) => w !== this.main && !w.isClosed());
  }

  /**
   * The dialog windows that are *forms*, which is what the closing checks are about.
   *
   * A console standing open is not a form left behind: a command that failed keeps its
   * console up on purpose, since that is when its output is worth reading, and one
   * showing a `--dry-run` listing stays because the listing is the answer. Counting
   * those as stuck windows would make the step that *proves* they stay open fail.
   */
  async formWindows(): Promise<Page[]>
  {
    const windows = this.dialogWindows();
    const titles = await Promise.all(windows.map((w) => w.title().catch(() => null)));
    return windows.filter((_, at) => titles[at] !== CONSOLE_TITLE);
  }

  /**
   * Wait for a window with this title, and hand it back.
   *
   * Matched by window title rather than by DOM content, since a window that has just
   * opened has not painted anything yet. Used for a flow where closing one window hands
   * off to another rather than the same window changing what it shows, and for the
   * windows the app raises *by itself*: waiting for one of those is the assertion.
   */
  async waitForWindow(expectedTitle: string, timeout = 8000): Promise<Page>
  {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline)
    {
      for (const win of this.dialogWindows())
      {
        const title = await win.title().catch(() => null);
        if (title === expectedTitle)
        {
          await win.waitForLoadState('domcontentloaded');
          this.watchForProblems(win);
          return win;
        }
      }
      await pause(POLL_MS);
    }
    const open = await Promise.all(this.dialogWindows().map((w) => w.title().catch(() => '?')));
    throw new Error(`no "${expectedTitle}" window appeared; open: ${open.join(', ') || 'none'}`);
  }

  /**
   * Wait for whatever window a command opened, when the step did not name a title.
   *
   * For the commands whose window title is the thing under test, or is built from the
   * operand rather than fixed. `what` is only ever read in the failure.
   */
  async waitForAnyDialog(timeout = 8000, what = 'a command'): Promise<Page>
  {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline)
    {
      const [dialog] = this.dialogWindows();
      if (dialog)
      {
        await dialog.waitForLoadState('domcontentloaded');
        this.watchForProblems(dialog);
        return dialog;
      }
      await pause(POLL_MS);
    }
    throw new Error(`no dialog opened for "${what}"`);
  }

  /**
   * Fail unless every form has closed, saying which one did not.
   *
   * A dialog that ran its command and then sat there open would otherwise surface as the
   * *next* step being unable to open its own, which is the most misleading place for it
   * to appear.
   */
  async expectFormsClosed(timeout = 8000): Promise<void>
  {
    if (await this.waitFormsClosed(timeout))
    {
      await this.expectGitIdle(timeout);
      return;
    }
    const titles = await Promise.all((await this.formWindows()).map((w) => w.title()));
    throw new Error(`still open after its command ran: ${titles.join(', ')}`);
  }

  /**
   * Wait until no git command is still running.
   *
   * A dialog closes when its work is *accepted*, not when git has finished: a form that
   * runs two commands closes after the first, and a step that reads the repository at
   * that moment sees a repository the second command has not reached. Seventeen steps
   * gated on the form closing and then read git directly, and each of them was a race
   * that only showed up under three workers.
   *
   * The command log is the app's own record of what is in flight, so this asks it rather
   * than guessing at a duration.
   */
  async expectGitIdle(timeout = 8000): Promise<void>
  {
    const deadline = Date.now() + timeout;
    let running: string[] = [];
    while (Date.now() < deadline)
    {
      running = await this.main.evaluate(async () =>
      {
        const log = await window.git['log:list']();
        return log.filter((record) => record.running).map((record) => record.argv.join(' '));
      });
      if (running.length === 0)
      {
        return;
      }
      await pause(POLL_MS);
    }
    throw new Error(`git was still running after ${timeout}ms: ${running.join('; ')}`);
  }

  /** Wait for every *form* to go, and report whether it did. */
  async waitFormsClosed(timeout = 8000): Promise<boolean>
  {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline)
    {
      if ((await this.formWindows()).length === 0)
      {
        return true;
      }
      await pause(POLL_MS);
    }
    return false;
  }

  /** Wait for every dialog to go, console included, and report whether it did. */
  async waitClosed(timeout = 8000): Promise<boolean>
  {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline)
    {
      if (this.dialogWindows().length === 0)
      {
        return true;
      }
      await pause(POLL_MS);
    }
    return false;
  }

  /** Shut whatever is open, for a step whose dialog stays up by design. */
  async closeDialogs(): Promise<void>
  {
    for (const dialog of this.dialogWindows())
    {
      await dialog.close().catch(() =>
      {});
    }
    await this.waitClosed(4000);
  }

  /**
   * Close a command console left standing, and only that.
   *
   * A console outlives the command it watched when that command failed, which is the
   * point of it: a rejected push is a step that *passed* and a window still up. Left
   * there it becomes the next step's stray window. A lingering *form* is not tidied
   * here: that one is a real defect, and the next step failing to open its own dialog is
   * where it should surface.
   */
  async closeConsoles(): Promise<void>
  {
    for (const win of this.dialogWindows())
    {
      const title = await win.title().catch(() => null);
      if (title === CONSOLE_TITLE)
      {
        await win.close().catch(() =>
        {});
      }
    }
  }

  async close(): Promise<void>
  {
    await this.electronApp.close().catch(() =>
    {});
  }
}
