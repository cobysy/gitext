/**
 * Finding the dialog standing on another dialog.
 *
 * `modalChildOf` answers about a *repository* window's whole stack: `ownerWindow` walks to
 * the top of the chain, so asking it about a dialog gets the repository window and matches
 * nothing. `dialogOver` asks about one hop, which is what a parent about to close needs to
 * know: a modal child dies with its parent, and the child can be a merge editor holding
 * unsaved work.
 *
 * `dialogOver` takes its candidates as a parameter and touches only `isDestroyed` and
 * `getParentWindow`, so the windows here are stand-ins rather than Electron's.
 */

import { describe, expect, it } from 'vitest';
import type { BrowserWindow } from 'electron';
import { dialogOver } from '@main/dialogs/ownership.js';

interface FakeWindow {
  name: string;
  parent: FakeWindow | null;
  destroyed?: boolean;
}

/**
 * The two methods `dialogOver` calls, over the little tree above.
 *
 * Memoized, because the thing under test is an *identity* comparison: a fresh wrapper per
 * call would make a window's parent unequal to that same window and every lookup miss.
 */
const wrappers = new WeakMap<FakeWindow, BrowserWindow>();

function asWindow(win: FakeWindow): BrowserWindow
{
  const existing = wrappers.get(win);
  if (existing)
  {
    return existing;
  }
  const wrapper = {
    name: win.name,
    isDestroyed: () => win.destroyed === true,
    getParentWindow: () =>
    {
      if (win.parent)
      {
        return asWindow(win.parent);
      }
      return null;
    }
  } as unknown as BrowserWindow;
  wrappers.set(win, wrapper);
  return wrapper;
}

describe('dialogOver', () =>
{
  const repo: FakeWindow = { name: 'repo', parent: null };
  const resolver: FakeWindow = { name: 'resolver', parent: repo };
  const editor: FakeWindow = { name: 'editor', parent: resolver };

  /** Identity has to survive `asWindow`, so compare on the name it carries through. */
  const nameOf = (win: BrowserWindow | null): string | null =>
    (win as unknown as FakeWindow | null)?.name ?? null;

  it('finds the dialog parented directly to this one', () =>
  {
    const open = [asWindow(resolver), asWindow(editor)];
    expect(nameOf(dialogOver(asWindow(resolver), open))).toBe('editor');
  });

  it('finds nothing when this dialog is the innermost one', () =>
  {
    const open = [asWindow(resolver)];
    expect(dialogOver(asWindow(resolver), open)).toBeNull();
  });

  /** The case `modalChildOf` cannot answer: a grandchild is not a child. */
  it('does not report a dialog two hops down', () =>
  {
    const open = [asWindow(resolver), asWindow(editor)];
    expect(dialogOver(asWindow(repo), open)).not.toBeNull();
    expect(nameOf(dialogOver(asWindow(repo), open))).toBe('resolver');
  });

  it('ignores a window that has already been destroyed', () =>
  {
    const gone: FakeWindow = { name: 'gone', parent: resolver, destroyed: true };
    expect(dialogOver(asWindow(resolver), [asWindow(gone)])).toBeNull();
  });

  it('never reports the window itself', () =>
  {
    const orphan: FakeWindow = { name: 'orphan', parent: null };
    expect(dialogOver(asWindow(orphan), [asWindow(orphan)])).toBeNull();
  });
});
