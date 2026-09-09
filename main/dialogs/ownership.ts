/**
 * Window-tree relationships: which repository window a message came from, and which
 * dialog is innermost over it. Pure `BrowserWindow` parent-chain math, independent of
 * how a dialog is opened or closed: `modalChildOf` takes candidate windows as a
 * parameter rather than reaching for `dialogs.ts`'s `open` Map.
 */

import { BrowserWindow } from 'electron';

/**
 * The repository window a message came from: itself, or its parent when a dialog sent
 * it. Everything owned by the repository (the command registry, the menu bar's dispatch
 * target, the next dialog's parent) belongs to the window at the top of that chain.
 */
export function ownerWindow(win: BrowserWindow | null): BrowserWindow | null
{
  if (!win || win.isDestroyed())
  {
    return null;
  }
  // The whole chain, not one hop: a dialog raised from a dialog is parented to the one it came from, but it still belongs to the repository window at the top.
  let current = win;
  for (
    let parent = current.getParentWindow();
    parent && !parent.isDestroyed();
    parent = current.getParentWindow()
  )
  {
    current = parent;
  }
  return current;
}

/** How many windows sit between `win` and the repository window above it. */
function depthOf(win: BrowserWindow): number
{
  let depth = 0;
  for (let parent = win.getParentWindow(); parent; parent = parent.getParentWindow())
  {
    depth++;
  }
  return depth;
}

/** The repository windows: every window that is not a dialog. */
export function repoWindows(): BrowserWindow[]
{
  return BrowserWindow.getAllWindows().filter((win) => win.getParentWindow() === null);
}

/**
 * The innermost dialog open over `owner`, if there is one. Two callers: the menu bar (a
 * modal dialog disables its parent's *input*, but the app menu stays live, so a command
 * would otherwise reach a window the user can't reach) and the opener (a dialog raising
 * another parents it here, modal over the dialog that asked). `candidates` is
 * `dialogs.ts`'s `open` Map, passed in so this file knows nothing about how a dialog is tracked.
 */
/** True when `win` is a live dialog, other than `owner` itself, owned by `owner`. */
function isLiveDialogOwnedBy(win: BrowserWindow, owner: BrowserWindow): boolean
{
  return !win.isDestroyed() && ownerWindow(win) === owner && win !== owner;
}

/**
 * The dialog open directly over `parent`, if there is one. Not the same question as
 * `modalChildOf` below, which answers about a *repository* window's whole stack: this
 * asks about one hop. Used because a modal child dies with its parent, so a parent about to close has to know whether anything is standing on it.
 */
export function dialogOver(
  parent: BrowserWindow,
  candidates: Iterable<BrowserWindow>
): BrowserWindow | null
{
  for (const win of candidates)
  {
    if (!win.isDestroyed() && win !== parent && win.getParentWindow() === parent)
    {
      return win;
    }
  }
  return null;
}

export function modalChildOf(
  owner: BrowserWindow,
  candidates: Iterable<BrowserWindow>
): BrowserWindow | null
{
  let innermost: BrowserWindow | null = null;
  for (const win of candidates)
  {
    if (!isLiveDialogOwnedBy(win, owner))
    {
      continue;
    }
    if (!innermost || depthOf(win) > depthOf(innermost))
    {
      innermost = win;
    }
  }
  return innermost;
}
