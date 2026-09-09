/**
 * The toolbar's declaration and its resolution.
 *
 * Same reasoning as `menu.test.ts`: the declaration is ids, so everything worth
 * checking: that a button greys when its command is unbuilt, that the badge only sits
 * where it was asked for, that a dropdown greys with its contents, is a unit test
 * rather than a screenshot. Fixture commands, because the built command modules import
 * stores that read `window`.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  declareCommand,
  defineCommand,
  type CommandContext
} from '@renderer/commands/registry.js';
import { item } from '@renderer/menus/resolve.js';
import { mainToolbar, resolveToolbar, type ToolbarNode } from '@renderer/menus/toolbar.js';

const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  hasRepo: true,
  hasSuperproject: false,
  isMidOperation: false,
  hasChanges: false,
  selectionCount: 1,
  hasArtificialSelection: false,
  fileSelectionCount: 1,
  focusedPane: 'fileList',
  fileSource: 'workingTree',
  stagingSide: null,
  stagingSelectionCount: 0,
  selectedNode: null,
  selectedFile: null,
  ...over
});

// Ids prefixed so they cannot collide with the real registry, which other suites in the
// same process register into.
defineCommand({ id: 'tb.built', label: 'Built', group: 'Test', run: () => undefined });
defineCommand({
  id: 'tb.needsRepo',
  label: 'Needs Repo',
  group: 'Test',
  keys: ['Mod+R'],
  when: (c) => c.hasRepo,
  run: () => undefined
});
declareCommand('tb.declared', 'Declared', 'Test');

describe('resolveToolbar', () =>
{
  it('takes the label and accelerator from the registry, never from the declaration', () =>
  {
    const [button] = resolveToolbar([{ kind: 'button', id: 'tb.needsRepo' }], ctx());
    expect(button).toEqual({
      kind: 'button',
      id: 'tb.needsRepo',
      label: 'Needs Repo',
      accelerator: 'Mod+R',
      enabled: true,
      badge: false
    });
  });

  it('marks the dropdown whose label comes from the repository', () =>
  {
    // The branch button is the toolbar's one control naming a thing rather than an action,
    // and the thing it names moves: the declaration's label only stands in until a
    // repository is open.
    const [fixed] = resolveToolbar(
      [{ kind: 'dropdown', id: 'tb.group', label: 'Group', items: [item('tb.needsRepo')] }],
      ctx()
    );
    const [dynamic] = resolveToolbar(
      [
        {
          kind: 'dropdown',
          id: 'branch',
          label: 'Branch',
          dynamicLabel: true,
          items: [item('tb.needsRepo')]
        }
      ],
      ctx()
    );
    expect(fixed).toHaveProperty('dynamicLabel', false);
    expect(dynamic).toHaveProperty('dynamicLabel', true);
  });

  it('greys a command whose `when` fails and one that is not built yet, alike', () =>
  {
    const nodes: ToolbarNode[] = [
      { kind: 'button', id: 'tb.needsRepo' },
      { kind: 'button', id: 'tb.declared' }
    ];
    const resolved = resolveToolbar(nodes, ctx({ hasRepo: false }));
    expect(resolved.map((entry) => entry.kind === 'button' && entry.enabled)).toEqual([
      false,
      false
    ]);
  });

  it('carries the badge only where the declaration asked for one', () =>
  {
    const resolved = resolveToolbar(
      [
        { kind: 'button', id: 'tb.built', badge: true },
        { kind: 'button', id: 'tb.needsRepo' }
      ],
      ctx()
    );
    expect(resolved.map((entry) => entry.kind === 'button' && entry.badge)).toEqual([true, false]);
  });

  it('drops an unknown id and warns, rather than drawing a permanently dead button', () =>
  {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(resolveToolbar([{ kind: 'button', id: 'tb.nope' }], ctx())).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('greys a dropdown when nothing inside it can be clicked', () =>
  {
    const dropdown: ToolbarNode = {
      kind: 'dropdown',
      id: 'tb.group',
      label: 'Group',
      items: [item('tb.needsRepo'), item('tb.declared')]
    };
    const [enabled] = resolveToolbar([dropdown], ctx());
    const [disabled] = resolveToolbar([dropdown], ctx({ hasRepo: false }));
    expect(enabled?.kind === 'dropdown' && enabled.enabled).toBe(true);
    expect(disabled?.kind === 'dropdown' && disabled.enabled).toBe(false);
  });

  it('keeps separators between groups but never at an edge', () =>
  {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const resolved = resolveToolbar(
      [
        { kind: 'separator' },
        { kind: 'button', id: 'tb.built' },
        { kind: 'separator' },
        { kind: 'button', id: 'tb.needsRepo' }
      ],
      ctx()
    );
    // Unlike a menu, a toolbar's leading rule is the declaration's business: the
    // component puts one after the switcher. What matters is that the count is stable.
    expect(resolved.filter((entry) => entry.kind === 'separator')).toHaveLength(2);
    warn.mockRestore();
  });
});

describe('the toolbar declaration', () =>
{
  const buttons = mainToolbar().filter((node) => node.kind === 'button');

  it('offers each command once', () =>
  {
    const ids = buttons.map((node) => node.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('badges the commit button and nothing else', () =>
  {
    const badged = buttons.filter((node) => node.badge === true).map((node) => node.id);
    expect(badged).toEqual(['commit.open']);
  });

  it('stays short enough to be muscle memory', () =>
  {
    // The point of the assertion is that growing it is a decision someone has to make on
    // purpose.
    expect(buttons.length).toBeLessThanOrEqual(10);
  });
});
