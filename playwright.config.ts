import * as os from 'node:os';
import * as path from 'node:path';
import { defineConfig } from '@playwright/test';
import type { TourOptions } from './e2e/support/options.js';

/** Recorded only when asked for: see the note on `use.trace` below. */
const TRACE = ((): 'on' | 'off' =>
{
  if (process.env.GITEXT_TRACE === '1')
  {
    return 'on';
  }
  return 'off';
})();

/**
 * The end-to-end suite: the built app, launched under Electron, driven the way a person
 * drives it.
 *
 * These runs are what the unit tests structurally cannot reach. A dialog is a separate
 * window with a store of its own, opened by a message to the main process and filled in
 * from a payload, so everything between "the menu row was clicked" and "git ran" only
 * shows up when it is driven. The same is true of the commit screen, which is a window
 * too, and of the conflict resolver, which one command raises on another window's behalf.
 *
 * Three rules the whole suite follows:
 *
 * - **Drive real entry points.** The command palette resolves through the same registry
 *   every menu does. Never a URL.
 * - **Assert against git, not the screen.** A dialog that has gone wrong will happily
 *   close as though it worked, so every assertion reads the repository back with the
 *   `git` CLI.
 * - **Wait on conditions, not the clock.** Locators do this for free: `expect(locator)`
 *   retries until its timeout. `settle()` is the handful of moments with nothing
 *   observable to watch, and is the last resort rather than the default.
 *
 * Each spec drives one subject against one fixture repository, and its tests run in
 * order: they share a repository that each of them moves. `fullyParallel` is off and
 * there is one worker for exactly that reason.
 */
export default defineConfig<TourOptions>({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',

  /*
   * A file's steps run in order; the files run beside each other.
   *
   * `fullyParallel: false` is the part that matters: the tests in a file are steps of a
   * sequence and share a repository each of them moves, so they cannot be reordered,
   * retried in isolation, or run beside each other. Nothing about that applies *between*
   * files. Each has its own fixture repository and its own app, and since that app is
   * launched with a `--user-data-dir` of its own (`launchArgs`) it has its own settings
   * and its own lock file too: there is nothing left for two of them to share.
   *
   * Three, and not one per file. Each app is a main process, a renderer, a GPU process
   * and a utility process, and it is driving real git underneath: five at once on a
   * ten-core machine starved each other badly enough that steps which had never failed
   * began timing out, and the run got *longer*. Three is what leaves each of them enough
   * of the machine to answer in the time the suite allows.
   *
   * Five files rather than three is still what makes this worth anything: as one file the
   * dialog steps were 45 of the 75 and 52s of a 90s run, and no number of workers can
   * divide a file.
   */
  fullyParallel: false,
  workers: 3,
  retries: 0,

  // Long by the standards of a web suite, and it has to be: a step launches nothing but
  // it does drive real git through a real UI, and `git gc` or a clone is seconds on its
  // own. `GITEXT_SLOW=1` takes every catch-up pause in full, for chasing a race.
  /*
   * 8s everywhere, which is what the tours' own `until` waited.
   *
   * Long enough for git to answer through two IPC hops, short enough that a genuine
   * failure reports rather than sits. Every wait here is a condition poll, so a passing
   * run never spends any of it: the whole suite passes in about the time the slowest
   * dozen steps take.
   *
   * `actionTimeout` matters as much as `expect`: it defaults to 30s, and a click that
   * cannot land (a button under a modal scrim, say) spends every second of it before
   * saying so. The step timeout is the outer bound for a whole step, and the slowest real
   * one here is about 13s.
   */
  timeout: 45_000,
  expect: { timeout: 8_000 },

  // `forbidOnly` in CI only: `.only` is how you run one step while writing it.
  forbidOnly: Boolean(process.env.CI),

  outputDir: path.join(os.tmpdir(), 'gitext-e2e'),

  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(os.tmpdir(), 'gitext-e2e-report'), open: 'never' }]
  ],

  use: {
    actionTimeout: 8_000,
    /*
     * Tracing is **off** unless asked for, and that is a performance decision.
     *
     * `retain-on-failure` sounds free and is not: Playwright has to record every test to
     * be able to keep the failures, and a trace is a DOM snapshot plus a screenshot per
     * action. Against an Electron renderer holding Monaco that is the single most
     * expensive thing in the run. `GITEXT_TRACE=1` turns it on for the run you are
     * actually debugging, which is the only run that wants it.
     */
    trace: TRACE,
    screenshot: 'only-on-failure'
  }
});
