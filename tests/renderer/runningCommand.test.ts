// @vitest-environment happy-dom
/**
 * The line a dialog's footer draws while git runs, mounted against a real activity.
 *
 * Two rules are the point of it: it stays silent for the first second, so a quick
 * command does not flash a line up and away, and once it shows, its clock keeps moving
 * and its Stop reaches the step that is running.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import RunningCommand from '@renderer/components/transparency/RunningCommand.vue';
import { createRunActivity, RUN_ACTIVITY } from '@renderer/composables/runActivity.js';

enableAutoUnmount(afterEach);

beforeEach(() =>
{
  vi.useFakeTimers();
});

afterEach(() =>
{
  vi.useRealTimers();
});

function mountWith(running: ReturnType<typeof createRunActivity>)
{
  return mount(RunningCommand, {
    global: { provide: { [RUN_ACTIVITY as symbol]: { activity: running.activity, stop: running.stop } } }
  });
}

async function advance(ms: number): Promise<void>
{
  vi.advanceTimersByTime(ms);
  await nextTick();
}

describe('RunningCommand', () =>
{
  it('says nothing for the first second, then names the command and its clock', async () =>
  {
    const running = createRunActivity();
    const wrapper = mountWith(running);
    const watcher = running.begin('Removing');
    watcher.started({ label: 'Removing', argv: ['worktree', 'remove', '/w/a'], index: 0, count: 1, stop: null });
    await advance(900);
    expect(wrapper.find('.running').exists(), 'a quick command flashed a line').toBe(false);

    await advance(1600);
    expect(wrapper.find('.cmd').text()).toBe('git worktree remove /w/a');
    expect(wrapper.find('.progress').text()).toBe('2s');
  });

  it('counts the steps of a run that is several', async () =>
  {
    const running = createRunActivity();
    const wrapper = mountWith(running);
    const watcher = running.begin('Deleting');
    watcher.started({ label: 'Removing', argv: ['worktree', 'remove', '/w/b'], index: 1, count: 3, stop: null });
    await advance(1000);
    expect(wrapper.find('.progress').text()).toBe('2 of 3 · 1s');
  });

  it('stops the running step, once, and says it is stopping', async () =>
  {
    const running = createRunActivity();
    const wrapper = mountWith(running);
    const stop = vi.fn();
    const watcher = running.begin('Removing');
    watcher.started({ label: 'Removing', argv: ['worktree', 'remove', '/w/a'], index: 0, count: 1, stop });
    await advance(1000);

    await wrapper.find('button').trigger('click');
    await wrapper.find('button').trigger('click');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(watcher.stopping).toBe(true);
    expect(wrapper.find('button').text()).toBe('Stopping…');
  });

  it('offers no Stop where there is nothing to kill', async () =>
  {
    const running = createRunActivity();
    const wrapper = mountWith(running);
    running.begin('Opening the worktree');
    await advance(1000);
    expect(wrapper.find('.cmd').text()).toBe('Opening the worktree');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('goes when the run ends', async () =>
  {
    const running = createRunActivity();
    const wrapper = mountWith(running);
    running.begin('Removing');
    await advance(1000);
    expect(wrapper.find('.running').exists()).toBe(true);
    running.end();
    await nextTick();
    expect(wrapper.find('.running').exists()).toBe(false);
  });
});
