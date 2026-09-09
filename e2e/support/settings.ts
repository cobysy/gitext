import * as fs from 'node:fs';
import * as path from 'node:path';
import { configPath } from './platform.mjs';

/**
 * The panes the repository window has to be drawing for any spec to see anything.
 *
 * Every one of these is a real preference with a View toggle and a ✕ of its own, so a
 * machine whose config has one switched off is not misconfigured: it is a person who
 * closed a pane. But a spec that inherits that finds no file list, and reports it as the
 * step's own failure, several assertions later and nowhere near the cause.
 *
 * Here rather than in each spec's `seedSettings` because every spec drives this one
 * window: what a *spec* pins is what its own dialogs open from.
 */
const PANES_OPEN = {
  showLeftPanel: true,
  showCommitDetails: true,
  showFilePane: true
};

/**
 * The settings file of one run, in a directory belonging to that run alone.
 *
 * The app is launched with `--user-data-dir`, so this *is* the settings file it reads:
 * nothing here is inherited from the machine and nothing here outlives the run. That is
 * what lets spec files run beside each other, and it is why there is no restore: the
 * developer's own configuration was never opened.
 */
export class AppSettings
{
  private readonly file: string;

  constructor(private readonly userDataDir: string)
  {
    this.file = configPath(userDataDir);
  }

  /** Point the app at the fixture, and pin every setting this spec's dialogs open from. */
  seed(fixture: string, seedSettings: Record<string, unknown>): void
  {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(
      this.file,
      JSON.stringify(
        {
          recentRepos: [fixture],
          theme: 'dark',
          dialogBounds: null,
          confirmSuppressions: null,
          ...PANES_OPEN,
          ...seedSettings
        },
        null,
        2
      )
    );
  }

  /** Throw the whole directory away: the settings, and the caches beside them. */
  discard(): void
  {
    fs.rmSync(this.userDataDir, { recursive: true, force: true });
  }

  /** What the app has actually written to its settings file. */
  read<T>(key: string): T | undefined
  {
    if (!fs.existsSync(this.file))
    {
      return undefined;
    }
    return (JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, T>)[key];
  }
}
