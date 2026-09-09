/**
 * A scroller that stays at its newest line, the way a terminal does: output appearing
 * while you watch keeps the end in view, and scrolling up to read something older
 * stops it until you come back to the bottom.
 *
 * Takes the element rather than owning it, so the component keeps its own template ref
 * and this knows nothing about how it was bound.
 */

import { nextTick, ref, type ShallowRef } from 'vue';

/**
 * How close to the bottom still counts as being at it. Two pixels rather than none:
 * a fractional device pixel ratio leaves `scrollTop` a fraction short of the bottom it
 * just reached. A caller whose rows are taller than that passes its own.
 */
const AT_BOTTOM_PX = 2;

export interface FollowTail {
  /** Bind to the element's `scroll` event. */
  onScroll: () => void;
  /** Call when content has been added: scrolls to the end unless the reader moved away. */
  stick: () => Promise<void>;
}

export function useFollowTail(
  el: Readonly<ShallowRef<HTMLElement | null>>,
  atBottomPx: number = AT_BOTTOM_PX
): FollowTail
{
  const following = ref(true);

  async function stick(): Promise<void>
  {
    if (!following.value)
    {
      return;
    }
    // After the DOM has grown: `scrollHeight` read before it has is the old height.
    await nextTick();
    const box = el.value;
    if (box)
    {
      box.scrollTop = box.scrollHeight;
    }
  }

  function onScroll(): void
  {
    const box = el.value;
    if (!box)
    {
      return;
    }
    following.value = box.scrollHeight - box.scrollTop - box.clientHeight < atBottomPx;
  }

  return { onScroll, stick };
}
