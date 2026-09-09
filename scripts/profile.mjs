/**
 * CPU-profile the renderer while it does one named thing.
 *
 * The diagnostics timeline times whole operations, and that is most of what a report
 * needs. What it cannot see is a cost paid *per frame*: `formatAbsoluteDate` was 44us
 * called forty times a render, which is 189ms of a scroll and not one entry anywhere.
 * That gap is inherent, so the answer is not more logging but a profiler anyone can point
 * at a scenario in one command:
 *
 *     npm run profile -- --repo ../some-big-repo --scenario scroll
 *     npm run profile -- --list
 *
 * Adding a scenario is adding an entry to `SCENARIOS`, never a branch in the runner.
 *
 * The traps here are the same three `run-app` documents, and for the same reasons:
 * `ELECTRON_RUN_AS_NODE` is exported by the editor's terminal and makes Electron run as
 * bare Node; `playwright-core` must stay out of `package.json`; and the app is launched
 * in the background so a profiling run never steals the screen.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

delete process.env.ELECTRON_RUN_AS_NODE;

const APP_DIR = path.resolve(import.meta.dirname, '..');

/** Sampling interval in microseconds. Fine enough to separate two functions in a frame. */
const SAMPLE_US = 150;

/** Self time under this is noise rather than a finding. */
const MIN_MS = 3;

/**
 * What each scenario does, as a function run *inside the page*. Each returns whatever is
 * worth printing beside the profile: how far it scrolled, how many rows it touched.
 */
const SCENARIOS = {
  open: {
    what: 'nothing: profiles the tail of startup, once the window is up',
    run: async () =>
    {
      await new Promise((r) => setTimeout(r, 2000));
      const scroller = document.querySelector('.grid .scroller');
      if (!scroller)
      {
        return { rows: 0 };
      }
      return { rows: Math.round(scroller.scrollHeight / 24) };
    }
  },
  scroll: {
    what: 'scrolls the revision grid a long way, a frame at a time',
    run: async () =>
    {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const scroller = document.querySelector('.grid .scroller');
      if (!scroller)
      {
        return { error: 'no grid' };
      }
      const started = performance.now();
      for (let i = 0; i < 60; i++)
      {
        scroller.scrollTop += 50 * 24;
        await sleep(16);
      }
      await sleep(600);
      return { ms: Math.round(performance.now() - started), scrollTop: scroller.scrollTop };
    }
  },
  keyboard: {
    what: 'walks the selection down the grid with the arrow keys',
    run: async () =>
    {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const scroller = document.querySelector('.grid .scroller');
      scroller?.focus();
      const started = performance.now();
      for (let i = 0; i < 30; i++)
      {
        scroller?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        await sleep(40);
      }
      await sleep(800);
      return { ms: Math.round(performance.now() - started) };
    }
  },
  relayout: {
    what: 'toggles a graph setting, which lays the whole history out again',
    run: async () =>
    {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const started = performance.now();
      await window.git['settings:patch']({ graphRenderDiagonals: false });
      await sleep(2500);
      await window.git['settings:patch']({ graphRenderDiagonals: true });
      await sleep(2500);
      return { ms: Math.round(performance.now() - started) };
    }
  }
};

// ── Arguments ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const options = { repo: APP_DIR, scenario: 'scroll', settle: 13000, top: 15 };

for (let i = 0; i < argv.length; i++)
{
  const arg = argv[i];
  if (arg === '--repo')
  {
    options.repo = path.resolve(argv[++i]);
  }
  else if (arg === '--scenario')
  {
    options.scenario = argv[++i];
  }
  else if (arg === '--settle')
  {
    options.settle = Number(argv[++i]);
  }
  else if (arg === '--top')
  {
    options.top = Number(argv[++i]);
  }
  else if (arg === '--list')
  {
    for (const [name, spec] of Object.entries(SCENARIOS))
    {
      console.log(`  ${name.padEnd(10)} ${spec.what}`);
    }
    process.exit(0);
  }
  else
  {
    console.error(`Unknown argument: ${arg}`);
    process.exit(1);
  }
}

const scenario = SCENARIOS[options.scenario];
if (!scenario)
{
  console.error(`No scenario "${options.scenario}". Try --list.`);
  process.exit(1);
}

// ── Settings file ────────────────────────────────────────────────────────────

/** The app opens `recentRepos[0]`, so the settings file is the only way to point it. */
function configPath()
{
  const name = 'gitext';
  if (process.platform === 'darwin')
  {
    return path.join(os.homedir(), 'Library/Application Support', name, 'config.json');
  }
  if (process.platform === 'win32')
  {
    return path.join(process.env.APPDATA ?? os.homedir(), name, 'config.json');
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), name, 'config.json');
}

const CONFIG = configPath();
const original = fs.readFileSync(CONFIG, 'utf8');
const restore = () => fs.writeFileSync(CONFIG, original);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
{
  process.on(signal, () =>
  {
    restore();
    process.exit(130);
  });
}

const config = JSON.parse(original);
config.recentRepos = [options.repo, ...(config.recentRepos ?? []).filter((p) => p !== options.repo)];
fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));

// ── Run ──────────────────────────────────────────────────────────────────────

if (!fs.existsSync(path.join(APP_DIR, 'out/main/index.js')))
{
  console.error('out/main/index.js is missing: run `npm run build` first.');
  restore();
  process.exit(1);
}

const { _electron: electron } = await import(
  process.env.PLAYWRIGHT_CORE ?? 'playwright-core'
);

const app = await electron.launch({
  executablePath: path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  args: [APP_DIR],
  cwd: APP_DIR,
  // Never in front: a profiling run is a check, and a check that takes the screen
  // interrupts whoever is at the keyboard. See `main/background.ts`.
  env: { ...process.env, GITEXT_BACKGROUND: '1' },
  timeout: 30_000
});

const page = await app.firstWindow();
await page.waitForTimeout(options.settle);

const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: SAMPLE_US });
await cdp.send('Profiler.start');

let result;
try
{
  result = await page.evaluate(scenario.run);
}
catch (error)
{
  result = { error: String(error).slice(0, 200) };
}

const { profile } = await cdp.send('Profiler.stop');

/** Self time per function: which one the frame was actually spent in. */
function selfTimes(cpuProfile)
{
  const byId = new Map(cpuProfile.nodes.map((node) => [node.id, node]));
  const self = new Map();
  const deltas = cpuProfile.timeDeltas ?? [];
  cpuProfile.samples.forEach((id, index) =>
    self.set(id, (self.get(id) ?? 0) + (deltas[index] ?? 0))
  );

  const rows = [];
  for (const [id, us] of self)
  {
    const frame = byId.get(id)?.callFrame;
    if (!frame)
    {
      continue;
    }
    const ms = Math.round(us / 1000);
    if (ms < MIN_MS || frame.functionName === '(idle)')
    {
      continue;
    }
    rows.push({
      ms,
      name: frame.functionName || '(anonymous)',
      where: `${String(frame.url).split('/').pop()}:${frame.lineNumber + 1}`
    });
  }
  return rows.sort((a, b) => b.ms - a.ms).slice(0, options.top);
}

console.log(`\nscenario: ${options.scenario}  (${scenario.what})`);
console.log(`repository: ${options.repo}`);
console.log(`result: ${JSON.stringify(result)}\n`);
console.log('self time, biggest first:');
for (const row of selfTimes(profile))
{
  console.log(`  ${String(row.ms).padStart(5)}ms  ${row.name}  ${row.where}`);
}
console.log(
  '\n`(program)` is V8 and the browser: layout, style and paint, not this app\'s own JavaScript.'
);

restore();
await app.close();
