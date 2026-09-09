import * as os from 'node:os';
import * as path from 'node:path';

/** How a spec says which repository and which settings its app should start from. */
export interface TourOptions
{
  /**
   * The tour this file is.
   *
   * It names the fixture directory, picks the repository builder out of
   * `e2e/fixtures/index.ts`, and is what the worker fixture keys on: so moving from one
   * spec to the next relaunches the app on a fresh repository rather than inheriting the
   * last one's.
   */
  tourName: string;
  /**
   * Settings pinned into the app's real config file for the run, and put back after.
   *
   * A step that passes because a checkbox happened to be ticked proves nothing, so
   * every setting a spec's dialogs open from is pinned rather than inherited.
   */
  seedSettings: Record<string, unknown>;
}

/** Keep the fixture repository (and say where it is) instead of deleting it. */
export const KEEP_FIXTURE = process.env.GITEXT_KEEP_FIXTURE === '1';

/**
 * Show the windows.
 *
 * Off by default, like the run-app driver. A spec opens dozens of windows, and on macOS
 * showing a window activates the application: so a run that took the front took it back
 * roughly once a second, over whatever the person at the machine was actually doing.
 * Playwright talks to the renderer rather than to the window server, so everything works
 * either way.
 */
export const WATCH = process.env.GITEXT_WATCH === '1';

/**
 * How much of each catch-up pause to actually take.
 *
 * Almost every wait in the suite is a locator assertion, which takes exactly as long as
 * it needs. What is left is the handful of moments with nothing observable to watch, and
 * those are scaled down. `GITEXT_SLOW=1` puts them back to their written value, which is
 * the first thing to try when a step is flaky and the question is whether it is a race.
 */
export const SETTLE_SCALE = ((): number =>
{
  const asked = process.env.GITEXT_SETTLE_SCALE;
  if (asked !== undefined && asked !== '')
  {
    return Number(asked);
  }
  if (process.env.GITEXT_SLOW === '1')
  {
    return 1;
  }
  return 0.35;
})();

/**
 * How long has been spent asleep in `settle`.
 *
 * Reported per spec with `GITEXT_SETTLE_REPORT=1`, which is how to tell a suite that is
 * slow because the app is slow from one that is slow because it is sleeping. It was 59s
 * of a 122s run once; most of those pauses had an observable condition underneath them
 * and are now waits on it. `GITEXT_SETTLE_SCALE=0` shows what is left holding the run up.
 */
export const settleSpent = { ms: 0 };

/** Where a spec's fixture repository is built. */
export function fixturePath(tourName: string): string
{
  return path.join(os.tmpdir(), `gitext-e2e-${tourName}-${process.pid}`);
}

/**
 * Where a spec's app keeps everything it would otherwise keep in the machine's own
 * application-support directory: its settings, its caches, its lock file.
 *
 * Named after the spec and the worker running it, because that is what has to be unique:
 * two spec files run beside each other, and two apps sharing one of these fight over the
 * lock rather than starting.
 */
export function userDataPath(tourName: string): string
{
  return path.join(os.tmpdir(), `gitext-e2e-config-${tourName}-${process.pid}`);
}

/** A catch-up pause: the last resort, for a moment with nothing observable to wait for. */
export function settle(ms: number): Promise<void>
{
  const waited = Math.round(ms * SETTLE_SCALE);
  settleSpent.ms += waited;
  return new Promise((resolve) => setTimeout(resolve, waited));
}
