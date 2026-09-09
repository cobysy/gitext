<script setup lang="ts">
/**
 * The frame every dialog is built in: a header, a body that scrolls, and a footer of
 * actions. No scrim, no resize grips: a dialog is a real window, resized by the window
 * manager and remembered by `main/dialogs.ts`.
 *
 * The header is also the title bar: `main/dialogs.ts` hides the native one, so this is
 * the only place the title appears and the strip the window is dragged by
 * (`-webkit-app-region: drag`), with every control on it opting back out.
 *
 * **The ✕ here is the close button on every platform, including macOS**, which draws
 * no traffic lights on a modal window with a parent (every dialog), except two levels
 * down over the title, so those are hidden outright.
 *
 * `inPage` is the exception: `ConfirmDialog` opens inside whichever window asked, with
 * the same frame but no window behaviour: no drag region, same close button.
 */

import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '@renderer/api.js';

const props = withDefaults(
  defineProps<{
    title: string;
    /** Rendered inside a window (the default), or in the page as an overlay panel. */
    inPage?: boolean;
    /**
     * This window's height is its own, not its content's. For a dialog you *answer*,
     * measuring the form is right; for one you *browse* (a list beside a pane), it's
     * wrong, since the pane's height varies per row and no single row is a size for the
     * window. So these take `DIALOG_WINDOWS`'s size and let the body scroll.
     */
    fixedHeight?: boolean;
    /**
     * The body fills the frame edge to edge and does not scroll: for panes rather than
     * a form (the commit screen's splitters), which do their own scrolling inside.
     */
    flush?: boolean;
    /** In-page only: how wide the panel is. A window's width is the window's. */
    width?: string;
  }>(),
  { width: '420px' }
);

const emit = defineEmits<{ close: [] }>();

/**
 * Telling the window how tall the dialog is (`main/dialogs/fit.ts`). Measured as
 * header + footer as drawn, plus the body at `scrollHeight`, the content height the
 * scrollbar exists because of; reported again on every content change, so a folded
 * panel opening grows the window instead of pushing the buttons under the edge.
 *
 * A `MutationObserver` as well as a `ResizeObserver`, since the changes that matter
 * here (`v-if`s, a panel appearing, a rejection replacing the form) swap the body's
 * children without its own box changing.
 */
const headEl = ref<HTMLElement | null>(null);
const bodyEl = ref<HTMLElement | null>(null);
const footEl = ref<HTMLElement | null>(null);

let observers: { disconnect: () => void }[] = [];
let pending = 0;

/**
 * How tall the body would be if nothing constrained it. Not `scrollHeight`: that's the
 * content height *or the element's own height, whichever is larger*, so a form with
 * room to spare measures exactly as tall as the window it's already in. The only way
 * to ask is to stop constraining it, read, and put it back, before the browser paints.
 */
function naturalBodyHeight(body: HTMLElement): number
{
  const { flex, height, overflowY } = body.style;
  body.style.flex = 'none';
  body.style.height = 'auto';
  body.style.overflowY = 'visible';
  const measured = body.offsetHeight;
  body.style.flex = flex;
  body.style.height = height;
  body.style.overflowY = overflowY;
  return measured;
}

function report(): void
{
  const body = bodyEl.value;
  if (!body)
  {
    return;
  }
  // The content, and only the content: `main/dialogs/fit.ts` adds the window's own
  // frame. The page's own way of asking (`outerHeight - innerHeight`) lags a resize by frames.
  void api['dialog:fit'](
    (headEl.value?.offsetHeight ?? 0) +
      naturalBodyHeight(body) +
      (footEl.value?.offsetHeight ?? 0)
  );
}

/** Coalesced to one report per frame: both observers fire for the same change. */
function schedule(): void
{
  if (pending)
  {
    return;
  }
  pending = requestAnimationFrame(() =>
  {
    pending = 0;
    report();
  });
}

/**
 * A record that is `naturalBodyHeight` setting and restoring the body's inline style.
 * The `MutationObserver` watches the body it writes to, so without this, measuring
 * would schedule another measurement forever. A `style` change on a *child* still counts.
 */
function isMeasurementWrite(record: MutationRecord): boolean
{
  return (
    record.type === 'attributes' &&
    record.attributeName === 'style' &&
    record.target === bodyEl.value
  );
}

onMounted(async () =>
{
  // An in-page panel is not a window and has nothing to resize.
  if (props.inPage)
  {
    return;
  }
  await nextTick();

  // A fixed-height window measures nothing but must still say it has drawn: `fit.ts`
  // keeps a dialog hidden until its first `dialog:fit`. Zero is that signal.
  if (props.fixedHeight)
  {
    void api['dialog:fit'](0);
    return;
  }

  report();

  const body = bodyEl.value;
  if (!body)
  {
    return;
  }

  const resize = new ResizeObserver(schedule);
  resize.observe(body);
  if (footEl.value)
  {
    resize.observe(footEl.value);
  }

  const mutate = new MutationObserver((records) =>
  {
    if (records.every(isMeasurementWrite))
    {
      return;
    }
    schedule();
  });
  mutate.observe(body, { childList: true, subtree: true, attributes: true, characterData: true });

  observers = [resize, mutate];
});

onBeforeUnmount(() =>
{
  if (pending)
  {
    cancelAnimationFrame(pending);
  }
  for (const observer of observers)
  {
    observer.disconnect();
  }
  observers = [];
});
</script>

<template>
  <!-- The scrim belongs to the frame: what hosts an in-page dialog, the way a window hosts the other kind. -->
  <div
    class="mount"
    :class="{ scrim: props.inPage }"
    @mousedown.self="props.inPage && emit('close')"
  >
    <!-- `data-fixed-height` is the only outward sign of which window this is;
         `e2e/support/dialog.ts` reads it to tell an outgrown form from a document built to scroll. -->
    <div
      class="frame"
      :class="{ 'in-page': props.inPage }"
      :data-fixed-height="props.fixedHeight || undefined"
      :style="props.inPage ? { width: `min(92vw, ${props.width})` } : undefined"
    >
      <header ref="headEl" class="head" :class="{ draggable: !props.inPage }">
        <h2>{{ props.title }}</h2>
        <!-- What a bar carries besides its title (the commit screen's conflict button, its error line), before the ✕. -->
        <slot name="titleActions" />
        <button class="close" aria-label="Close" @click="emit('close')">✕</button>
      </header>

      <div ref="bodyEl" class="body" :class="{ flush: props.flush }">
        <slot />
      </div>

      <footer v-if="$slots.actions" ref="footEl" class="actions">
        <slot name="actions" />
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* In a window the mount is the window; in the page it is the scrim over it. */
.mount {
  height: 100%;
  min-height: 0;
}

.mount.scrim {
  position: fixed;
  inset: 0;
  height: auto;
  background: var(--scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 90;
}

/* `--bg-overlay`, not `--bg`, in a window as well as the page: a dialog is a raised
 * thing whatever holds it. `main/dialogs.ts` paints the window this colour before the renderer loads. */
.frame {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-overlay);
  color: var(--fg);
}

/* In a page it is a panel rather than the whole window: it needs its own edge, its own
   shadow, and a height that stops at its content. */
.frame.in-page {
  height: auto;
  max-height: 86vh;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
  overflow: hidden;
}

/* The window's title bar: with the native one hidden, the only place the title appears and the strip it's dragged by. */
.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  flex: none;
}

.head.draggable {
  -webkit-app-region: drag;
}

h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  flex: 1;
  /* A long dialog title is truncated rather than pushing the close button off the edge. */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close {
  border: none;
  background: none;
  padding: var(--space-1);
  /* Inside a drag region nothing is clickable until it says so. */
  -webkit-app-region: no-drag;
}

.body {
  padding: var(--space-3);
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.body.flush {
  padding: 0;
  overflow: hidden;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3);
  border-top: 1px solid var(--border-subtle);
  flex: none;
}
</style>
