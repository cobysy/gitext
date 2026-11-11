/**
 * Stopping a run through the step runner: the Stop a dialog's footer offers has to reach
 * the process that is running, and what comes back has to read as stopped rather than as
 * a failure, which would open the console on a run the user meant to end.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const calls: { channel: string; args: unknown[] }[] = [];
let rejectRun: ((err: Error) => void) | null = null;

vi.mock('@renderer/api.js', () => ({
  toMessage: (err: unknown) => String(err),
  api: {
    on: () => () =>
    {},
    'git:run': (...args: unknown[]) =>
    {
      calls.push({ channel: 'git:run', args });
      return new Promise((_resolve, reject) => (rejectRun = reject));
    },
    'git:cancel': (...args: unknown[]) =>
    {
      calls.push({ channel: 'git:cancel', args });
      return Promise.resolve();
    },
    'dialog:openOutput': (...args: unknown[]) =>
    {
      calls.push({ channel: 'dialog:openOutput', args });
      return Promise.resolve();
    }
  }
}));

const { runConsoleSteps, StoppedRun, ConsoleFailure } = await import('@renderer/gitConsole.js');
const { createRunActivity } = await import('@renderer/composables/runActivity.js');

const STEPS = [{ label: 'Removing', argv: ['worktree', 'remove', '/w/a'] }];

beforeEach(() =>
{
  setActivePinia(createPinia());
  calls.length = 0;
  rejectRun = null;
});

async function untilRunning(): Promise<void>
{
  await vi.waitFor(() => expect(rejectRun).not.toBeNull());
}

describe('runConsoleSteps with a watcher', () =>
{
  it('hands Stop the id the run was started under', async () =>
  {
    const running = createRunActivity();
    const run = runConsoleSteps('/repo', STEPS, ['worktrees'], { console: false, watcher: running.begin('Removing') });
    await untilRunning();

    running.stop();
    const started = calls.find((call) => call.channel === 'git:run');
    const cancelled = calls.find((call) => call.channel === 'git:cancel');
    expect(cancelled?.args[0]).toBe(started?.args[3]);

    rejectRun!(new Error('killed'));
    await expect(run).rejects.toBeInstanceOf(StoppedRun);
    expect(calls.some((call) => call.channel === 'dialog:openOutput'), 'a stopped run opened the console').toBe(false);
  });

  // The positive twin: without Stop, the same rejection is a failure and says so.
  it('reads a run that died on its own as a failure, and shows it', async () =>
  {
    const running = createRunActivity();
    const run = runConsoleSteps('/repo', STEPS, ['worktrees'], { console: false, watcher: running.begin('Removing') });
    await untilRunning();

    rejectRun!(new Error('fatal: refused'));
    await expect(run).rejects.toBeInstanceOf(ConsoleFailure);
    expect(calls.some((call) => call.channel === 'dialog:openOutput')).toBe(true);
  });

  it('reports each step as it starts', async () =>
  {
    const running = createRunActivity();
    void runConsoleSteps('/repo', STEPS, ['worktrees'], { console: false, watcher: running.begin('Removing') }).catch(() =>
    {});
    await untilRunning();
    expect(running.activity.value).toMatchObject({ argv: STEPS[0]!.argv, index: 0, count: 1 });
    rejectRun!(new Error('x'));
  });
});
