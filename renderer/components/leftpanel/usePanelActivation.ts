/**
 * Selecting and activating a node in the left panel, by click or by keyboard: they share
 * `activate`/`move` rather than living in separate composables. Pulled out of
 * `LeftPanel.vue` because "how the panel's selection moves" is one coherent reason to
 * change, independent of the virtualizer/rows or the context/sort/background menus.
 */

import { nextTick, onMounted, watch, type Ref } from 'vue';
import { runCommand } from '@renderer/commands/registry.js';
import { useCommandContext } from '@renderer/composables/useCommands.js';
import { KEY_ARROW_DOWN, KEY_ARROW_LEFT, KEY_ARROW_RIGHT, KEY_ARROW_UP, KEY_END, KEY_ENTER, KEY_HOME, isModPressed } from '@renderer/keys.js';
import { activationCommand, type FlatNode } from '@renderer/panel.js';
import { useRevealCommit } from '@renderer/composables/useRevealCommit.js';
import { useRepoObjectsStore } from '@renderer/stores/repoObjects.js';
import { useUiStore } from '@renderer/stores/ui.js';

/** Row height, in CSS pixels: the virtualizer's estimate and `scrollIntoView`'s unit. */
export const ROW_HEIGHT = 22;


export interface PanelActivationOptions {
  rows: () => FlatNode[];
  activeIndex: () => number;
  scroller: Ref<HTMLElement | null>;
  /** The tree's own keydown target: only keys landing here are the tree's to handle. */
  panel: Ref<HTMLElement | null>;
}

export function usePanelActivation(opts: PanelActivationOptions)
{
  const objects = useRepoObjectsStore();
  const ui = useUiStore();
  const { reveal } = useRevealCommit();
  const commandContext = useCommandContext();

  /**
   * Select a node, and move the grid to the commit it stands for. `toggle` is a
   * Mod-click: adds to the grid's selection instead of replacing it, for the two-commit
   * commands (compare, rebase onto). What happens when the grid isn't showing that
   * commit is `useRevealCommit`'s, shared with Navigate and Go to Commit.
   */
  function activate(row: FlatNode, toggle = false): void
  {
    objects.select(row.node.id);
    if (row.node.sha)
    {
      reveal(row.node.sha, { toggle });
    }
  }

  function onRowClick(row: FlatNode, event: MouseEvent): void
  {
    // A section or folder has nothing to select in the grid, so clicking its label acts as its twisty instead.
    if (!row.node.sha && row.expandable)
    {
      objects.toggleExpanded(row.node.id);
    }
    activate(row, isModPressed(event));
  }

  /**
   * Double-click, per kind of node: checkout a branch, create a branch from a tag, open
   * a stash. On a folder or section there's no command and the two clicks already
   * toggled it twice back to start, so toggling once more expands/collapses it.
   */
  async function onRowDoubleClick(row: FlatNode): Promise<void>
  {
    const id = activationCommand(row.node.kind);
    if (!id)
    {
      if (row.expandable)
      {
        objects.toggleExpanded(row.node.id);
      }
      return;
    }
    const ran = await runCommand(id, commandContext.value);
    if (!ran)
    {
      ui.toast(`"${id}" is not available yet.`, 'info');
    }
  }

  /** Hover text: the whole of what the row had to truncate. */
  function rowTitle(row: FlatNode | undefined): string
  {
    if (!row)
    {
      return '';
    }
    return row.node.title ?? row.node.label;
  }

  function onTwistyClick(row: FlatNode, event: MouseEvent): void
  {
    event.stopPropagation();
    objects.toggleExpanded(row.node.id);
  }

  /** Scroll a row into view. `scrollTop`/`clientHeight`, not the virtualizer's item range, which includes off-screen overscan rows. */
  function scrollIntoView(index: number): void
  {
    const el = opts.scroller.value;
    if (!el)
    {
      return;
    }
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop)
    {
      el.scrollTo({ top });
    }
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight)
    {
      el.scrollTo({ top: top + ROW_HEIGHT - el.clientHeight });
    }
  }

  function move(delta: number): void
  {
    const rows = opts.rows();
    const next = Math.min(Math.max(opts.activeIndex() + delta, 0), rows.length - 1);
    const row = rows[next];
    if (row)
    {
      activate(row);
      scrollIntoView(next);
    }
  }

  /** The row whose children this one sits in: the nearest one above at a lower depth. */
  function parentIndexOf(index: number): number
  {
    const rows = opts.rows();
    const depth = rows[index]?.depth ?? 0;
    for (let i = index - 1; i >= 0; i--)
    {
      if ((rows[i]?.depth ?? 0) < depth)
      {
        return i;
      }
    }
    return -1;
  }

  function onKeydown(event: KeyboardEvent): void
  {
    // Only the tree's own keys: rows aren't focusable, so a key from a control inside the
    // panel (the filter box, the sort button) is that control's, not the tree's.
    if (event.target !== opts.panel.value)
    {
      return;
    }

    const index = opts.activeIndex();
    const row = opts.rows()[index];

    switch (event.key)
    {
      case KEY_ARROW_DOWN:
        if (index === -1)
        {
          move(0);
        }
        else
        {
          move(1);
        }
        break;
      case KEY_ARROW_UP:
        if (index === -1)
        {
          move(0);
        }
        else
        {
          move(-1);
        }
        break;
      case KEY_ARROW_RIGHT:
        // Open what is closed, then step into it: standard tree behaviour, so Right on a leaf does nothing.
        if (row?.expandable && !row.expanded)
        {
          objects.setExpanded(row.node.id, true);
        }
        else if (row?.expanded)
        {
          move(1);
        }
        break;
      case KEY_ARROW_LEFT:
        if (row?.expanded)
        {
          objects.setExpanded(row.node.id, false);
        }
        else
        {
          const parent = parentIndexOf(index);
          if (parent !== -1)
          {
            const target = opts.rows()[parent];
            if (target)
            {
              activate(target);
              scrollIntoView(parent);
            }
          }
        }
        break;
      case KEY_HOME:
        move(-opts.rows().length);
        break;
      case KEY_END:
        move(opts.rows().length);
        break;
      case KEY_ENTER:
        // Enter is the keyboard's click; the row is already selected, so this is only the expand-or-reveal half.
        if (row)
        {
          if (!row.node.sha && row.expandable)
          {
            objects.toggleExpanded(row.node.id);
          }
          activate(row, event.ctrlKey || event.metaKey);
        }
        break;
      default:
        return;
    }

    event.preventDefault();
  }

  /**
   * Follow a selection the panel did not make itself: the store selects the checked-out
   * branch on open, which is routinely folded inside a collapsed folder. Clicks scroll themselves into view already, so this is a no-op for them.
   */
  watch(
    () => objects.selectedId,
    () =>
    {
      void revealSelection();
    }
  );

  /** And the selection it was born holding: the rail picks one while nothing is mounted. */
  onMounted(() =>
  {
    void revealSelection();
  });

  async function revealSelection(): Promise<void>
  {
    await nextTick();
    if (opts.activeIndex() !== -1)
    {
      scrollIntoView(opts.activeIndex());
    }
  }

  return {
    activate,
    onRowClick,
    onRowDoubleClick,
    rowTitle,
    onTwistyClick,
    move,
    onKeydown,
    scrollIntoView
  };
}
