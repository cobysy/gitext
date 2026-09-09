/**
 * The two read-only panes above the merge editor: base against ours, and base against
 * theirs. Each is a Monaco diff editor, inline rather than side-by-side, because the
 * window already has three columns and a fourth would leave none of them readable.
 *
 * Its own module because none of it is about conflicts: it is two editors, their
 * models, their resize observers and their disposal, which is the whole of what a
 * component should not have to hold while it is deciding what a conflict block means.
 * The template binds each host with `:ref` and one of the two setters below; everything
 * else stays here.
 */

import { onUnmounted } from 'vue';
import * as monaco from '@renderer/monaco.js';
import { monacoThemeName } from '@renderer/monaco.js';
import type { ConflictBlobs } from '@shared/types.js';

/** Matches the merge editor's own, so the three panes' lines sit on the same rhythm. */
const FONT_FAMILY = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

export interface ReferencePanesOptions {
  /** The three sides, once they have been read. Null until then. */
  blobs: () => ConflictBlobs | null;
  /** The language to highlight both panes as, from the file's own path. */
  language: () => string;
  theme: () => 'light' | 'dark';
}

/** What Vue hands a `:ref` binding: the element, a component, or null on unmount. */
type RefTarget = Element | { $el?: unknown } | null;

export interface ReferencePanes {
  setOursHost: (el: RefTarget) => void;
  setTheirsHost: (el: RefTarget) => void;
  /** Build both panes. A no-op until the hosts are in the DOM and the blobs have arrived. */
  create: () => void;
}

export function useReferencePanes(options: ReferencePanesOptions): ReferencePanes
{
  let oursHost: HTMLElement | null = null;
  let theirsHost: HTMLElement | null = null;

  function asElement(el: RefTarget): HTMLElement | null
  {
    if (el instanceof HTMLElement)
    {
      return el;
    }
    return null;
  }

  let oursDiff: monaco.editor.IStandaloneDiffEditor | null = null;
  let theirsDiff: monaco.editor.IStandaloneDiffEditor | null = null;
  let oursResize: ResizeObserver | null = null;
  let theirsResize: ResizeObserver | null = null;

  function createPane(
    host: HTMLElement,
    originalText: string,
    modifiedText: string
  ): monaco.editor.IStandaloneDiffEditor
  {
    const diffEditor = monaco.editor.createDiffEditor(host, {
      readOnly: true,
      originalEditable: false,
      renderSideBySide: false,
      renderOverviewRuler: false,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      lineNumbers: 'on',
      fontSize: 12,
      lineHeight: 18,
      fontFamily: FONT_FAMILY,
      theme: monacoThemeName(options.theme()),
      contextmenu: false,
      stickyScroll: { enabled: false }
    });
    diffEditor.setModel({
      original: monaco.editor.createModel(originalText, options.language()),
      modified: monaco.editor.createModel(modifiedText, options.language())
    });
    return diffEditor;
  }

  function disposePane(diffEditor: monaco.editor.IStandaloneDiffEditor | null): void
  {
    const model = diffEditor?.getModel();
    model?.original.dispose();
    model?.modified.dispose();
    diffEditor?.dispose();
  }

  function layoutPane(
    host: HTMLElement | null,
    diffEditor: monaco.editor.IStandaloneDiffEditor | null
  ): void
  {
    if (host && diffEditor)
    {
      diffEditor.layout({ width: host.clientWidth, height: host.clientHeight });
    }
  }

  interface PaneTarget {
    ours: HTMLElement;
    theirs: HTMLElement;
    blobs: ConflictBlobs;
  }

  /** The hosts and blobs to build both panes from, or null when any of the three is missing. */
  function paneTarget(): PaneTarget | null
  {
    const ours = oursHost;
    const theirs = theirsHost;
    const blobs = options.blobs();
    if (ours && theirs && blobs)
    {
      return { ours, theirs, blobs };
    }
    else
    {
      return null;
    }
  }

  function create(): void
  {
    const target = paneTarget();
    if (!target)
    {
      return;
    }
    const base = target.blobs.base ?? '';
    oursDiff = createPane(target.ours, base, target.blobs.ours ?? '');
    theirsDiff = createPane(target.theirs, base, target.blobs.theirs ?? '');
    oursResize = new ResizeObserver(() => layoutPane(oursHost, oursDiff));
    oursResize.observe(target.ours);
    theirsResize = new ResizeObserver(() => layoutPane(theirsHost, theirsDiff));
    theirsResize.observe(target.theirs);
  }

  onUnmounted(() =>
  {
    oursResize?.disconnect();
    theirsResize?.disconnect();
    disposePane(oursDiff);
    disposePane(theirsDiff);
  });

  function setOursHost(el: RefTarget): void
  {
    oursHost = asElement(el);
  }

  function setTheirsHost(el: RefTarget): void
  {
    theirsHost = asElement(el);
  }

  return { setOursHost, setTheirsHost, create };
}
