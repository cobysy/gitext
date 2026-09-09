import { expect } from '@playwright/test';
import type { GitextApp } from './app.js';
import { Dialog } from './dialog.js';

/**
 * The window a long or remote command streams into.
 *
 * Its own class because what a step wants from it is different from a form: not a field
 * to fill in but git's own words, and whether the window is still there. A console that
 * outlives its command is the behaviour rather than a stuck window: a failed command
 * keeps it up because that is when its output is worth reading, and a `--dry-run` listing
 * stays because the listing is the answer.
 */
export class GitConsole extends Dialog
{
  /** Wait for the console's output to carry this text, and fail naming what was wanted. */
  async expectOutput(text: string): Promise<void>
  {
    await expect(
      this.page.locator('.output'),
      `the console to report "${text}"`
    ).toContainText(text);
  }

  /**
   * Stop the console closing itself, and wait until it has stopped.
   *
   * A console whose command succeeded counts down, and the count sits **on the button
   * that does the closing**: `Close (4)`. So while it is running there is no button
   * reading exactly `Close`, and a step waiting for one waits for a label that only comes
   * back once the countdown is over, on a window that is leaving. Keep Open is what stops
   * it, and is what a reader presses when they want to go on reading.
   */
  async keepOpen(): Promise<void>
  {
    await this.click('Keep Open');
    await expect(this.button('Close'), 'the countdown to stop').toBeEnabled();
  }

  async dismiss(): Promise<void>
  {
    await this.page.close().catch(() =>
    {});
  }
}

/** Wait for the console window a command raised. */
export async function waitForConsole(app: GitextApp, timeout = 12_000): Promise<GitConsole>
{
  return new GitConsole(await app.waitForWindow('Git Output', timeout));
}
