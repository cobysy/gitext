/**
 * The dialog windows: opening one over its owner, fitting it to its content, closing it,
 * and the console window a watched run streams into.
 */

import { clipboard } from 'electron';
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
    // A window nobody asked for waits its turn: `openDialogWindow` reads a request
    // from the repository window as "start fresh", which is wrong for a raise the app decided on itself.
    if (options?.automatic && modalChildOf(owner))
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
