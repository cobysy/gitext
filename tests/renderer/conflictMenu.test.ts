/**
 * The conflicted-file list's menu.
 *
 * It was built inline in `ResolveConflictsDialog.vue`, which is why this file is new: three
 * rows whose labels and availability are a function of the selection, in a window a unit
 * test cannot reach and a tour drives only one way through. The rules are small and each
 * one is a decision, so they are worth pinning directly.
 */

import { describe, expect, it } from 'vitest';
import {
  conflictRowMenu,
  CONFLICT_MENU_MERGETOOL,
  CONFLICT_MENU_RESOLVED,
  CONFLICT_MENU_RESOLVE_HERE
} from '@renderer/menus/conflicts.js';

const idsOf = (paths: readonly string[]): string[] =>
  conflictRowMenu(paths).map((row) => row.id);

const enabledIn = (paths: readonly string[]): string[] =>
  conflictRowMenu(paths)
    .filter((row) => row.enabled)
    .map((row) => row.id);

const labelOf = (paths: readonly string[], id: string): string =>
  conflictRowMenu(paths).find((row) => row.id === id)!.label;

describe('the conflicted-file menu', () =>
{
  it('offers the same three rows whatever is picked', () =>
  {
    // The shape stays put and the rows grey, like every other context menu in the app:
    // a menu that changes length as the selection changes is a menu you cannot aim at.
    const three = [CONFLICT_MENU_MERGETOOL, CONFLICT_MENU_RESOLVE_HERE, CONFLICT_MENU_RESOLVED];
    expect(idsOf([])).toEqual(three);
    expect(idsOf(['a.ts'])).toEqual(three);
    expect(idsOf(['a.ts', 'b.ts'])).toEqual(three);
  });

  it('resolves here for one file only', () =>
  {
    // The editor opens on a single conflict; there is no bulk version of it to run.
    expect(enabledIn(['a.ts'])).toContain(CONFLICT_MENU_RESOLVE_HERE);
    expect(enabledIn(['a.ts', 'b.ts'])).not.toContain(CONFLICT_MENU_RESOLVE_HERE);
  });

  it('takes any number of files to the merge tool, or marks them resolved', () =>
  {
    expect(enabledIn(['a.ts', 'b.ts'])).toEqual([
      CONFLICT_MENU_MERGETOOL,
      CONFLICT_MENU_RESOLVED
    ]);
  });

  it('offers nothing with nothing picked', () =>
  {
    // Right-clicking a folder row that contains no conflicted file lands here.
    expect(enabledIn([])).toEqual([]);
  });

  it('names what it will act on, rather than counting it', () =>
  {
    expect(labelOf(['a.ts'], CONFLICT_MENU_MERGETOOL)).toBe('Open this file in merge tool');
    expect(labelOf(['a.ts', 'b.ts'], CONFLICT_MENU_MERGETOOL)).toBe(
      'Open these 2 files in merge tool'
    );
    expect(labelOf(['a.ts'], CONFLICT_MENU_RESOLVED)).toBe('Mark this file resolved as-is');
    expect(labelOf(['a.ts', 'b.ts'], CONFLICT_MENU_RESOLVED)).toBe(
      'Mark these 2 files resolved as-is'
    );
  });

  it('opens a window from the row that says it does', () =>
  {
    // The ellipsis is the app's one piece of punctuation with a meaning attached: this row
    // raises the three-way editor, and the other two act where they stand.
    expect(labelOf(['a.ts'], CONFLICT_MENU_RESOLVE_HERE).endsWith('…')).toBe(true);
    expect(labelOf(['a.ts'], CONFLICT_MENU_MERGETOOL).endsWith('…')).toBe(false);
    expect(labelOf(['a.ts'], CONFLICT_MENU_RESOLVED).endsWith('…')).toBe(false);
  });
});
