/**
 * Transient UI state: the palette, the commit screen, confirmations, toasts. Which
 * dialog is open is not here: an operation dialog is its own window (`main/dialogs.ts`).
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@renderer/api.js';
import type { PaneId } from '@renderer/commands/registry.js';
import type { CommitPane } from '@renderer/stores/staging/types.js';
import type { DialogName, DialogOpenOptions, DialogPayload } from '@shared/dialogs.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useSettingsStore } from '@renderer/stores/settings.js';

export type { DialogName, DialogPayload };

/** A yes/no question, asked via `ConfirmDialog.vue`. Promise-returning, so a command reads the same way as `window.confirm` would, without its blocking. */
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Draw the confirming button as destructive. For anything that discards work. */
  danger?: boolean;
  /** Offer "don't ask again", remembered under this key; Settings lists every key with a way to switch it back on. */
  rememberKey?: string;
}

export const TOAST_TONE_INFO = 'info' as const;
export const TOAST_TONE_ERROR = 'error' as const;

export interface Toast {
  id: number;
  message: string;
  tone: typeof TOAST_TONE_INFO | typeof TOAST_TONE_ERROR;
}

let nextToastId = 1;

export const useUiStore = defineStore('ui', () =>
{
  /** Whether *this window* is the commit dialog. Set once by `CommitScreen.vue` on mount. */
  const commitScreenOpen = ref(false);
  const paletteOpen = ref(false);
  // Which panes are showing is a setting, not here: this store holds only what dies with the window.
  const toasts = ref<Toast[]>([]);
  const healthDismissed = ref(false);
  /**
   * Which of the commit screen's four panes to move the keyboard to. A counter beside
   * the pane, since focusing is an event a boolean can't cleanly signal. `Mod+1`-`4`
   * bypass this: the screen's own `keydown` handler calls `focusCommitPane` directly.
   */
  const commitPaneRequest = ref<{ pane: CommitPane; seq: number } | null>(null);

  function focusCommitPane(pane: CommitPane): void
  {
    commitPaneRequest.value = { pane, seq: (commitPaneRequest.value?.seq ?? 0) + 1 };
  }

  /**
   * Which pane the keyboard is in, as each pane reports it on `focusin`. A bare-letter
   * binding (`R` resets) needs this, not the event's `<div>`. Never cleared on blur:
   * focus leaving for a menu or toast isn't the keyboard moving panes.
   */
  const focusedPane = ref<PaneId | null>(null);

  function focusPane(pane: PaneId): void
  {
    focusedPane.value = pane;
  }

  /** Whether something in this window is already waiting on the user: the palette or an unanswered confirmation. */
  function interrupted(): boolean
  {
    return paletteOpen.value || confirmRequest.value !== null;
  }

  /** Open a dialog as its own window. The repository is added here, so no opener has to remember which one it meant. */
  function openDialog(
    name: DialogName,
    payload: DialogPayload = {},
    options?: DialogOpenOptions
  ): void
  {
    // An automatic open (nobody asked) waits behind this window's own modals rather than
    // closing them: the raise is dropped often enough that clearing a half-typed palette would lose it for nothing.
    if (options?.automatic && interrupted())
    {
      return;
    }
    paletteOpen.value = false;
    const repoPath = useRepoStore().repo?.path;
    const fullPayload = { ...payload };
    if (repoPath)
    {
      fullPayload.repoPath = repoPath;
    }
    void api['dialog:open'](name, fullPayload, options);
  }

  /** Called by `CommitScreen.vue` itself, once, on mount: see `commitScreenOpen`. */
  function markCommitScreen(): void
  {
    commitScreenOpen.value = true;
  }

  /** Leave the commit screen. `api['dialog:close']` is a no-op from any other window, so callers can call it without asking which window they're in. */
  function closeCommitScreen(): void
  {
    commitScreenOpen.value = false;
    void api['dialog:close']();
  }

  /** The open confirmation and its resolver, held outside the ref since a reactive
   *  proxy around a function must never cross back to a caller expecting to call it. */
  const confirmRequest = ref<ConfirmRequest | null>(null);
  let confirmResolve: ((ok: boolean) => void) | null = null;

  function confirm(request: ConfirmRequest): Promise<boolean>
  {
    // A second question while one is open answers the first with "no" rather than
    // leaving its promise pending forever.
    confirmResolve?.(false);
    confirmRequest.value = request;
    return new Promise<boolean>((resolve) =>
    {
      confirmResolve = resolve;
    });
  }

  function answerConfirm(ok: boolean): void
  {
    confirmRequest.value = null;
    confirmResolve?.(ok);
    confirmResolve = null;
  }

  /** Ask, unless a `rememberKey` was ticked off, which answers yes without drawing. */
  async function confirmUnlessSuppressed(request: ConfirmRequest): Promise<boolean>
  {
    if (request.rememberKey && useSettingsStore().confirmSuppressed(request.rememberKey))
    {
      return true;
    }
    return confirm(request);
  }

  function openPalette(): void
  {
    paletteOpen.value = true;
  }

  function closePalette(): void
  {
    paletteOpen.value = false;
  }

  function toast(message: string, tone: Toast['tone'] = TOAST_TONE_INFO): void
  {
    const item: Toast = { id: nextToastId++, message, tone };
    toasts.value.push(item);
    setTimeout(() =>
    {
      toasts.value = toasts.value.filter((t) => t.id !== item.id);
    }, 4000);
  }

  return {
    commitScreenOpen,
    confirmRequest,
    paletteOpen,

    toasts,
    healthDismissed,
    commitPaneRequest,
    focusedPane,
    focusPane,
    openDialog,
    markCommitScreen,
    closeCommitScreen,
    confirm,
    confirmUnlessSuppressed,
    answerConfirm,
    openPalette,
    closePalette,

    focusCommitPane,

    toast
  };
});
