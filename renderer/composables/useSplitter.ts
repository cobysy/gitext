/**
 * Drag-to-resize panes: three shapes (below/right/left divider), one composable.
 * Listeners on window (pointer leaves 4px divider mid-drag).
 */

import { computed, onUnmounted, ref, type ComputedRef, type Ref } from 'vue';

/** Which edge of the pane the divider sits on. */
export type SplitterEdge = 'top' | 'right' | 'left';

const EDGE_TOP = 'top';
const EDGE_RIGHT = 'right';

export interface PaneSplitter {
  /** Current pane size in pixels: a height for `top`, a width for `right` and `left`. */
  size: Ref<number>;
  /** Attach to the divider's `mousedown`. */
  start: (event: MouseEvent) => void;
  /**
   * Whether divider is vertical (derived, not restated, so column and drag can't disagree).
   */
  vertical: ComputedRef<boolean>;
}

export function usePaneSplitter(options: {
  initial: number;
  min: number;
  /** Evaluated per move, so a resized window cannot leave the pane larger than it. */
  max: () => number;
  /**
   * Divider edge (defaults to below). Can be a function when it moves (docked pane position).
   */
  edge?: SplitterEdge | (() => SplitterEdge);
  /**
   * Called when drag ends (once per drag, not per move, for one config write not sixty).
   */
  onEnd?: (size: number) => void;
}): PaneSplitter
{
  // Clamp initial: remembered size may violate a new minimum.
  const size = ref(Math.max(options.initial, options.min));

  const currentEdge = (): SplitterEdge =>
  {
    if (typeof options.edge === 'function')
    {
      return options.edge();
    }
    else
    {
      return options.edge ?? EDGE_TOP;
    }
  };

  let stop: (() => void) | null = null;

  function start(event: MouseEvent): void
  {
    stop?.();

    const edge = currentEdge();
    const horizontal = edge !== EDGE_TOP;
    // Pane below/right grows against pointer; left grows with delta.
    let sign;
    if (edge === EDGE_RIGHT)
    {
      sign = 1;
    }
    else
    {
      sign = -1;
    }

    let origin;
    if (horizontal)
    {
      origin = event.clientX;
    }
    else
    {
      origin = event.clientY;
    }
    const startSize = size.value;

    const onMove = (move: MouseEvent): void =>
    {
      let moveCoord: number;
      if (horizontal)
      {
        moveCoord = move.clientX;
      }
      else
      {
        moveCoord = move.clientY;
      }
      const delta = moveCoord - origin;
      const next = startSize + sign * delta;
      size.value = Math.min(Math.max(next, options.min), Math.max(options.max(), options.min));
    };

    stop = () =>
    {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stop!);
      stop = null;
      options.onEnd?.(size.value);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stop);
  }

  // A drag in progress when the component goes away would otherwise keep a listener
  // alive against a size nobody reads.
  onUnmounted(() => stop?.());

  return { size, start, vertical: computed(() => currentEdge() !== EDGE_TOP) };
}
