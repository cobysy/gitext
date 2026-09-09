/**
 * The facts about running this app that both drivers need.
 *
 * Two things launch the built app: the `e2e/` suite under Playwright's runner, and
 * `.claude/skills/run-app/drive.mjs`, which is the ad-hoc one-shot version of the same
 * idea. Where the app keeps its settings, where Electron's binary sits and which
 * environment variables a launch has to fix are properties of the *app*, identical for
 * both, and were written out twice until they drifted.
 *
 * `.mts` because one caller is an ES module run by plain `node` and the other is
 * TypeScript compiled by Playwright: the explicit extension settles the module type for
 * both, where a bare `.ts` is guessed at and warned about.
 *
 * Nothing here reaches for the repository root on its own: the two callers find it by
 * different means (`import.meta.dirname` against `__dirname`, since Playwright compiles a
 * spec to CommonJS), so it is a parameter rather than a third opinion.
 */

import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Whether a renderer console message is worth reporting at all.
 *
 * The CSP warning is Electron's own, about the `unsafe-eval` Monaco needs, and it appears
 * on every launch of every window. Reported, it is the first thing in every summary and
 * trains the reader to skim past the ones that matter.
 */
export function isNoise(text: string): boolean
{
  return text.includes('Security Warning');
}

/**
 * Where the app keeps its settings.
 *
 * `userDataDir` is a run that has been given a directory of its own, through the
 * `--user-data-dir` switch `launchArgs` adds: Electron reports exactly that as
 * `app.getPath('userData')`, so its `config.json` is in there. Without one this is the
 * machine's real settings file, which is what the ad-hoc driver wants.
 */
export function configPath(userDataDir?: string): string
{
  const name = 'gitext';
  if (userDataDir !== undefined)
  {
    return path.join(userDataDir, 'config.json');
  }
  if (process.platform === 'darwin')
  {
    return path.join(os.homedir(), 'Library/Application Support', name, 'config.json');
  }
  if (process.platform === 'win32')
  {
    return path.join(process.env.APPDATA ?? os.homedir(), name, 'config.json');
  }
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
    name,
    'config.json'
  );
}

/**
 * What to launch the app with: the app itself, and where it should keep its state.
 *
 * A run given its own `--user-data-dir` writes its settings, its caches and its lock file
 * somewhere of its own, which is two things at once: the machine's real configuration is
 * never touched, and two runs can be in flight at the same time without fighting over one
 * directory. Without it the app is launched the way a person launches it.
 */
export function launchArgs(appDir: string, userDataDir?: string): string[]
{
  if (userDataDir === undefined)
  {
    return [appDir];
  }
  return [appDir, `--user-data-dir=${userDataDir}`];
}

/** The Electron binary to launch, inside the project's own `node_modules`. */
export function electronBinary(appDir: string): string
{
  if (process.platform === 'darwin')
  {
    return path.join(appDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  }
  return path.join(appDir, 'node_modules/electron/dist/electron.exe');
}

/**
 * The environment a launch needs, which is this one with two corrections.
 *
 * `ELECTRON_RUN_AS_NODE` is exported by the editor's integrated terminal, and Electron
 * inheriting it runs as a bare Node binary: no `app`, no window, and a death on
 * `app.whenReady` that Playwright reports only as `Process failed to launch!`. It is
 * deleted from this process too, since Playwright reads the parent environment for
 * anything the returned record does not name.
 *
 * `GITEXT_BACKGROUND` is read by `main/background.ts` before the first window exists: a
 * hidden Dock icon, and windows built but shown with `showInactive`. A driven run is a
 * check, and a check that takes the screen interrupts whoever is at the keyboard.
 */
export function launchEnv(background: boolean): Record<string, string>
{
  delete process.env.ELECTRON_RUN_AS_NODE;

  // Playwright wants every value defined, and `process.env` is typed as though any of
  // them might not be.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
  {
    if (value !== undefined)
    {
      env[key] = value;
    }
  }
  if (background)
  {
    env.GITEXT_BACKGROUND = '1';
  }
  return env;
}
