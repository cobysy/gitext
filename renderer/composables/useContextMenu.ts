/**
 * Shared context menu state: x, y, items opened from a click/button and closed after run.
 * One shape for all panes so menus are swappable.
 */

import { ref, type Ref } from 'vue';
import type { ResolvedItem } from '@renderer/menus/resolve.js';

export interface OpenContextMenu {
  x: number;
  y: number;
  items: ResolvedItem[];
}

export interface UseContextMenu {
  menu: Ref<OpenContextMenu | null>;
  /** Open at an explicit point: a right-click's coordinates. */
  openAt: (x: number, y: number, items: ResolvedItem[]) => void;
  /** Open at a `MouseEvent`'s coordinates: the common case for a `contextmenu` handler. */
  openFrom: (event: MouseEvent, items: ResolvedItem[]) => void;
  /** Open below a button, for a menu opened by click rather than by right-click. */
  openBelow: (element: HTMLElement, items: ResolvedItem[]) => void;
  close: () => void;
}

export function useContextMenu(): UseContextMenu
{
  const menu = ref<OpenContextMenu | null>(null) as Ref<OpenContextMenu | null>;

  function openAt(x: number, y: number, items: ResolvedItem[]): void
  {
    menu.value = { x, y, items };
  }

  function openFrom(event: MouseEvent, items: ResolvedItem[]): void
  {
    openAt(event.clientX, event.clientY, items);
  }

  function openBelow(element: HTMLElement, items: ResolvedItem[]): void
  {
    const box = element.getBoundingClientRect();
    openAt(box.left, box.bottom + 2, items);
  }

  function close(): void
  {
    menu.value = null;
  }

  return { menu, openAt, openFrom, openBelow, close };
}
