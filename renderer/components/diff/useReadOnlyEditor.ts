/**
 * Read-only Monaco pane with text binding. Pulled out from BlobViewer because
 * FileHistoryDialog needs it twice. Caller supplies content/theme functions.
 */

import { onMounted, onUnmounted, watch, type Ref } from 'vue';
import * as monaco from '@renderer/monaco.js';
import { applyMonacoTheme, monacoThemeName } from '@renderer/monaco.js';
import { LANGUAGE_PLAINTEXT } from '@renderer/monacoLang.js';


export interface ReadOnlyEditorContent {
  text: string;
  language: string;
  /**
   * Wrap long lines. Property of content not pane: patch must not wrap,
   * prose wraps. One pane may show both.
   */
  wordWrap?: boolean;
}

export interface ReadOnlyEditorOptions {
  /** Template's ref where editor mounts. */
  host: Ref<HTMLElement | null>;
  effectiveTheme: () => 'light' | 'dark';
  /** Content to show, null if nothing yet. Re-applied on change. */
  content: () => ReadOnlyEditorContent | null;
  /** Stable identity for this pane's model, distinct from other panes. */
  uriTag: string;
  /** Fires on scroll so caller can sync gutter. */
  onScroll?: (scrollTop: number) => void;
}

export function useReadOnlyEditor(opts: ReadOnlyEditorOptions): {
  scrollTo: (scrollTop: number) => void;
}
{
  let editor: monaco.editor.IStandaloneCodeEditor | null = null;
  let resizeObserver: ResizeObserver | null = null;

  function layout(): void
  {
    const el = opts.host.value;
    if (el && editor)
    {
      editor.layout({ width: el.clientWidth, height: el.clientHeight });
    }
  }

  function createEditor(): void
  {
    if (!opts.host.value)
    {
      return;
    }
    editor = monaco.editor.create(opts.host.value, {
      readOnly: true,
      value: '',
      language: LANGUAGE_PLAINTEXT,
      theme: monacoThemeName(opts.effectiveTheme()),
      scrollBeyondLastLine: false,
      wordWrap: 'off',
      minimap: { enabled: false },
      lineNumbers: 'on',
      renderLineHighlight: 'none',
      fontSize: 12,
      lineHeight: 18,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      padding: { top: 4, bottom: 4 },
      stickyScroll: { enabled: false },
      contextmenu: false
    });

    resizeObserver = new ResizeObserver(layout);
    resizeObserver.observe(opts.host.value);

    if (opts.onScroll)
    {
      const onScroll = opts.onScroll;
      editor.onDidScrollChange((e) => onScroll(e.scrollTop));
    }
  }

  function destroyEditor(): void
  {
    resizeObserver?.disconnect();
    resizeObserver = null;
    editor?.getModel()?.dispose();
    editor?.dispose();
    editor = null;
  }

  onMounted(createEditor);
  onUnmounted(destroyEditor);

  watch(opts.effectiveTheme, (theme) =>
  {
    applyMonacoTheme(theme);
  });

  watch(
    opts.content,
    (c) =>
    {
      if (!editor)
      {
        return;
      }
      if (!c)
      {
        const model = editor.getModel();
        if (model)
        {
          model.setValue('');
        }
        return;
      }

      let wordWrap: 'on' | 'off';
      if (c.wordWrap)
      {
        wordWrap = 'on';
      }
      else
      {
        wordWrap = 'off';
      }
      editor.updateOptions({ wordWrap });

      const uri = monaco.Uri.parse(`gitext://${opts.uriTag}`);
      let model = monaco.editor.getModel(uri);
      if (!model)
      {
        model = monaco.editor.createModel(c.text, c.language, uri);
      }
      else
      {
        monaco.editor.setModelLanguage(model, c.language);
        model.setValue(c.text);
      }
      const previous = editor.getModel();
      editor.setModel(model);
      if (previous && previous !== model)
      {
        previous.dispose();
      }
      editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
      void Promise.resolve().then(layout);
    },
    { immediate: true }
  );

  return {
    scrollTo: (scrollTop: number) => editor?.setScrollTop(scrollTop)
  };
}
