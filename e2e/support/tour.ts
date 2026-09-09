import * as fs from 'node:fs';
import * as path from 'node:path';
import { test as base } from '@playwright/test';
import { REPO_BUILDERS } from '../fixtures/index.js';
import { APP_DIR, GitextApp } from './app.js';
import { KEEP_FIXTURE, SETTLE_SCALE, fixturePath, settleSpent, userDataPath } from './options.js';
import type { TourOptions } from './options.js';
import { Repo } from './repo.js';
import { AppSettings } from './settings.js';

/** What a worker holds for the whole of one spec file: the app, and what it is driving. */
interface Tour
{
  app: GitextApp;
  repo: Repo;
  settings: AppSettings;
}

/**
 * The suite's own `test`, carrying the app and the repository it is driving.
 *
 * Both are **worker-scoped**: one launch and one repository per spec file, because the
 * tests in a file are steps of a sequence that each move that repository. Playwright
 * rebuilds a worker fixture when a worker-scoped option changes value, so declaring a
 * different `tourName` in the next spec is what relaunches the app on a fresh repository
 * rather than inheriting the last one's.
 *
 * The tests are **not** `describe.serial`. A step that fails leaves the repository
 * somewhere unexpected, but most steps build the state they need, so skipping the rest of
 * the file would throw away the answer for forty dialogs to learn about one. Each test
 * tidies up after itself instead, and the ones that genuinely cannot stand alone say so.
 */
export const test = base.extend<
  { app: GitextApp; repo: Repo; settings: AppSettings },
  TourOptions & { tour: Tour }
>({
  tourName: ['tour', { scope: 'worker', option: true }],
  seedSettings: [{}, { scope: 'worker', option: true }],

  tour: [
    async ({ tourName, seedSettings }, use) =>
    {
      if (!fs.existsSync(path.join(APP_DIR, 'out/main/index.js')))
      {
        throw new Error('out/main/index.js is missing: run `npm run build` first.');
      }

      const buildRepo = REPO_BUILDERS[tourName];
      if (!buildRepo)
      {
        throw new Error(`no repository builder named "${tourName}" in e2e/fixtures/index.ts`);
      }
      const dir = fixturePath(tourName);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      buildRepo(dir);

      const userData = userDataPath(tourName);
      fs.rmSync(userData, { recursive: true, force: true });
      const settings = new AppSettings(userData);
      settings.seed(dir, seedSettings);

      const app = await GitextApp.launch(userData);
      await use({ app, repo: new Repo(dir), settings });

      await app.close();
      settings.discard();
      if (process.env.GITEXT_SETTLE_REPORT === '1')
      {
        console.log(
          `\n${tourName}: ${(settleSpent.ms / 1000).toFixed(1)}s spent in settle() ` +
            `at scale ${SETTLE_SCALE}`
        );
      }
      settleSpent.ms = 0;
      if (app.consoleProblems.length > 0)
      {
        console.log(`\n${app.consoleProblems.length} renderer console problem(s):`);
        for (const problem of app.consoleProblems.slice(0, 10))
        {
          console.log(`  ${problem}`);
        }
      }
      if (KEEP_FIXTURE)
      {
        console.log(`\nfixture kept at ${dir}`);
      }
      else
      {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    { scope: 'worker' }
  ],

  app: async ({ tour }, use) =>
  {
    await use(tour.app);
    // A console the step left standing (its command failed, which the step expected) is
    // not the next step's problem: a rejected push is a step that *passed* and a window
    // still up. A lingering *form* is a real defect and is deliberately left, so the next
    // step's `openViaPalette` names it.
    await tour.app.closeConsoles();
  },

  repo: async ({ tour }, use) =>
  {
    await use(tour.repo);
  },

  /** This run's own settings file, for a step that asserts on what the app wrote to it. */
  settings: async ({ tour }, use) =>
  {
    await use(tour.settings);
  }
});

export { expect } from '@playwright/test';
