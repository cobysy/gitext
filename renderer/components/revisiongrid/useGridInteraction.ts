/**
 * How the mouse and keyboard drive the grid: row selection, the context menu,
 * arrow/page/home/end movement, quick search, and keeping focus and the viewport
 * following the selection.
 *
 * Pulled out of `RevisionGrid.vue`: "how the user drives the grid" is one coherent
 * reason to change, independent of `GraphCanvas` (`useGraphProps.ts`) or the
 * virtualizer/column layout. Fetches its own stores, like `usePaneSource.ts`; only what
 * the *template* owns (the scroll container, moving the virtualizer) comes in as an option.
 */

import { nextTick, onMounted, watch, type Ref } from 'vue';
import {
  REF_KIND_BRANCH,
  REF_KIND_TAG,
  type CommitRef,
  type CommitRow
} from '@shared/types.js';
import { isArtificialSha } from '@shared/artificial.js';
import { runCommand } from '@renderer/commands/registry.js';
import { useCommandContext } from '@renderer/composables/useCommands.js';
import { useContextMenu } from '@renderer/composables/useContextMenu.js';
import { stepRow } from '@renderer/gridnav.js';
import { checkoutRowsFor } from '@renderer/model/checkoutRows.js';
import { refsAtHead } from '@renderer/model/refsAtHead.js';
import { resolveMenu } from '@renderer/menus/resolve.js';
import { revisionGridMenu, workingDirectoryMenu } from '@renderer/menus/revisionGrid.js';
import { useQuickSearchStore } from '@renderer/stores/quickSearch.js';
import { useRepoStore } from '@renderer/stores/repo.js';
import { useRevisionsStore } from '@renderer/stores/revisions.js';
import { useSelectionStore } from '@renderer/stores/selection.js';
import { useUiStore } from '@renderer/stores/ui.js';
import { KEY_ARROW_DOWN, KEY_ARROW_UP, KEY_END, KEY_ESCAPE, KEY_HOME } from '@renderer/keys.js';

/** Row height, in CSS pixels: the same figure the virtualizer estimates rows at. */
export const ROW_HEIGHT = 24;

const KEY_PAGE_DOWN = 'PageDown';
const KEY_PAGE_UP = 'PageUp';
const KEY_BACKSPACE = 'Backspace';

export interface GridInteractionOptions {
  scroller: Ref<HTMLElement | null>;
  /** Bring a row into view: wraps the virtualizer, which the component owns. */
  scrollToIndex: (row: number, align: 'auto' | 'center') => void;
}

export function useGridInteraction(opts: GridInteractionOptions)
{
  const repo = useRepoStore();
  const revisions = useRevisionsStore();
  const selection = useSelectionStore();
  const quickSearch = useQuickSearchStore();
  const ui = useUiStore();
  const commandContext = useCommandContext();

  /** Ctrl/Cmd toggles one row, Shift extends from the anchor, a plain click replaces. */
  function onRowClick(index: number, event: MouseEvent): void
  {
    const commit = revisions.rows[index];
    if (!commit)
    {
      return;
    }

    // A row picked by hand outranks a reveal still waiting for its batch: see
    // `cancelReveal`.
    revisions.cancelReveal();

    if (event.shiftKey)
    {
      selection.extendTo(commit.sha, revisions.rows);
      // Shift-clicking DOM rows also drag-selects their text, which reads as a
      // rendering fault. Rows stay selectable text otherwise: that is why they are
      // DOM and not canvas.
      window.getSelection()?.removeAllRanges();
    }
    else if (event.ctrlKey || event.metaKey)
    {
      selection.toggle(commit.sha);
    }
    else
    {
      selection.select(commit.sha);
    }
  }

  // ── Context menu ─────────────────────────────────────────────────────────────

  const { menu, openFrom, close: closeMenu } = useContextMenu();

  /**
   * Right-click. Inside the selection it's left alone; outside it, that row is
   * selected first: what makes two-commit compare work, since right-clicking either of a ctrl-clicked pair must keep both.
   */
  function onRowContextMenu(index: number, event: MouseEvent): void
  {
    const row = revisions.rows[index];
    if (!row)
    {
      return;
    }
    if (!selection.has(row.sha))
    {
      selection.select(row.sha);
    }

    event.preventDefault();
    // The working-tree and index rows are not commits, and every row of the grid's own
    // menu takes one: they get the menu for changes you have not committed instead.
    let nodes;
    if (isArtificialSha(row.sha))
    {
      nodes = workingDirectoryMenu;
    }
    else
    {
      nodes = revisionGridMenu(checkoutRowsFor(refsOf(row)));
    }
    // Resolved once, at open: re-greying while open would flicker on every background
    // refresh. The branches on *this* row go in with it, building the checkout submenu.
    openFrom(event, resolveMenu(nodes, commandContext.value));
  }

  /** The grid owned the keyboard before the menu took it; give it back on close, or
   *  the arrow keys go nowhere until the user clicks. */
  function onCloseMenu(): void
  {
    closeMenu();
    focusGrid();
  }

  /** `options` is the operand a row named: see `menus/resolve.ts`' `operand`. */
  async function onMenuCommand(id: string, options?: unknown): Promise<void>
  {
    onCloseMenu();
    const ran = await runCommand(id, commandContext.value, options);
    if (!ran)
    {
      ui.toast(`"${id}" is not available yet.`, 'info');
    }
  }

  /**
   * The rows *fully* on screen. Not `range`, which includes the overscan: a row
   * drawn below the viewport can't be seen, and treating it as visible would let arrow
   * movement walk the selection off screen without scrolling.
   */
  function visibleRange(): { first: number; last: number }
  {
    const el = opts.scroller.value;
    if (!el)
    {
      return { first: 0, last: -1 };
    }
    return {
      first: Math.ceil(el.scrollTop / ROW_HEIGHT),
      last: Math.floor((el.scrollTop + el.clientHeight) / ROW_HEIGHT) - 1
    };
  }

  /** Move the selection to `row`, extending the range from the anchor when shifted. */
  function moveTo(row: number, extend: boolean): void
  {
    const commit = revisions.rows[row];
    if (!commit)
    {
      return;
    }

    // Arrowing to a row is as deliberate as clicking one: see `onRowClick`.
    revisions.cancelReveal();

    if (extend)
    {
      selection.extendTo(commit.sha, revisions.rows);
      window.getSelection()?.removeAllRanges();
    }
    else
    {
      selection.select(commit.sha);
    }
  }

  /**
   * Keyboard handling for the grid itself: only row movement and quick search. A
   * modified key (Mod+Down, Alt+Down) belongs to a registry command and is let through
   * untouched, so there's still one definition of what those keys do.
   */
  function onKeydown(event: KeyboardEvent): void
  {
    const modified = event.altKey || event.ctrlKey || event.metaKey;
    const count = revisions.rows.length;

    if (event.key === KEY_ESCAPE)
    {
      // Only when there is a search to end; otherwise Escape stays the app-wide "close
      // the thing on top of me".
      if (!quickSearch.active)
      {
        return;
      }
      quickSearch.clear();
      event.preventDefault();
      return;
    }

    if (event.key === KEY_BACKSPACE && !modified)
    {
      quickSearch.backspace();
      event.preventDefault();
      return;
    }

    if (count === 0)
    {
      return;
    }

    let current;
    if (selection.primary === null)
    {
      current = undefined;
    }
    else
    {
      current = revisions.rowOf(selection.primary);
    }
    const { first, last } = visibleRange();
    // One row of overlap, so paging keeps a line of context rather than jumping blind.
    const page = Math.max(1, last - first);

    if (modified)
    {
      return;
    }
    let target: number | undefined;
    switch (event.key)
    {
      case KEY_ARROW_DOWN:
        target = stepRow(current, 1, count);
        break;
      case KEY_ARROW_UP:
        target = stepRow(current, -1, count);
        break;
      case KEY_PAGE_DOWN:
        target = stepRow(current, page, count);
        break;
      case KEY_PAGE_UP:
        target = stepRow(current, -page, count);
        break;
      case KEY_HOME:
        target = 0;
        break;
      case KEY_END:
        target = count - 1;
        break;
      default:
        if (event.key.length === 1)
        {
          // A printable character with nothing held down: start or extend a quick search
          // rather than doing nothing, which is what typing into a grid should do.
          quickSearch.type(event.key);
          event.preventDefault();
        }
        return;
    }

    if (target === undefined)
    {
      return;
    }
    event.preventDefault();
    moveTo(target, event.shiftKey);
  }

  /**
   * Put the keyboard on the grid, unless something transient owns it: the grid is the
   * main surface, so opening a repository and pressing Down should walk history without a click first.
   */
  function focusGrid(): void
  {
    if (ui.paletteOpen || ui.confirmRequest)
    {
      return;
    }
    opts.scroller.value?.focus({ preventScroll: true });
  }

  /**
   * A row's refs, with HEAD's marker re-decided against the branch checked out now:
   * `git log` marked it when the rows were loaded, and a checkout does not reload them.
   * See `refsAtHead`.
   */
  function refsOf(commit: CommitRow): CommitRef[]
  {
    return refsAtHead(commit.refs, repo.repo?.branch ?? null);
  }

  /** Ordered so the current branch reads first, then branches, tags, remotes. */
  function sortedRefs(commit: CommitRow): CommitRef[]
  {
    const weight = (ref: CommitRef): number =>
    {
      if (ref.isCurrent)
      {
        return 0;
      }
      switch (ref.kind)
      {
        case REF_KIND_BRANCH:
          return 1;
        case REF_KIND_TAG:
          return 2;
        default:
          return 3;
      }
    };
    return refsOf(commit).sort((a, b) => weight(a) - weight(b));
  }

  // Switching repository starts at the top; leaving the viewport where it was would
  // show a row nobody has looked at yet. Keyed on the repository, not on the grid
  // emptying: a refresh swaps rows in place and never passes through empty.
  watch(
    () => repo.repo?.path,
    () =>
    {
      selection.clear();
      // A term typed against the previous history means nothing in this one.
      quickSearch.reset();
      opts.scroller.value?.scrollTo({ top: 0 });
      void nextTick(focusGrid);
    }
  );

  // Selection can move from outside the grid: following a parent link in the details
  // pane: so the row it lands on has to be brought into view. Only when it is actually
  // off screen: clicking a visible row must not shift the viewport under the cursor.
  watch(
    () => selection.primary,
    (sha) =>
    {
      if (!sha)
      {
        return;
      }
      const row = revisions.rowOf(sha);
      if (row === undefined)
      {
        return;
      }

      const { first, last } = visibleRange();
      if (row >= first && row <= last)
      {
        return;
      }

      // Stepping one row off the edge should scroll by one row; arriving from far away
      // (a parent link, a quick-search hit) is easier placed in the middle.
      const adjacent = row >= first - 2 && row <= last + 2;
      let align: 'auto' | 'center';
      if (adjacent)
      {
        align = 'auto';
      }
      else
      {
        align = 'center';
      }
      opts.scrollToIndex(row, align);
    }
  );

  onMounted(() =>
  {
    if (repo.isOpen)
    {
      focusGrid();
    }
  });

  return {
    menu,
    onRowClick,
    onRowContextMenu,
    onCloseMenu,
    onMenuCommand,
    onKeydown,
    focusGrid,
    sortedRefs
  };
}
