/**
 * Read-only Monaco pane with text binding. Pulled out from BlobViewer because
 * FileHistoryDialog needs it twice. Caller supplies content/theme functions.
 */

import { onMounted, onUnmounted, watch, type Ref } from 'vue';
import * as monaco from '@renderer/monaco.js';
import { applyMonacoTheme, monacoThemeName } from '@renderer/monaco.js';
import { LANGUAGE_PLAINTEXT } from '@renderer/monacoLang.js';


/**
 * The editor's line height and the gap it leaves above the first line, in CSS px.
 *
 * Exported because a column drawn *beside* one of these panes has to step in the same
 * units to stay level with the lines it names: `BlamePane` lays its gutter out from
 * these rather than from a copy of the numbers.
 */
export const EDITOR_LINE_HEIGHT = 18;
export const EDITOR_PADDING_TOP = 4;

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
  /** This pane's own prefix for its models' URIs, distinct from every other pane's. */
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
  /** Makes each file's model URI its own; see the note where the model is built. */
  let serial = 0;

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
      lineHeight: EDITOR_LINE_HEIGHT,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      padding: { top: EDITOR_PADDING_TOP, bottom: 4 },
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
      const previous = editor.getModel();
      if (!c)
      {
        editor.setModel(null);
        previous?.dispose();
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

      // A model per file, at a URI of its own, rather than one model told it is a
      // different language each time. Monaco's language workers take a model on at the
      // moment it is created and key it by its URI: a model made as Markdown and later
      // told it is TypeScript is one the TypeScript worker never learned about, so the
      // first hover over it asks for a file the worker does not have and throws where
      // nobody can catch it. The serial is what makes the URI new, since the pane shows
      // one file after another and the old model is not gone until it is disposed.
      serial += 1;
      const uri = monaco.Uri.parse(`gitext://${opts.uriTag}/${serial}`);
      editor.setModel(monaco.editor.createModel(c.text, c.language, uri));
      previous?.dispose();
      editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
      void Promise.resolve().then(layout);
    },
    { immediate: true }
  );

  return {
    scrollTo: (scrollTop: number) => editor?.setScrollTop(scrollTop)
  };
}
