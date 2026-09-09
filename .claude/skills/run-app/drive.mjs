/**
 * Launch gitext and drive it, in one process.
 *
 * A one-shot runner rather than a REPL: this machine has no `tmux`, so there is nothing
 * to keep an interactive driver alive between calls. Each run launches the app, performs
 * the commands given on the command line in order, prints what it saw, and quits.
 *
 * See SKILL.md for usage. Where the app's settings live, which Electron binary to run
 * and what a launch has to fix in the environment are all `e2e/support/platform.mts`:
 * the `e2e/` suite launches the same app and needs the same answers, and the trap that
 * costs an hour if it is got wrong (`ELECTRON_RUN_AS_NODE`) is written down there once.
 *
 * `playwright-core` resolves from the project's own `node_modules`: `@playwright/test`,
 * which `e2e/` runs on, depends on it. `PLAYWRIGHT_CORE` points elsewhere for a checkout
 * whose dependencies are not installed.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '../../..');

const { configPath, electronBinary, isNoise, launchEnv } = await import(
  path.join(APP_DIR, 'e2e/support/platform.mts')
);

const { _electron: electron } = await import(
  process.env.PLAYWRIGHT_CORE ?? 'playwright-core'
);

// ── Arguments ────────────────────────────────────────────────────────────────

const USAGE = `node .claude/skills/run-app/drive.mjs [options] "<command>"...

Options
  --repo <path>     repository to open (default: this project)
  --theme <t>       light | dark | system
  --shots <dir>     where screenshots go (default: <tmp>/gitext-shots)
  --settle <ms>     wait after load before the first command (default 6000)
  --keep-config     do not restore config.json afterwards
  --focus           let the app come to the front (default: it opens without taking
                    focus, so a run does not interrupt what you were doing)

Commands, run in order
  shot <name>       screenshot to <shots>/<name>.png
  panel             print the left panel's rows
  menu              print every open menu's rows, with [x]/[ ] checked state
  click <sel>       left-click
  rclick <sel>      right-click (opens a context menu)
  hover <sel>       hover, then settle (opens a submenu)
  clicktext <text>  click a menu row / button by its text
  key <Key>         press a key, e.g. Escape, ArrowDown, Enter
  type <text>       type text
  focus <sel>       focus an element
  wait <sel>        wait for a selector, 8s
  sleep <ms>        wait
  text <sel>        print innerText of a selector (blank for the whole body)
  config            print the settings file
  eval <js>         evaluate in the page, print as JSON
  evalmain <js>     evaluate in the MAIN process, print as JSON: BrowserWindow, screen
                    and Menu are in scope: window bounds, and the native menu bar, which
                    Playwright cannot click (Menu items expose click() from here)
  windows           list every open window (index, title, URL); marks the current one
  win <n|name>      drive window n, or the first whose title/URL contains name
  waitwin [ms]      wait for a new window to open and switch to it (default 5000)`;

const argv = process.argv.slice(2);
const options = {
  repo: APP_DIR,
  theme: null,
  shots: path.join(os.tmpdir(), 'gitext-shots'),
  settle: 6000,
  keepConfig: false,
  /**
   * Stay out of the foreground, which is the default.
   *
   * A driven run is a check, and a check that steals the screen interrupts whatever the
   * person at the keyboard was doing: on macOS it bounces the Dock, takes focus, and
   * switches Spaces away from a full-screen window. Every command here goes through the
   * DevTools protocol, which does not need the window focused, so there is nothing to
   * trade away. `--focus` when you actually want to watch or take over.
   */
  background: true
};
const commands = [];

for (let i = 0; i < argv.length; i++)
{
  const arg = argv[i];
  if (arg === '--repo')
  {
    options.repo = path.resolve(argv[++i]);
  }
  else if (arg === '--theme')
  {
    options.theme = argv[++i];
  }
  else if (arg === '--shots')
  {
    options.shots = path.resolve(argv[++i]);
  }
  else if (arg === '--settle')
  {
    options.settle = Number(argv[++i]);
  }
  else if (arg === '--keep-config')
  {
    options.keepConfig = true;
  }
  else if (arg === '--focus')
  {
    options.background = false;
  }
  else if (arg === '--help' || arg === '-h')
  {
    console.log(USAGE);
    process.exit(0);
  }
  else
  {
    commands.push(arg);
  }
}

fs.mkdirSync(options.shots, { recursive: true });

// ── Settings file ────────────────────────────────────────────────────────────

const CONFIG = configPath();
let original;
if (fs.existsSync(CONFIG))
{
  original = fs.readFileSync(CONFIG, 'utf8');
}
else
{
  original = null;
}

/**
 * Point the app at the repository under test.
 *
 * There is no command-line flag for it: the app opens `recentRepos[0]` on startup, so
 * the settings file is the way in. Restored on exit unless `--keep-config`, because it
 * is the developer's real settings file and not a fixture.
 */
function seedConfig()
{
  let config;
  if (original)
  {
    config = JSON.parse(original);
  }
  else
  {
    config = {};
  }
  config.recentRepos = [options.repo, ...(config.recentRepos ?? []).filter((p) => p !== options.repo)];
  if (options.theme)
  {
    config.theme = options.theme;
  }
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));
}

function restoreConfig()
{
  if (options.keepConfig)
  {
    return;
  }
  if (original === null)
  {
    fs.rmSync(CONFIG, { force: true });
  }
  else
  {
    fs.writeFileSync(CONFIG, original);
  }
}

/**
 * Put the settings back when the run ends without reaching the restore below.
 *
 * Ctrl-C kills the process where it stands, and the file left behind is the developer's
 * real one: a driver that dies mid-run leaves the app opening whatever repository this
 * run chose, in whatever theme it asked for. `e2e/support/settings.ts` restores on a
 * signal handler for the same reason, against the same file.
 */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
{
  process.on(signal, () =>
  {
    restoreConfig();
    process.exit(130);
  });
}

// ── Launch ───────────────────────────────────────────────────────────────────

if (!fs.existsSync(path.join(APP_DIR, 'out/main/index.js')))
{
  console.error('out/main/index.js is missing: run `npm run build` first.');
  process.exit(1);
}

seedConfig();

// `GITEXT_BACKGROUND` goes in the environment and not in `args`, because `args` is where
// the repository path goes and the app parses that.
const app = await electron.launch({
  executablePath: electronBinary(APP_DIR),
  args: [APP_DIR],
  cwd: APP_DIR,
  env: launchEnv(options.background),
  timeout: 30_000
});

/**
 * The window commands are sent to.
 *
 * Every operation dialog is its own `BrowserWindow` now, so "the page" is a choice
 * rather than a fact. `page` starts as the repository window and moves with `win` /
 * `waitwin`; everything below reads it through `page()` so a switch takes effect for the
 * commands that follow.
 */
let current = await app.firstWindow();
const page = () => current;

// Collected all along and reported at the end: a Vue warning or a rejected IPC call is
// the usual explanation for a screenshot that looks wrong, and it scrolls past unseen
// otherwise. Attached per window, including dialog windows as they open: a dialog that
// throws on mount is exactly the failure this catches.
const problems = [];
const watched = new WeakSet();

function watch(target)
{
  if (watched.has(target))
  {
    return target;
  }
  watched.add(target);
  target.on('console', (message) =>
  {
    if ((message.type() === 'error' || message.type() === 'warning') && !isNoise(message.text()))
    {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  target.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return target;
}

watch(current);
app.on('window', (win) => watch(win));

/** One line per window: `* 0  gitext  file:///…/index.html`. */
async function describeWindows()
{
  const windows = app.windows();
  const rows = [];
  for (const [index, win] of windows.entries())
  {
    const title = await win.title().catch(() => '(gone)');
    let marker;
    if (win === current)
    {
      marker = '*';
    }
    else
    {
      marker = ' ';
    }
    rows.push(`${marker} ${index}  ${title}  ${win.url()}`);
  }
  return rows.join('\n');
}

await current.waitForLoadState('domcontentloaded');
// No "ready" signal to wait on: the repository loads over IPC after mount, and the
// panel and grid fill in as git answers. This is long enough for both on a real repo.
await new Promise((r) => setTimeout(r, options.settle));

// ── Commands ─────────────────────────────────────────────────────────────────

/** A menu's rows with their checked state: `[x]`, `[ ]`, or blank for a plain row. */
const MENU_DUMP = `[...document.querySelectorAll('.menu')].map((m, i) =>
  'menu ' + i + ':\\n' + [...m.querySelectorAll(':scope > .row')].map((r) => {
    const c = r.getAttribute('aria-checked');
    return '  ' + (c === null ? '   ' : c === 'true' ? '[x]' : '[ ]') + ' ' +
      r.innerText.replace(/\\n/g, ' ').trim();
  }).join('\\n')).join('\\n')`;

const PANEL_DUMP = `[...document.querySelectorAll('.left-panel .row')].map((r) =>
  '  ' + (r.className.includes('section') ? '' : '  ') +
  r.innerText.replace(/\\n/g, ' ').trim()).join('\\n')`;

const handlers = {
  async windows()
  {
    console.log('--- windows ---');
    console.log(await describeWindows());
  },
  /** Point the following commands at another window, by index or by a title/URL match. */
  async win(which)
  {
    const windows = app.windows();
    let byIndex;
    if (/^\d+$/.test(which.trim()))
    {
      byIndex = windows[Number(which.trim())];
    }
    else
    {
      byIndex = null;
    }
    const target =
      byIndex ??
      (await (async () =>
      {
        for (const win of windows)
        {
          const title = await win.title().catch(() => '');
          if (title.includes(which) || win.url().includes(which))
          {
            return win;
          }
        }
        return null;
      })());
    if (!target)
    {
      console.log('NO SUCH WINDOW:', which);
      console.log(await describeWindows());
      process.exitCode = 1;
      return;
    }
    current = watch(target);
    console.log('driving:', await current.title(), current.url());
  },
  /**
   * Wait for the next window to open, and drive it.
   *
   * How a dialog is reached: run the command that opens it, then `waitwin`. A dialog
   * window is a separate renderer process, so nothing in the repository window's DOM
   * ever shows it: waiting on a selector there would time out with the dialog open and
   * on screen in front of you.
   */
  async waitwin(ms)
  {
    const before = new Set(app.windows());
    const deadline = Date.now() + (Number(ms) || 5000);
    while (Date.now() < deadline)
    {
      const opened = app.windows().find((win) => !before.has(win));
      if (opened)
      {
        current = watch(opened);
        await current.waitForLoadState('domcontentloaded');
        // The dialog loads its settings and adopts the repository before it renders.
        await new Promise((r) => setTimeout(r, 1200));
        console.log('new window:', await current.title(), current.url());
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    console.log('TIMEOUT: no new window opened');
    process.exitCode = 1;
  },
  async shot(name)
  {
    const file = path.join(options.shots, `${name || Date.now()}.png`);
    await page().screenshot({ path: file });
    console.log('screenshot:', file);
  },
  async click(sel)
  {
    await page().click(sel, { timeout: 5000 });
  },
  async rclick(sel)
  {
    await page().click(sel, { button: 'right', timeout: 5000 });
  },
  async hover(sel)
  {
    await page().hover(sel, { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 500));
  },
  /**
   * Click a row by its text.
   *
   * Menu rows have no ids and their labels come from the command registry, so text is
   * the only stable handle. A DOM click rather than a coordinate one: submenus are
   * `position: fixed` and layered, and Playwright's hit-testing picks the wrong layer.
   */
  async clicktext(text)
  {
    const result = await page().evaluate((needle) =>
    {
      const rows = [...document.querySelectorAll('.menu .row, button, a, [role="button"]')];
      const el =
        rows.find((r) => r.innerText?.trim() === needle) ??
        rows.find((r) => r.innerText?.includes(needle));
      if (!el)
      {
        return 'NOT_FOUND';
      }
      el.click();
      return 'OK';
    }, text);
    console.log('clicktext', JSON.stringify(text), '→', result);
    if (result === 'NOT_FOUND')
    {
      process.exitCode = 1;
    }
  },
  async key(name)
  {
    await page().keyboard.press(name);
  },
  async type(text)
  {
    await page().keyboard.type(text, { delay: 30 });
  },
  async focus(sel)
  {
    await page().evaluate((s) => document.querySelector(s)?.focus(), sel);
  },
  async wait(sel)
  {
    try
    {
      await page().waitForSelector(sel, { timeout: 8000 });
      console.log('found:', sel);
    }
    catch
    {
      console.log('TIMEOUT:', sel);
      process.exitCode = 1;
    }
  },
  async sleep(ms)
  {
    await new Promise((r) => setTimeout(r, Number(ms) || 500));
  },
  async text(sel)
  {
    console.log(
      await page().evaluate((s) =>
      {
        let el;
        if (s)
        {
          el = document.querySelector(s);
        }
        else
        {
          el = document.body;
        }
        return el?.innerText ?? '(no match)';
      }, sel || null)
    );
  },
  async panel()
  {
    console.log('--- left panel ---');
    console.log(await page().evaluate(PANEL_DUMP));
  },
  async menu()
  {
    console.log('--- open menus ---');
    console.log((await page().evaluate(MENU_DUMP)) || '(none open)');
  },
  async config()
  {
    console.log('--- config.json ---');
    console.log(fs.readFileSync(CONFIG, 'utf8'));
  },
  /**
   * Evaluate an expression in the main process.
   *
   * The only way to see what a *window* is doing rather than what a page contains:
   * bounds, title, parentage. Dialogs are windows, and "did it reopen where it was
   * left?" is a question the DOM cannot answer.
   */
  async evalmain(expr)
  {
    try
    {
      const result = await app.evaluate(
        ({ BrowserWindow, screen, Menu }, source) =>
          Function('BrowserWindow', 'screen', 'Menu', `return (${source});`)(
            BrowserWindow,
            screen,
            Menu
          ),
        expr
      );
      console.log(JSON.stringify(result));
    }
    catch (err)
    {
      console.log('ERROR:', err.message);
      process.exitCode = 1;
    }
  },
  async eval(expr)
  {
    try
    {
      console.log(JSON.stringify(await page().evaluate(expr)));
    }
    catch (err)
    {
      console.log('ERROR:', err.message);
      process.exitCode = 1;
    }
  }
};

let failed = false;
try
{
  for (const line of commands)
  {
    const space = line.indexOf(' ');
    let name;
    if (space === -1)
    {
      name = line;
    }
    else
    {
      name = line.slice(0, space);
    }
    let arg;
    if (space === -1)
    {
      arg = '';
    }
    else
    {
      arg = line.slice(space + 1);
    }
    const handler = handlers[name];
    if (!handler)
    {
      console.log('unknown command:', name, ', known:', Object.keys(handlers).join(', '));
      failed = true;
      break;
    }
    console.log(`> ${line}`);
    try
    {
      await handler(arg);
    }
    catch (err)
    {
      console.log('ERROR:', err.message);
      // A shot of the failure is worth more than the stack: it shows what was on screen.
      await page().screenshot({ path: path.join(options.shots, 'error.png') }).catch(() =>
      {});
      console.log('screenshot:', path.join(options.shots, 'error.png'));
      failed = true;
      break;
    }
  }

  if (problems.length > 0)
  {
    console.log('--- renderer console ---');
    for (const problem of problems)
    {
      console.log(' ', problem);
    }
  }
}
finally
{
  // The settings file goes back whatever happened above: it is the developer's own.
  await app.close().catch(() =>
  {});
  restoreConfig();
}
if (failed)
{
  process.exitCode = 1;
}
