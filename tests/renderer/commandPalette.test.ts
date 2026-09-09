// @vitest-environment happy-dom
/**
 * The command palette, mounted.
 *
 * One rule needs it: what an empty palette leads with. Sorted alphabetically by group it
 * opened on "Branch / Checkout Branch…" and put everything anyone opens the palette for
 * below the fold, so the app's list of everything it can do read as an arbitrary slice of
 * it. The ordering is a claim about which commands matter, and a claim is worth pinning.
 *
 * The filtering underneath is a subsequence match and stays the ranking the moment
 * anything is typed: a common command that matches worse than an uncommon one has no
 * claim to be above it, and the test below is what says so.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { CommandContext } from '@renderer/commands/registry.js';

vi.mock('@renderer/api.js', () => ({
  toMessage: (error: unknown) => String(error),
  api: { on: () => () => undefined }
}));

enableAutoUnmount(afterEach);

/** A repository open, nothing selected: the state the palette is usually opened in. */
const context: CommandContext = {
  hasRepo: true,
  hasSuperproject: false,
  isMidOperation: false,
  hasChanges: true,
  selectionCount: 0,
  hasArtificialSelection: false,
  fileSelectionCount: 0,
  focusedPane: 'grid',
  fileSource: null,
  stagingSide: null,
  stagingSelectionCount: 0,
  selectedNode: null,
  selectedFile: null
};

async function openPalette()
{
  const CommandPalette = (await import('@renderer/components/CommandPalette.vue')).default;
  const { useUiStore } = await import('@renderer/stores/ui.js');
  (await import('@renderer/commands/index.js')).registerCommands();

  useUiStore().openPalette();
  const wrapper = mount(CommandPalette, { props: { context } });
  await flushPromises();
  return wrapper;
}

const labelsOf = (wrapper: Awaited<ReturnType<typeof openPalette>>): string[] =>
  wrapper.findAll('.item .label').map((row) => row.text());

describe('the command palette', () =>
{
  beforeEach(() =>
  {
    setActivePinia(createPinia());
  });

  it('leads with the operations of an ordinary day', async () =>
  {
    const wrapper = await openPalette();
    expect(labelsOf(wrapper).slice(0, 3)).toEqual(['Commit…', 'Pull / Fetch…', 'Push…']);
  });

  it('does not lead with whatever sorts first', async () =>
  {
    // The positive twin: the assertion above would pass for the wrong reason if the list
    // happened to be alphabetical and Commit happened to win it.
    const wrapper = await openPalette();
    const labels = labelsOf(wrapper);
    const alphabetical = [...labels].sort((a, b) => a.localeCompare(b));
    expect(labels).not.toEqual(alphabetical);
  });

  it('hands the ranking back to the query as soon as one is typed', async () =>
  {
    const wrapper = await openPalette();
    await wrapper.find('input').setValue('refresh');
    await flushPromises();

    // Commit leads an empty palette and matches nothing here, so it is gone rather than
    // held at the top by a list of what someone thought was common.
    const labels = labelsOf(wrapper);
    expect(labels[0]).toBe('Refresh');
    expect(labels).not.toContain('Commit…');
  });

  it('says so when nothing matches', async () =>
  {
    const wrapper = await openPalette();
    await wrapper.find('input').setValue('zzzzzzzz');
    await flushPromises();

    expect(labelsOf(wrapper)).toEqual([]);
    expect(wrapper.text()).toContain('No matching commands');
  });
});
