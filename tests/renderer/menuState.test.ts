/**
 * What the renderer tells the native menu about each of its rows.
 *
 * The menu bar is built in main, which cannot resolve a `when` or a `checked`: they read
 * the stores. So the answers travel, and the rule deciding them is the only interesting
 * part. Two things here are load-bearing on the far side: a row reports `checked` only
 * when it is a toggle, because that absence is what makes main draw a plain item; and a
 * declared-but-unbuilt command reports disabled, because a menu greys "not in this build"
 * exactly as it greys "not right now".
 *
 * Fixture commands rather than the real registry, for the reason `menu.test.ts` gives:
 * the real command modules import the stores, which read `window.git` at import time.
 */

import { describe, expect, it } from 'vitest';
import type { CommandContext, CommandDef } from '@renderer/commands/registry.js';
import { resolveStates } from '@renderer/menus/menuBarState.js';

const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  hasRepo: true,
  hasSuperproject: false,
  isMidOperation: false,
  hasChanges: false,
  selectionCount: 1,
  hasArtificialSelection: false,
  fileSelectionCount: 1,
  focusedPane: 'grid',
  fileSource: 'workingTree',
  stagingSide: null,
  stagingSelectionCount: 0,
  selectedNode: null,
  selectedFile: null,
  ...over
});

const def = (over: Partial<CommandDef<never>> & { id: string }): CommandDef<never> => ({
  label: over.id,
  group: 'Test',
  run: () => undefined,
  ...over
});

describe('what a command reports to the menu', () =>
{
  it('enables a built command whose `when` passes', () =>
  {
    const states = resolveStates([def({ id: 'a', when: (c) => c.hasRepo })], ctx());
    expect(states['a']).toEqual({ enabled: true });
  });

  it('disables one whose `when` fails', () =>
  {
    const states = resolveStates(
      [def({ id: 'a', when: (c) => c.selectionCount > 0 })],
      ctx({ selectionCount: 0 })
    );
    expect(states['a']?.enabled).toBe(false);
  });

  it('disables one that is declared but not built', () =>
  {
    // No `run`: the menu greys it the same way, and the accelerator goes with it.
    const states = resolveStates([{ id: 'a', label: 'A', group: 'Test' }], ctx());
    expect(states['a']?.enabled).toBe(false);
  });

  it('enables a command with no `when` at all', () =>
  {
    expect(resolveStates([def({ id: 'a' })], ctx())['a']?.enabled).toBe(true);
  });

  it('omits `checked` entirely for a row that is not a toggle', () =>
  {
    // Not `checked: false`: main reads the absence, and drawing a cleared checkbox beside
    // "Refresh" would say it is a setting that happens to be off.
    expect(resolveStates([def({ id: 'a' })], ctx())['a']).not.toHaveProperty('checked');
  });

  it('reports both ways a toggle can be set', () =>
  {
    const on = def({ id: 'on', checked: () => true });
    const off = def({ id: 'off', checked: () => false });
    const states = resolveStates([on, off], ctx());
    expect(states['on']).toEqual({ enabled: true, checked: true });
    expect(states['off']).toEqual({ enabled: true, checked: false });
  });

  it('resolves `checked` on a row it has also disabled', () =>
  {
    // A toggle that cannot be clicked right now still says which way it is set: the two
    // questions are independent, and a tick that vanished when the row greyed would read
    // as the setting having been turned off.
    const states = resolveStates(
      [def({ id: 'a', when: () => false, checked: () => true })],
      ctx()
    );
    expect(states['a']).toEqual({ enabled: false, checked: true });
  });

  it('names every command it was given', () =>
  {
    const states = resolveStates([def({ id: 'a' }), def({ id: 'b' })], ctx());
    expect(Object.keys(states).sort()).toEqual(['a', 'b']);
  });
});
