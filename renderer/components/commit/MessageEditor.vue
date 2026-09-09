<script setup lang="ts">
/**
 * Commit message editor: Monaco in markdown (no wrapping, preserves author's line breaks).
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import * as monaco from '@renderer/monaco.js';
import { applyMonacoTheme, monacoThemeName } from '@renderer/monaco.js';
import { useSettingsStore } from '@renderer/stores/settings.js';

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [string];
  /** The caret moved: line and column, both 1-based, for the status bar. */
  caret: [{ line: number; column: number }];
  /** Cmd/Ctrl+Enter from inside the editor. */
  submit: [];
  /** Escape from inside the editor, with no Monaco widget of its own open. */
  cancel: [];
}>();

const settings = useSettingsStore();

const LANGUAGE_MARKDOWN = 'markdown';

const container = ref<HTMLElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let model: monaco.editor.ITextModel | null = null;
let resizeObserver: ResizeObserver | null = null;

/** Monaco has no placeholder of its own, so the empty state is drawn over the top. */
const empty = computed(() => props.modelValue === '');

watch(
  () => settings.effectiveTheme,
  (theme) => applyMonacoTheme(theme),
  { immediate: true }
);

/**
 * True while `setValue` is running, so the change it raises is not echoed back out.
 *
 * Without it, amending, which fills the box from `git log`, would emit the text it was
 * just given as if the user had typed it, and the store would write over itself.
 */
let applying = false;

function createEditor(): void
{
  if (!container.value)
  {
    return;
  }

  model = monaco.editor.createModel(props.modelValue, LANGUAGE_MARKDOWN);

  editor = monaco.editor.create(container.value, {
    model,
    theme: monacoThemeName(settings.effectiveTheme),
    wordWrap: 'off',
    lineNumbers: 'off',
    minimap: { enabled: false },
    folding: false,
    glyphMargin: false,
    // No line numbers and no glyph margin, so this is the whole left gutter: without it
    // the first character sits against the border.
    lineDecorationsWidth: 8,
    lineNumbersMinChars: 0,
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    scrollBeyondLastLine: false,
    renderLineHighlight: 'none',
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    padding: { top: 6, bottom: 6 },
    stickyScroll: { enabled: false },
    contextmenu: false,
    // A commit message is prose. Every one of these is an editor helping with code:
    // completing words from the file, boxing a smart quote as suspicious, ringing the
    // other occurrences of whatever the caret is in. Here they are all noise.
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    wordBasedSuggestions: 'off',
    parameterHints: { enabled: false },
    occurrencesHighlight: 'off',
    unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
    // Typing `don't` must not produce `don''t`, and a `(` in prose is not an opening
    // anything. What you type is what the message says.
    autoClosingBrackets: 'never',
    autoClosingQuotes: 'never',
    autoSurround: 'never'
  });

  editor.onDidChangeModelContent(() =>
  {
    if (applying || !editor)
    {
      return;
    }
    emit('update:modelValue', editor.getValue());
  });

  editor.onDidChangeCursorPosition((event) =>
  {
    emit('caret', { line: event.position.lineNumber, column: event.position.column });
  });

  // Committing from inside the editor. The screen's own window listener never sees this
  // one: Monaco stops a keystroke it has a binding for, which is exactly what stops the
  // two of them from committing twice.
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => emit('submit'));

  // Escape closes the screen: unless Monaco's own find widget or a suggest popup is up,
  // which is what Escape is for while either is showing.
  editor.addCommand(
    monaco.KeyCode.Escape,
    () => emit('cancel'),
    '!findWidgetVisible && !suggestWidgetVisible && !renameInputVisible'
  );

  resizeObserver = new ResizeObserver(() =>
  {
    const el = container.value;
    if (el && editor)
    {
      editor.layout({ width: el.clientWidth, height: el.clientHeight });
    }
  });
  resizeObserver.observe(container.value);
}

function destroyEditor(): void
{
  resizeObserver?.disconnect();
  resizeObserver = null;
  editor?.dispose();
  editor = null;
  model?.dispose();
  model = null;
}

onMounted(createEditor);
onUnmounted(destroyEditor);

// Changes from elsewhere: the amend checkbox filling the box, a commit emptying it.
// Compared before writing, because `setValue` throws the undo stack away and doing that
// on every keystroke would mean an editor you cannot undo in.
watch(
  () => props.modelValue,
  (value) =>
  {
    if (!editor || editor.getValue() === value)
    {
      return;
    }
    applying = true;
    editor.setValue(value);
    applying = false;
  }
);

defineExpose({
  focus: (): void => editor?.focus()
});
</script>

<template>
  <div class="message-editor">
    <div ref="container" class="monaco fill" />
    <div v-if="empty && placeholder" class="placeholder" aria-hidden="true">
      {{ placeholder }}
    </div>
  </div>
</template>

<style scoped src="@renderer/styles/monacoHost.css"></style>
<style scoped>
.message-editor {
  position: relative;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

/*
  Over the editor rather than inside it: Monaco has no placeholder, and the text has to
  sit exactly where the first character will. `pointer-events: none` so a click through
  it lands in the editor and puts the caret where it was aimed.
*/
.placeholder {
  position: absolute;
  /* Where the first character lands: the editor's top padding, and its left gutter. */
  top: 6px;
  left: 8px;
  pointer-events: none;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 18px;
  color: var(--fg-subtle);
}
</style>
