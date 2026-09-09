/**
 * Where a context menu panel sits in the viewport, and everything that closes it from
 * the outside: a click elsewhere, a scroll or resize that moves its anchor, and Escape
 * when the panel itself doesn't have the keyboard. Pulled out of `ContextMenu.vue`:
 * "staying on screen and closing when the world moves" is independent of the arrow-key highlight and submenu logic, which stays tied to `items`.
 */

import { computed, nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { KEY_ESCAPE } from '@renderer/keys.js';

const MARGIN = 8;

export interface MenuPlacementOptions {
  panel: Ref<HTMLElement | null>;
  /** Viewport coordinates the top-left corner wants. */
  x: () => number;
  y: () => number;
  /** Where to put the right edge instead, when the panel does not fit rightwards. */
  flipX: () => number | undefined;
  /** A nested panel closes differently: it does not own the outside-click. */
  nested: () => boolean;
  onClose: () => void;
}

export function useMenuPlacement(opts: MenuPlacementOptions)
{
  /** Set once measured, so the panel is never painted at the unclamped position. */
  const placed = ref(false);
  const position = ref({ left: opts.x(), top: opts.y() });

  /**
   * Every panel is positioned in viewport coordinates, nested ones included. A submenu
   * absolutely positioned inside its parent would be clipped the moment the parent has
   * to scroll. `position: fixed` escapes an ancestor's `overflow` (no transform anywhere in this tree makes one a containing block).
   */
  const style = computed(() =>
  {
    let visibility: string;
    if (placed.value)
    {
      visibility = 'visible';
    }
    else
    {
      visibility = 'hidden';
    }
    return {
      position: 'fixed',
      left: `${position.value.left}px`,
      top: `${position.value.top}px`,
      visibility
    } as Record<string, string>;
  });

  /**
   * Keep the panel on screen. A right-click near the bottom-right corner is the normal
   * case, not the edge case, so the menu folds back over the cursor. A submenu folds
   * back across its own row, which is why `flipX` is the row's left edge, not a computed offset.
   */
  function place(): void
  {
    const el = opts.panel.value;
    if (!el)
    {
      return;
    }

    const { width, height } = el.getBoundingClientRect();

    let left = opts.x();
    if (left + width > window.innerWidth - MARGIN)
    {
      const flipX = opts.flipX();
      if (flipX === undefined)
      {
        left = window.innerWidth - width - MARGIN;
      }
      else
      {
        left = flipX - width;
      }
    }

    position.value = {
      left: Math.max(MARGIN, left),
      // A menu taller than the window is pinned to the top and scrolls; `max-height` in the stylesheet stops it running off the bottom.
      top: Math.max(MARGIN, Math.min(opts.y(), window.innerHeight - height - MARGIN))
    };
    placed.value = true;
  }

  function onDocumentPointerDown(event: PointerEvent): void
  {
    if (opts.panel.value?.contains(event.target as Node))
    {
      return;
    }
    opts.onClose();
  }

  /** Anything that moves what is underneath closes the menu: a row can scroll out from under its anchor, and closing is honest where repositioning would be a guess. */
  function closeOnViewportChange(): void
  {
    opts.onClose();
  }

  /**
   * Escape, when the menu doesn't have the keyboard. Non-capturing, so the panel's own
   * handler wins whenever focus *is* inside; exists for when something else took focus, where an open menu Escape can't dismiss is a trap.
   */
  function onDocumentKeydown(event: KeyboardEvent): void
  {
    if (event.key === KEY_ESCAPE)
    {
      opts.onClose();
    }
  }

  onMounted(async () =>
  {
    // Measure, place, and only then take focus: a panel is `visibility: hidden` until
    // placed, and a hidden element can't be focused. Calling `focus()` earlier silently
    // leaves the keyboard on the grid, where arrow keys walk the selection behind the open menu.
    await nextTick();
    place();
    await nextTick();
    opts.panel.value?.focus();

    if (opts.nested())
    {
      return;
    }
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('keydown', onDocumentKeydown);
    document.addEventListener('wheel', closeOnViewportChange, { passive: true });
    window.addEventListener('resize', closeOnViewportChange);
  });

  onBeforeUnmount(() =>
  {
    if (opts.nested())
    {
      return;
    }
    document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    document.removeEventListener('keydown', onDocumentKeydown);
    document.removeEventListener('wheel', closeOnViewportChange);
    window.removeEventListener('resize', closeOnViewportChange);
  });

  return { style };
}
