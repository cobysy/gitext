/**
 * Three splitters sizing the commit screen. The lists' divider auto-fits their content until dragged.
 */

import { nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import { usePaneSplitter } from '@renderer/composables/useSplitter.js';
import { useSettingsStore } from '@renderer/stores/settings.js';
import { useStagingStore } from '@renderer/stores/staging.js';

/** The smallest either file list is ever squeezed to, dragged or fitted. */
const MIN_LIST = 80;

const SPLITTER_EDGE_RIGHT = 'right';

export interface PaneSizingOptions {
  /** The lists' container, and each list: the component's, so it owns its own refs. */
  listsEl: Ref<HTMLElement | null>;
  unstagedEl: Ref<HTMLElement | null>;
  stagedEl: Ref<HTMLElement | null>;
}

export function usePaneSizing(opts: PaneSizingOptions)
{
  const settings = useSettingsStore();
  const staging = useStagingStore();
  const { listsEl, unstagedEl, stagedEl } = opts;

  const lists = usePaneSplitter({
    initial: settings.settings.commitListsWidth,
    min: 200,
    max: () => window.innerWidth - 420,
    edge: SPLITTER_EDGE_RIGHT,
    onEnd: (size) => void settings.patch({ commitListsWidth: size })
  });

  // The staged list hangs below its divider, growing upward as the pointer rises.
  const stagedPane = usePaneSplitter({
    initial: settings.settings.commitStagedHeight,
    min: MIN_LIST,
    max: () => window.innerHeight - 240,
    onEnd: (size) =>
    {
      // A drag is the last word: from here on the screen stops fitting the divider to
      // the lists, or the next `git add` would move it back out from under the pointer.
      pinnedDivider.value = true;
      void settings.patch({ commitStagedHeight: size });
    }
  });

  /**
   * Divider auto-fits based on list content (split proportionally if both don't fit).
   * Once dragged, stays pinned until the next auto-fit trigger.
   */
  const pinnedDivider = ref(false);

  /** The height a list would take if nothing were holding it back. */
  function wantedHeight(pane: HTMLElement | null): number
  {
    const list = pane?.querySelector<HTMLElement>('.staging-list');
    const rows = pane?.querySelector<HTMLElement>('.rows');
    if (!list || !rows)
    {
      return MIN_LIST;
    }
    // The heading and filter box, plus what the rows actually come to.
    const chrome = list.getBoundingClientRect().height - rows.getBoundingClientRect().height;
    return Math.ceil(chrome + rowsHeight(rows));
  }

  /**
   * Measure from the last row's bottom: scrollHeight never shrinks below the element's own height.
   */
  function rowsHeight(rows: HTMLElement): number
  {
    const last = rows.lastElementChild;
    if (!last)
    {
      return 0;
    }
    // `scrollTop` because the children have moved up by however far the list is scrolled.
    return last.getBoundingClientRect().bottom + rows.scrollTop - rows.getBoundingClientRect().top;
  }

  function fitDivider(): void
  {
    if (pinnedDivider.value)
    {
      return;
    }
    const box = listsEl.value;
    if (!box)
    {
      return;
    }
    // The splitter itself sits between them and is 4px of the column.
    const available = box.clientHeight - 4;
    if (available <= 0)
    {
      return;
    }

    const staged = wantedHeight(stagedEl.value);
    const unstaged = wantedHeight(unstagedEl.value);
    let wanted;
    if (staged + unstaged <= available)
    {
      wanted = staged;
    }
    else
    {
      wanted = (available * staged) / (staged + unstaged);
    }

    const ceiling = Math.max(MIN_LIST, available - MIN_LIST);
    stagedPane.size.value = Math.round(Math.min(Math.max(wanted, MIN_LIST), ceiling));
  }

  /** Re-fit after Vue has drawn whatever changed, or the rows measured are the old ones. */
  async function fitSoon(): Promise<void>
  {
    await nextTick();
    fitDivider();
  }

  // Message box must have room for multiple lines, not just a single line.
  const messagePane = usePaneSplitter({
    initial: settings.settings.commitMessageHeight,
    min: 170,
    max: () => window.innerHeight - 200,
    onEnd: (size) => void settings.patch({ commitMessageHeight: size })
  });

  // What is in the lists: how many files, and how they are drawn, since a tree and a
  // flat list of the same files are different numbers of rows.
  watch(
    () => [
      staging.unstagedFiles.length,
      staging.stagedFiles.length,
      settings.settings.stagingListView,
      settings.settings.stagingDenseTree,
      settings.settings.stagingFilterVisible
    ],
    () => void fitSoon()
  );

  let listsObserver: ResizeObserver | null = null;

  onMounted(() =>
  {
    // A resized window changes what there is to divide, and so does the command log
    // opening underneath the screen.
    if (listsEl.value)
    {
      listsObserver = new ResizeObserver(() => fitDivider());
      listsObserver.observe(listsEl.value);
    }
    void fitSoon();
  });

  onUnmounted(() =>
  {
    listsObserver?.disconnect();
  });

  return { lists, stagedPane, messagePane };
}
