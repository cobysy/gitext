/**
 * Commit screen keyboard: Cmd/Ctrl+Enter commit, Escape close, Cmd/Ctrl+1-4 jump to panes (screen-local).
 */

import { onMounted, onUnmounted, watch, type Ref } from 'vue';
import {
  STAGING_SIDE_STAGED,
  STAGING_SIDE_UNSTAGED,
  useStagingStore
} from '@renderer/stores/staging.js';
import {
  COMMIT_PANE_DIFF as PANE_DIFF,
  COMMIT_PANE_MESSAGE as PANE_MESSAGE,
  type CommitPane as Pane
} from '@renderer/stores/staging/types.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { KEY_ENTER, KEY_ESCAPE } from '@renderer/keys.js';

/** Cmd/Ctrl+Enter, wherever focus is on this screen. */
function isCommitShortcut(event: KeyboardEvent): boolean
{
  return event.key === KEY_ENTER && (event.metaKey || event.ctrlKey);
}

/** Cmd/Ctrl alone: the modifier the pane-number shortcuts want, and no other. */
function isPaneSwitchModifier(event: KeyboardEvent): boolean
{
  return (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
}

const PANE_KEYS: Record<string, Pane | undefined> = {
  '1': STAGING_SIDE_UNSTAGED,
  '2': STAGING_SIDE_STAGED,
  '3': PANE_DIFF,
  '4': PANE_MESSAGE
};

export interface ScreenKeyboardOptions {
  /** The screen's root, for finding a pane's element by class. */
  screen: Ref<HTMLElement | null>;
  messageBox: Ref<{ focus: () => void } | null>;
  /** Whether the screen's own dropdown (Undo/Options) is open: Escape closes it first. */
  menuOpen: () => boolean;
  closeMenu: () => void;
  onClose: () => void;
}

export function useScreenKeyboard(opts: ScreenKeyboardOptions)
{
  const staging = useStagingStore();
  const ui = useUiStore();

  /** Move the keyboard to one of the four panes. */
  function focusPane(pane: Pane): void
  {
    if (pane === PANE_MESSAGE)
    {
      opts.messageBox.value?.focus();
      return;
    }
    if (pane === PANE_DIFF)
    {
      opts.screen.value?.querySelector<HTMLElement>('.staging-diff .hunks')?.focus();
      return;
    }
    // A list also has to *be* the selected side, or the arrow keys it just got would move
    // the other one's selection.
    staging.side = pane;
    opts.screen.value?.querySelector<HTMLElement>(`.${pane} .rows`)?.focus();
  }

  function onKeydown(event: KeyboardEvent): void
  {
    if (isCommitShortcut(event))
    {
      event.preventDefault();
      void staging.commit();
      return;
    }
    if (event.key === KEY_ESCAPE)
    {
      // Not while a dialog is up: a confirmation owns Escape, and closing the whole
      // screen out from under it would answer it by accident. Checked *before* stopping
      // propagation below: `useDialogKeyboard` is what actually answers a confirm
      // (`ui.answerConfirm(false)`), so this has to let the event through to it rather
      // than swallow it here and do nothing.
      if (ui.confirmRequest)
      {
        return;
      }
      // This screen is a dialog window now (`commit.open`), and `DialogHost` attaches its
      // own generic Escape handler over the same window (`useDialogKeyboard`): one that
      // knows nothing about the dropdown below and would close the whole window out from
      // under it instead of just the menu. This one runs first (attached at mount, before
      // `useDialogKeyboard` waits on `ready`), so stopping it here, once this handler has
      // decided it *is* the one acting, is what keeps the two from double-handling one
      // keypress.
      event.stopImmediatePropagation();
      if (opts.menuOpen())
      {
        opts.closeMenu();
        return;
      }
      event.preventDefault();
      opts.onClose();
      return;
    }

    // The four panes, by number. Screen-local like the grid's arrow keys rather than
    // registry hotkeys: `Mod+1` with the screen closed must not focus anything.
    if (isPaneSwitchModifier(event))
    {
      const pane = PANE_KEYS[event.key];
      if (pane)
      {
        event.preventDefault();
        focusPane(pane);
      }
    }
  }

  /**
   * The same four moves, asked for by the `staging.focus*` commands rather than by a key.
   *
   * Watched rather than called: a command runs in the store, and only this composable
   * knows where the panes are. The request carries a counter so asking twice for the pane
   * that already has focus is two requests: see `commitPaneRequest`.
   */
  watch(
    () => ui.commitPaneRequest,
    (request) =>
    {
      if (request)
      {
        focusPane(request.pane);
      }
    }
  );

  onMounted(() =>
  {
    window.addEventListener('keydown', onKeydown);
    opts.messageBox.value?.focus();
  });

  onUnmounted(() =>
  {
    window.removeEventListener('keydown', onKeydown);
  });

  return { focusPane };
}
