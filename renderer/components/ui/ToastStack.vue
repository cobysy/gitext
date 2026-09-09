<script setup lang="ts">
/**
 * Toast stack: rendered in both repo and dialog windows (each has its own ui store).
 */

import { useUiStore } from '@renderer/stores/ui.js';
import CodeText from './CodeText.vue';

const ui = useUiStore();
</script>

<template>
  <!--
    A live region, so a toast is announced rather than only drawn. An error toast is often
    the app's only report that something failed, and without this it was silent to assistive
    technology. `polite`, not `assertive`: a toast is worth hearing at the next pause, not
    worth cutting off what is being read.
  -->
  <div class="toasts" role="status" aria-live="polite" aria-atomic="false">
    <div v-for="toast in ui.toasts" :key="toast.id" class="toast" :class="toast.tone">
      <CodeText :text="toast.message" />
    </div>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  z-index: 120;
}

.toast {
  padding: var(--space-2) var(--space-4);
  background: var(--bg-overlay);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
  font-size: var(--text-sm);
}

.toast.error {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
