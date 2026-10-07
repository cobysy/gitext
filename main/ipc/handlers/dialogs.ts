/**
 * The dialog windows: opening one over its owner, fitting it to its content, closing it,
 * and the console window a watched run streams into.
 */

import { clipboard, type BrowserWindow } from 'electron';
import { appInFront } from '@main/background.js';
import type { DialogOpenOptions } from '@shared/dialogs.js';
import {
  closeDialogWindow,
  fitDialogWindow,
  modalChildOf,
  openDialogWindow,
  openOutputWindow,
  ownerWindow
} from '@main/dialogs.js';
import {
  handle,
  handleFromWindow
} from '../register.js';

/**
 * Whether a window nobody asked for is dropped. It waits its turn behind an open modal:
 * `openDialogWindow` reads a request from the repository window as "start fresh", which
 * is wrong for a raise the app decided on itself. And it never takes the screen from
 * another application: whoever is working there, resolving those very conflicts in a
 * terminal or an editor, is not asking for this one. The banner still says so.
 */
function standsDown(owner: BrowserWindow, options: DialogOpenOptions | undefined): boolean
{
  if (!options?.automatic)
  {
    return false;
  }
  return modalChildOf(owner) !== null || !appInFront();
}

export function registerDialogHandlers(): void
{
  // ── Dialog windows ──────────────────────────────────────────────────────────
  // The owner is the repository window: a dialog opening another dialog opens a sibling, not a grandchild.
  handleFromWindow('dialog:open', (sender, name, payload, options) =>
  {
    const owner = ownerWindow(sender);
    if (!owner || !sender)
    {
      return;
    }
    if (standsDown(owner, options))
    {
      return;
    }
    // `sender` as well as `owner`: whether the repository window asked or another
    // dialog did decides replacing a stray vs. stacking a deliberate child.
    openDialogWindow(owner, name, payload, sender);
  });
  // Over the repository window, not over the dialog that asked: the console has to
  // survive that dialog closing itself when its run succeeds.
  handleFromWindow('dialog:openOutput', (sender, payload) =>
  {
    const owner = ownerWindow(sender);
    if (!owner)
    {
      return;
    }
    openOutputWindow(owner, payload);
  });
  handleFromWindow('dialog:close', (sender) => closeDialogWindow(sender));
  handleFromWindow('dialog:fit', (sender, contentHeight) =>
    fitDialogWindow(sender, contentHeight)
  );
  // To the owner, same as `repo:openHere`: the file tree meant is the repository
  // window's, not this dialog's own (empty) one.
  handleFromWindow('dialog:showInFileTree', (sender, path) =>
  {
    const owner = ownerWindow(sender);
    if (owner && !owner.isDestroyed())
    {
      owner.webContents.send('event:showInFileTree', path);
    }
  });
  // Same shape again: the `revisions` store this filter is for is the repository
  // window's, not the Advanced Filter dialog's.
  handleFromWindow('dialog:applyLogFilter', (sender, filter) =>
  {
    const owner = ownerWindow(sender);
    if (owner && !owner.isDestroyed())
    {
      owner.webContents.send('event:applyLogFilter', filter);
    }
  });
  // And once more: the selection this moves is the grid's, in the window behind this one.
  handleFromWindow('dialog:goToRevision', (sender, sha) =>
  {
    const owner = ownerWindow(sender);
    if (owner && !owner.isDestroyed())
    {
      owner.webContents.send('event:goToRevision', sha);
    }
  });

  // Reading the clipboard needs a renderer permission handler and none in main, the whole reason this channel exists.
  handle('clipboard:read', () => clipboard.readText());

}
